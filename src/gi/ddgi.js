// src/gi/ddgi.js  — M3 (DDGI 심장: 16방향 SF 샘플 + SH L1 누적 + 시간 수렴 + 칠한 색 반영)
// =============================================================================
// [M1] 파이프라인 ✓  [M2] 레이마칭 ✓  →  [M3] 다방향+SH+시간누적+동적 ←지금
//      [M4] 머티리얼 셰이딩 주입(실제로 벽에 번지게) — 다음 단계
//
// SH: per-probe L1 = 4 vec3 계수 (DC + x,y,z). irradiance(평균색) ≈ DC 항.
// 시간 누적: new = mix(old, sampled, ALPHA)  — 매 프레임 조금씩 수렴.
// 검증(디버그 점): 점이 "사방 평균색(irradiance)"이 되고, 노이즈→수렴,
//   빨강 칠하면 패널 근처 점이 서서히 붉어짐.
// =============================================================================

import * as THREE from 'three/webgpu';
import { Fn, instancedArray, instanceIndex, vec3, float, Loop, uniform } from 'three/tsl';

const GRID = { nx: 7, ny: 4, nz: 7 };
const AREA = { min: new THREE.Vector3(-8, 0.4, -8), max: new THREE.Vector3(8, 5.4, 8) };
const SH_COEFFS = 4;
const NUM_RAYS = 16;     // 프로브당 광선(시간 누적으로 노이즈 감소)
const ALPHA = 0.08;      // 시간 블렌딩(작을수록 천천히 수렴)
const RAY_MAX = 40.0;    // 광선 최대 거리

// 씬 박스(AABB) + 알베도(실제 색).  [cx,cy,cz, hx,hy,hz, r,g,b, isPanel]
const BOXES = [
  [0, -0.25, -5.5,  9, 0.25, 3.5,  0.81, 0.80, 0.84, 0],  // 바닥 A
  [0, -0.25,  5.5,  9, 0.25, 3.5,  0.81, 0.80, 0.84, 0],  // 바닥 B
  [0,  6,    0,    10, 0.2, 10,    0.86, 0.85, 0.89, 0],  // 천장
  [0,  3,   -9.2,  10, 3,   0.2,   0.86, 0.85, 0.89, 0],  // back
  [0,  3,    9.2,  10, 3,   0.2,   0.86, 0.85, 0.89, 0],  // front
  [-9.2, 3,  0,    0.2, 3,  10,    0.86, 0.85, 0.89, 0],  // left
  [ 9.2, 3,  0,    0.2, 3,  10,    0.86, 0.85, 0.89, 0],  // right
  [0,  1.6,  2.0,  3, 1.5,  0.15,  0.93, 0.92, 0.94, 1],  // 패널(동적 색)
];

export class DDGI {
  constructor(renderer, scene, camera, { enabled = false } = {}) {
    this.renderer = renderer; this.scene = scene; this.camera = camera;
    this.enabled = enabled;
    this.probePositions = []; this.probeCount = 0;
    this.debugMesh = null; this.debugMaterial = null; this.debugVisible = false;
    this.shBuffer = null; this.computeUpdate = null; this.giReady = false;
    this.uPanel = null;   // 패널 현재 색 uniform
    this.uFrame = null;   // 프레임 카운터(샘플 회전용)

    document.addEventListener('keydown', (e) => {
      if (e.code === 'KeyG' && this.debugMesh) {
        this.debugVisible = !this.debugVisible;
        this.debugMesh.visible = this.debugVisible;
      }
    });
  }

  async init() {
    this._buildProbeGrid();
    this._addDebugProbes();
    if (!this.enabled) { console.info('[DDGI] WebGPU 미지원 — 시각화만.'); return; }
    try {
      this._initGIBuffers();
      this.giReady = true;
      console.info(`[DDGI] M3 ready — probes=${this.probeCount}, rays=${NUM_RAYS}.`);
    } catch (err) {
      this.giReady = false;
      console.error('[DDGI] M3 init 실패 — GI off, 게임은 계속:', err);
    }
  }

  markDirty() {}
  // 칠한 색을 패널 radiance로 반영
  setPanelColor(hex) {
    if (!this.uPanel) return;
    const c = new THREE.Color(hex);
    this.uPanel.value.set(c.r, c.g, c.b);
  }

  update() {
    if (!this.enabled || !this.giReady) return;
    try {
      if (this.uFrame) this.uFrame.value = (this.uFrame.value + 1) % 4096;
      this.renderer.computeAsync(this.computeUpdate); // 매 프레임 누적
    } catch (err) {
      this.giReady = false;
      console.error('[DDGI] compute 실패 — GI off:', err);
    }
  }

  _buildProbeGrid() {
    this.probePositions.length = 0;
    const { min, max } = AREA;
    for (let x = 0; x < GRID.nx; x++)
      for (let y = 0; y < GRID.ny; y++)
        for (let z = 0; z < GRID.nz; z++) {
          const fx = GRID.nx > 1 ? x / (GRID.nx - 1) : 0.5;
          const fy = GRID.ny > 1 ? y / (GRID.ny - 1) : 0.5;
          const fz = GRID.nz > 1 ? z / (GRID.nz - 1) : 0.5;
          this.probePositions.push(new THREE.Vector3(
            THREE.MathUtils.lerp(min.x, max.x, fx),
            THREE.MathUtils.lerp(min.y, max.y, fy),
            THREE.MathUtils.lerp(min.z, max.z, fz),
          ));
        }
    this.probeCount = this.probePositions.length;
  }

