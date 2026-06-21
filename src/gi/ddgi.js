// src/gi/ddgi.js  — M2 (SDF 레이마칭: 프로브가 아래 방향으로 씬을 1회 샘플)
// =============================================================================
// [M1] 파이프라인 ✓  →  [M2] 아래로 광선 + 박스 SDF 교차 → 그 면의 색 ←지금
//      [M3] 다방향 SF 샘플 + SH 누적 + 시간 수렴 + 칠한 색 반영
//
// M2 합격(디버그 색은 검증용으로 일부러 구분되게):
//   · 두 바닥(platA/B) 위 프로브 → 초록
//   · 가운데 틈(z:-2..2) 위 프로브 → 어두움(아무것도 못 맞힘)
//   · 패널 바로 위 프로브 → 빨강
// (M3에서 실제 알베도/다방향/누적으로 교체)
// =============================================================================

import * as THREE from 'three/webgpu';
import { Fn, instancedArray, instanceIndex, vec3, float } from 'three/tsl';

const GRID = { nx: 7, ny: 4, nz: 7 };
const AREA = { min: new THREE.Vector3(-8, 0.4, -8), max: new THREE.Vector3(8, 5.4, 8) };
const SH_COEFFS = 4;

// 씬 박스(AABB) + M2 검증용 색.  [cx,cy,cz, hx,hy,hz, r,g,b]
const BOXES = [
  [0, -0.25, -5.5,  9, 0.25, 3.5,  0.2, 0.8, 0.3],  // 바닥 A  → 초록
  [0, -0.25,  5.5,  9, 0.25, 3.5,  0.2, 0.8, 0.3],  // 바닥 B  → 초록
  [0,  1.6,   2.0,  3, 1.5,  0.15, 0.9, 0.2, 0.2],  // 패널    → 빨강
];

export class DDGI {
  constructor(renderer, scene, camera, { enabled = false } = {}) {
    this.renderer = renderer; this.scene = scene; this.camera = camera;
    this.enabled = enabled; this.dirty = true;
    this.probePositions = []; this.probeCount = 0;
    this.debugMesh = null; this.debugMaterial = null; this.debugVisible = false;
    this.shBuffer = null; this.computeUpdate = null; this.giReady = false;

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
      await this.renderer.computeAsync(this.computeUpdate);
      this.giReady = true;
      console.info(`[DDGI] M2 OK — probes=${this.probeCount}, boxes=${BOXES.length}.`);
    } catch (err) {
      this.giReady = false;
      console.error('[DDGI] M2 init 실패 — GI off, 게임은 계속:', err);
    }
  }

  markDirty() { this.dirty = true; }
  update() { /* M2 정적 */ }

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

    const { nx: NX, ny: NY, nz: NZ } = GRID;
    const MIN = AREA.min, MAX = AREA.max;

    // 박스 슬랩 교차(노드 식): 진입 t>eps 반환, 없으면 1e9
    const boxHit = (ro, rd, c, h) => {
      const inv = vec3(1.0).div(rd);
      const t1 = c.sub(h).sub(ro).mul(inv);
      const t2 = c.add(h).sub(ro).mul(inv);
      const tmin = t1.min(t2), tmax = t1.max(t2);
      const tn = tmin.x.max(tmin.y).max(tmin.z);
      const tf = tmax.x.min(tmax.y).min(tmax.z);
      const hit = tf.greaterThanEqual(tn).and(tf.greaterThan(0.001));
      const t = tn.greaterThan(0.001).select(tn, tf);
      return hit.select(t, float(1e9));
    };

    this.computeUpdate = Fn(() => {
      // 프로브 인덱스 → (ix,iy,iz)  (float floor 분해: 정수나눗셈 이슈 회피)
      const pf = instanceIndex.toFloat();
      const ix = pf.div(NY * NZ).floor();
      const rem = pf.sub(ix.mul(NY * NZ));
      const iy = rem.div(NZ).floor();
      const iz = rem.sub(iy.mul(NZ));
      const fx = ix.div(Math.max(1, NX - 1));
      const fy = iy.div(Math.max(1, NY - 1));
      const fz = iz.div(Math.max(1, NZ - 1));
      const ro = vec3(
        float(MIN.x).add(fx.mul(MAX.x - MIN.x)),
        float(MIN.y).add(fy.mul(MAX.y - MIN.y)),
        float(MIN.z).add(fz.mul(MAX.z - MIN.z)),
      );

      // 거의 수직 아래 광선(0 성분 NaN 회피용으로 x,z 살짝)
      const rd = vec3(0.0001, -1.0, 0.0001);

      const bestT = float(1e9).toVar();
      const albedo = vec3(0.05, 0.05, 0.07).toVar(); // 미스 = 어두움

      for (const B of BOXES) {
        const c = vec3(B[0], B[1], B[2]);
        const h = vec3(B[3], B[4], B[5]);
        const t = boxHit(ro, rd, c, h);
        const closer = t.lessThan(bestT);
        albedo.assign(closer.select(vec3(B[6], B[7], B[8]), albedo));
        bestT.assign(t.min(bestT));
      }

      const base = instanceIndex.mul(SHC);
      shBuf.element(base).assign(albedo);
      shBuf.element(base.add(1)).assign(vec3(0));
      shBuf.element(base.add(2)).assign(vec3(0));
      shBuf.element(base.add(3)).assign(vec3(0));
    })().compute(count);

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
