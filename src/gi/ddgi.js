// src/gi/ddgi.js  — M3 (16방향 SF + SH L1 누적 + 시간 수렴 + 동적 패널색)
// =============================================================================
// [M1] 파이프라인 ✓  [M2] 레이마칭 ✓  →  [M3] 다방향+SH+시간누적+동적 ←지금
//      [M4] 머티리얼 셰이딩 주입(실제로 벽에 번지게) — 다음
//
// 패널색: CPU-쓰기 가능한 StorageInstancedBufferAttribute(1 vec3)로 보관.
//   setPanelColor가 array에 쓰고 needsUpdate=true → 매 프레임 컴퓨트가 element(0) 읽음.
//   (uniform 런타임 변경이 컴퓨트에 반영 안 되는 문제 회피)
// =============================================================================

import * as THREE from 'three/webgpu';
import { Fn, instancedArray, storage, instanceIndex, vec3, float, Loop, uniform, positionWorld } from 'three/tsl';

const GRID = { nx: 7, ny: 4, nz: 7 };
const AREA = { min: new THREE.Vector3(-8, 0.4, -8), max: new THREE.Vector3(8, 5.4, 8) };
const SH_COEFFS = 4;
const NUM_RAYS = 16;
const ALPHA = 0.08;
const RAY_MAX = 40.0;
const INJECT_STRENGTH = 0.7; // 간접광 주입 세기(흰 방이라 약하게 시작)

// [cx,cy,cz, hx,hy,hz, r,g,b, isPanel]
const BOXES = [
  [0, -0.25, -5.5,  9, 0.25, 3.5,  0.81, 0.80, 0.84, 0],
  [0, -0.25,  5.5,  9, 0.25, 3.5,  0.81, 0.80, 0.84, 0],
  [0,  6,    0,    10, 0.2, 10,    0.86, 0.85, 0.89, 0],
  [0,  3,   -9.2,  10, 3,   0.2,   0.86, 0.85, 0.89, 0],
  [0,  3,    9.2,  10, 3,   0.2,   0.86, 0.85, 0.89, 0],
  [-9.2, 3,  0,    0.2, 3,  10,    0.86, 0.85, 0.89, 0],
  [ 9.2, 3,  0,    0.2, 3,  10,    0.86, 0.85, 0.89, 0],
  [0,  1.6,  2.0,  3, 1.5,  0.15,  0.93, 0.92, 0.94, 1],  // 패널(동적)
];

export class DDGI {
  constructor(renderer, scene, camera, { enabled = false } = {}) {
    this.renderer = renderer; this.scene = scene; this.camera = camera;
    this.enabled = enabled;
    this.probePositions = []; this.probeCount = 0;
    this.debugMesh = null; this.debugMaterial = null; this.debugVisible = false;
    this.shBuffer = null; this.computeUpdate = null; this.giReady = false;
    this.panelAttr = null;  // CPU-쓰기 가능한 패널색 attribute
    this.uFrame = null;
    this.uInject = null;    // 주입 On/Off (H키)
    this.injected = false;

    document.addEventListener('keydown', (e) => {
      if (e.code === 'KeyG' && this.debugMesh) {
        this.debugVisible = !this.debugVisible;
        this.debugMesh.visible = this.debugVisible;
      }
      if (e.code === 'KeyH' && this.uInject) {
        this.uInject.value = this.uInject.value > 0.5 ? 0.0 : 1.0; // 주입 On/Off
      }
    });
  }

  async init() {
    this._buildProbeGrid();
    this._addDebugProbes();
    if (!this.enabled) { console.info('[DDGI] WebGPU 미지원 — 시각화만.'); return; }
    try {
      this._initGIBuffers();
      this._injectIntoScene();   // [M4] 벽·바닥 머티리얼에 간접광 주입
      this.giReady = true;
      console.info(`[DDGI] M4 ready — probes=${this.probeCount}, rays=${NUM_RAYS}, injected=${this.injected}.`);
    } catch (err) {
      this.giReady = false;
      console.error('[DDGI] M3 init 실패 — GI off, 게임은 계속:', err);
    }
  }

  markDirty() {}

  setPanelColor(hex) {
    if (!this.panelAttr) return;
    const c = new THREE.Color(hex);
    this.panelAttr.array[0] = c.r;
    this.panelAttr.array[1] = c.g;
    this.panelAttr.array[2] = c.b;
    this.panelAttr.needsUpdate = true; // CPU→GPU 재업로드
  }