  _initGIBuffers() {
    const count = this.probeCount;
    const SHC = SH_COEFFS;
    this.shBuffer = instancedArray(count * SHC, 'vec3');
    const shBuf = this.shBuffer;

    this.uPanel = uniform(new THREE.Vector3(0.9, 0.1, 0.1)); // 진단: 처음부터 빨강 // 초기 패널색
    this.uFrame = uniform(0);
    const uPanel = this.uPanel, uFrame = this.uFrame;

    const { nx: NX, ny: NY, nz: NZ } = GRID;
    const MIN = AREA.min, MAX = AREA.max;
    const NR = NUM_RAYS;
    const GA = Math.PI * (3.0 - Math.sqrt(5.0)); // 황금각

    // 박스 슬랩 교차 → 진입 t(>eps) 또는 1e9
    const boxHit = (ro, rd, c, h) => {
      const inv = vec3(1.0).div(rd);
      const t1 = c.sub(h).sub(ro).mul(inv);
      const t2 = c.add(h).sub(ro).mul(inv);
      const tmin = t1.min(t2), tmax = t1.max(t2);
      const tn = tmin.x.max(tmin.y).max(tmin.z);
      const tf = tmax.x.min(tmax.y).min(tmax.z);
      const hit = tf.greaterThanEqual(tn).and(tf.greaterThan(0.01));
      const t = tn.greaterThan(0.01).select(tn, tf);
      return hit.select(t, float(1e9));
    };

    // 광선 방향으로 최근접 박스 색(맞으면 알베도, 미스면 배경 약광)
    const traceColor = (ro, rd) => {
      const bestT = float(RAY_MAX).toVar();
      const col = vec3(0.04, 0.04, 0.05).toVar(); // 배경(약한 환경광)
      for (const B of BOXES) {
        const c = vec3(B[0], B[1], B[2]);
        const h = vec3(B[3], B[4], B[5]);
        const t = boxHit(ro, rd, c, h);
        const closer = t.lessThan(bestT);
        // 패널이면 동적 색, 아니면 고정 알베도
        const albedo = B[9] === 1 ? uPanel : vec3(B[6], B[7], B[8]);
        col.assign(closer.select(albedo, col));
        bestT.assign(t.min(bestT));
      }
      return col;
    };

    this.computeUpdate = Fn(() => {
      // 프로브 위치(인덱스 분해)
      const pf = instanceIndex.toFloat();
      const ix = pf.div(NY * NZ).floor();
      const rem = pf.sub(ix.mul(NY * NZ));
      const iy = rem.div(NZ).floor();
      const iz = rem.sub(iy.mul(NZ));
      const ro = vec3(
        float(MIN.x).add(ix.div(Math.max(1, NX - 1)).mul(MAX.x - MIN.x)),
        float(MIN.y).add(iy.div(Math.max(1, NY - 1)).mul(MAX.y - MIN.y)),
        float(MIN.z).add(iz.div(Math.max(1, NZ - 1)).mul(MAX.z - MIN.z)),
      );

      // 프레임마다 샘플 회전(시간에 따라 다른 방향 → 누적으로 수렴)
      const seed = pf.mul(1.7).add(uFrame.toFloat().mul(0.61803399));

      // 16방향 spherical Fibonacci 평균 radiance = irradiance(DC)
      const acc = vec3(0.0).toVar();
      Loop(NR, ({ i }) => {
        const fi = i.toFloat().add(0.5);
        // z: -1..1 균등, 황금각으로 경도
        const z = fi.div(float(NR)).mul(2.0).sub(1.0);
        const r = z.mul(z).oneMinus().max(0.0).sqrt();
        const phi = fi.mul(GA).add(seed);
        const dir = vec3(phi.cos().mul(r), z, phi.sin().mul(r));
        acc.addAssign(traceColor(ro, dir));
      });
      const sampled = acc.div(float(NR)); // 평균 = irradiance 근사

      // 시간 누적: DC = mix(old, sampled, ALPHA)
      const base = instanceIndex.mul(SHC);
      const oldDC = shBuf.element(base);
      shBuf.element(base).assign(oldDC.mix(sampled, float(ALPHA)));
      // L1 항은 M3에선 미사용(0 유지) — M4 주입 때 방향성 추가 가능
    })().compute(count);

    // 디버그 점 색 = irradiance(DC)
    this.debugMaterial.colorNode = shBuf.element(instanceIndex.mul(SHC));
  }

  _addDebugProbes() {
    const g = new THREE.SphereGeometry(0.12, 10, 10);
    const m = new THREE.MeshBasicNodeMaterial({ color: new THREE.Color('#8fe3ff') });
    this.debugMaterial = m;
    const inst = new THREE.InstancedMesh(g, m, this.probeCount);
    const mat4 = new THREE.Matrix4();
    this.probePositions.forEach((p, i) => { mat4.makeTranslation(p.x, p.y, p.z); inst.setMatrixAt(i, mat4); });
    inst.instanceMatrix.needsUpdate = true;
    inst.frustumCulled = false;
    inst.visible = this.debugVisible;
    this.debugMesh = inst;
    this.scene.add(inst);
  }
}
