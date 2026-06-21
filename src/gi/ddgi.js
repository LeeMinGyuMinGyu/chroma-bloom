// src/gi/ddgi.js  — M1 (파이프라인 검증)
// =============================================================================
// DDGI 레이어 (게임을 절대 깨지 않는 additive 레이어)
//  - [B] 프로브 그리드 시각화: 항상 동작. G키 토글.
//  - [C-M1] 프로브 SH 버퍼 생성 + 컴퓨트가 "위치 기반 그라데이션 색"을 SH0에 기록
//           → 디버그 점 색에 반영. 점들이 무지개처럼 인덱스순 그라데이션이면 M1 통과.
//  - 다음: M2(SDF 레이마칭으로 실제 씬 색), M3(다방향 SH 누적 + 시간 수렴).
//
// SH 표현: per-probe 4계수(L1) × RGB. 버퍼 = 프로브당 vec3 4개 연속.
//   slot = probe*SH_COEFFS + c   (c: 0=DC, 1..3=L1)
// =============================================================================

import * as THREE from 'three/webgpu';
import { Fn, instancedArray, instanceIndex, vec3, float } from 'three/tsl';

const GRID = { nx: 7, ny: 4, nz: 7 };
const AREA = { min: new THREE.Vector3(-8, 0.4, -8), max: new THREE.Vector3(8, 5.4, 8) };
const SH_COEFFS = 4; // L1

export class DDGI {
  constructor(renderer, scene, camera, { enabled = false } = {}) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.enabled = enabled;
    this.dirty = true;
    this.probePositions = [];
    this.probeCount = 0;
    this.debugMesh = null;
    this.debugMaterial = null;
    this.debugVisible = false;

    this.shBuffer = null;       // instancedArray: probeCount*SH_COEFFS vec3
    this.computeUpdate = null;  // 컴퓨트 노드
    this.giReady = false;

    document.addEventListener('keydown', (e) => {
      if (e.code === 'KeyG' && this.debugMesh) {
        this.debugVisible = !this.debugVisible;
        this.debugMesh.visible = this.debugVisible;
      }
    });
  }

  async init() {
    this._buildProbeGrid();
    this._addDebugProbes();          // debugMaterial 생성됨

    if (!this.enabled) {
      console.info('[DDGI] WebGPU 미지원 — 프로브 시각화만(컴퓨트 GI 비활성).');
      return;
    }

    try {
      this._initGIBuffers();         // SH 버퍼 + 컴퓨트 노드 + 디버그 색 주입
      await this.renderer.computeAsync(this.computeUpdate); // M1: 1회만 실행
      this.giReady = true;
      console.info(`[DDGI] M1 OK — probes=${this.probeCount}, SH slots=${this.probeCount * SH_COEFFS}.`);
    } catch (err) {
      this.giReady = false;
      console.error('[DDGI] M1 init 실패 — GI off, 게임은 계속:', err);
    }
  }

  markDirty() { this.dirty = true; }

  update(/* dt */) {
    // M1은 정적 테스트라 매 프레임 갱신 불필요. (M3에서 라운드로빈+누적 도입)
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
    this.shBuffer = instancedArray(count * SH_COEFFS, 'vec3');
    const SHC = SH_COEFFS;
    const COUNT_F = float(count);

    // [M1 컴퓨트] 프로브당 1스레드. 인덱스 기반 그라데이션 색을 DC(SH0)에 기록.
    this.computeUpdate = Fn(() => {
      const p = instanceIndex;                  // 0..count-1
      const base = p.mul(SHC);                   // 이 프로브의 첫 슬롯
      const t = p.toFloat().div(COUNT_F);        // 0..1 그라데이션
      const col = vec3(t, t.oneMinus(), float(0.6));

      this.shBuffer.element(base).assign(col);          // DC = 색
      this.shBuffer.element(base.add(1)).assign(vec3(0)); // L1 = 0
      this.shBuffer.element(base.add(2)).assign(vec3(0));
      this.shBuffer.element(base.add(3)).assign(vec3(0));
    })().compute(count);

    // 디버그 점 색 = 해당 프로브의 SH0 (instanceIndex = 프로브 인덱스)
    this.debugMaterial.colorNode = this.shBuffer.element(instanceIndex.mul(SHC));
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