  update() {
    if (!this.enabled || !this.giReady) return;
    try {
      if (this.uFrame) this.uFrame.value = (this.uFrame.value + 1) % 4096;
      this.renderer.computeAsync(this.computeUpdate);
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

    // 패널색: CPU-쓰기 가능한 1-요소 vec3 스토리지
    this.panelAttr = new THREE.StorageInstancedBufferAttribute(new Float32Array([0.93, 0.92, 0.94]), 3);
    const panelBuf = storage(this.panelAttr, 'vec3', 1);

    this.uFrame = uniform(0);
    const uFrame = this.uFrame;

    const { nx: NX, ny: NY, nz: NZ } = GRID;
    const MIN = AREA.min, MAX = AREA.max;
    const NR = NUM_RAYS;
    const GA = Math.PI * (3.0 - Math.sqrt(5.0));

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

    const traceColor = (ro, rd) => {
      const bestT = float(RAY_MAX).toVar();
      const col = vec3(0.04, 0.04, 0.05).toVar();
      for (const B of BOXES) {
        const c = vec3(B[0], B[1], B[2]);
        const h = vec3(B[3], B[4], B[5]);
        const t = boxHit(ro, rd, c, h);
        const closer = t.lessThan(bestT);
        const albedo = B[9] === 1 ? panelBuf.element(0) : vec3(B[6], B[7], B[8]);
        col.assign(closer.select(albedo, col));
        bestT.assign(t.min(bestT));
      }
      return col;
    };

    this.computeUpdate = Fn(() => {
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

      const seed = pf.mul(1.7).add(uFrame.toFloat().mul(0.61803399));

      const acc = vec3(0.0).toVar();
      Loop(NR, ({ i }) => {
        const fi = i.toFloat().add(0.5);
        const z = fi.div(float(NR)).mul(2.0).sub(1.0);
        const r = z.mul(z).oneMinus().max(0.0).sqrt();
        const phi = fi.mul(GA).add(seed);
        const dir = vec3(phi.cos().mul(r), z, phi.sin().mul(r));
        acc.addAssign(traceColor(ro, dir));
      });
      const sampled = acc.div(float(NR));

      const base = instanceIndex.mul(SHC);
      const oldDC = shBuf.element(base);
      shBuf.element(base).assign(oldDC.mix(sampled, float(ALPHA)));
    })().compute(count);

    this.debugMaterial.colorNode = shBuf.element(instanceIndex.mul(SHC));
  }


  // [M4] 프로브 irradiance(DC)를 8-probe trilinear 로 샘플해 벽·바닥 emissive에 가산.
  _injectIntoScene() {
    const shBuf = this.shBuffer;
    const SHC = SH_COEFFS;
    const { nx: NX, ny: NY, nz: NZ } = GRID;
    const MIN = AREA.min, MAX = AREA.max;
    const cellx = (MAX.x - MIN.x) / Math.max(1, NX - 1);
    const celly = (MAX.y - MIN.y) / Math.max(1, NY - 1);
    const cellz = (MAX.z - MIN.z) / Math.max(1, NZ - 1);

    this.uInject = uniform(1.0); // 시작 ON
    const uInject = this.uInject;

    // 정수 격자좌표(ix,iy,iz)의 프로브 DC 읽기
    const dcAt = (ixf, iyf, izf) => {
      const idx = ixf.mul(NY * NZ).add(iyf.mul(NZ)).add(izf).toInt();
      return shBuf.element(idx.mul(SHC));
    };

    // 픽셀 월드좌표 → 8-probe trilinear irradiance
    const gx = positionWorld.x.sub(MIN.x).div(cellx).clamp(0.0, NX - 1 - 1e-3);
    const gy = positionWorld.y.sub(MIN.y).div(celly).clamp(0.0, NY - 1 - 1e-3);
    const gz = positionWorld.z.sub(MIN.z).div(cellz).clamp(0.0, NZ - 1 - 1e-3);
    const i0x = gx.floor(), i0y = gy.floor(), i0z = gz.floor();
    const fx = gx.sub(i0x), fy = gy.sub(i0y), fz = gz.sub(i0z);
    const i1x = i0x.add(1.0), i1y = i0y.add(1.0), i1z = i0z.add(1.0);

    const c000 = dcAt(i0x, i0y, i0z), c100 = dcAt(i1x, i0y, i0z);
    const c010 = dcAt(i0x, i1y, i0z), c110 = dcAt(i1x, i1y, i0z);
    const c001 = dcAt(i0x, i0y, i1z), c101 = dcAt(i1x, i0y, i1z);
    const c011 = dcAt(i0x, i1y, i1z), c111 = dcAt(i1x, i1y, i1z);

    const x00 = c000.mix(c100, fx), x10 = c010.mix(c110, fx);
    const x01 = c001.mix(c101, fx), x11 = c011.mix(c111, fx);
    const y0 = x00.mix(x10, fy), y1 = x01.mix(x11, fy);
    const irr = y0.mix(y1, fz).clamp(0.0, 1.0);

    const indirect = irr.mul(float(INJECT_STRENGTH)).mul(uInject);

    // 대상: 큰 디퓨즈 면(바닥/벽/천장). emissive 역할이 있는 것(타일/출구/패널)은 제외.
    let n = 0;
    this.scene.traverse((o) => {
      if (!o.isMesh) return;
      if (!(o.userData && o.userData.gi)) return;   // gi 태그 면만 주입(바닥/벽/천장)
      const m = o.material;
      if (!m) return;
      m.emissiveNode = indirect;                    // 기존 직접광 위에 간접광 가산
      m.needsUpdate = true;
      n++;
    });
    this.injected = n > 0;
    console.info(`[DDGI] inject → ${n} surfaces (H키로 On/Off).`);
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
