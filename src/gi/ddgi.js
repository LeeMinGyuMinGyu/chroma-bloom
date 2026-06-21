// src/gi/ddgi.js
// =============================================================================
// DDGI (Dynamic Diffuse Global Illumination) 레이어
// -----------------------------------------------------------------------------
// 이 파일은 "게임을 절대 깨지 않는" additive 레이어다.
//  - [B] 프로브 그리드 시각화: WebGPU 여부와 무관하게 항상 동작(리포트 캡쳐용). G키로 토글.
//  - [C] 프로브 기반 동적 간접광(SH): 아래 TODO. WebGPU 컴퓨트에서 구현/디버깅.
//
// ── DDGI 핵심 (강의 개념사전 용어로 정리) ───────────────────────────────────
//  1) Probe: 월드 공간 3D 격자에 프로브를 배치한다(_buildProbeGrid). 빈 공간에도 존재.
//  2) 광선 캡처: 각 프로브에서 Spherical Fibonacci 분포 + cosine-weighted hemisphere
//     표본화로 광선을 쏴 교차점의 (직접광 + 알베도) radiance를 모은다.
//       · 웹엔 HW 레이트레이싱이 없으므로 (A) 박스 SDF 레이마칭 또는 (B) 큐브 캡처로 대체.
//  3) 저장(SH): 프로브별 radiance를 Spherical Harmonics 계수로 저장.
//  4) 재사용(Recursive Feedback): 저장된 프로브 조명을 다시 광선에 사용 → 무한 바운스 누적.
//  5) 셰이딩: 표면 점에서 8-Probe Trilinear Interpolation 으로 간접 irradiance를 구해
//     (albedo * irradiance)를 간접광으로 더한다.
//  · 한계: Light Leak(격자 간격 < 구조), 디퓨즈 한정.
//
// ── 본 게임에서의 의미 ───────────────────────────────────────────────────────
//  플레이어가 칠한 면의 알베도가 바뀌면 (2)에서 모이는 색이 달라지고 (3)(5)로 주변에 번진다.
//  markDirty()는 그 변화를 알려 프로브를 더 빨리 재수렴시키는 훅이다.
//
// ── 검증된 레퍼런스 ─────────────────────────────────────────────────────────
//  · McGuire 외 DDGI 개요:  https://morgan3d.github.io/articles/2019-04-01-ddgi/
//  · NVIDIA RTXGI-DDGI:      github.com/NVIDIAGameWorks/RTXGI-DDGI
//  · 학생 구현(Vulkan):      github.com/helenl9098/Dynamic-Diffuse-Global-Illumination-Minecraft
// =============================================================================

import * as THREE from 'three/webgpu';

// 프로브 그리드 설정 — 방이 작으니 작게 시작(부하↓).
const GRID = { nx: 7, ny: 4, nz: 7 };
const AREA = { min: new THREE.Vector3(-8, 0.4, -8), max: new THREE.Vector3(8, 5.4, 8) };

export class DDGI {
  constructor(renderer, scene, camera, { enabled = false } = {}) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.enabled = enabled;       // WebGPU 사용 가능 여부(=컴퓨트 GI 가능)
    this.dirty = true;
    this.probePositions = [];
    this.debugMesh = null;
    this.debugVisible = true;

    // G 키: 프로브 그리드 시각화 토글 (리포트 On/Off 캡쳐용)
    document.addEventListener('keydown', (e) => {
      if (e.code === 'KeyG' && this.debugMesh) {
        this.debugVisible = !this.debugVisible;
        this.debugMesh.visible = this.debugVisible;
      }
    });
  }

  async init() {
    this._buildProbeGrid();
    this._addDebugProbes();   // [B] 항상 시각화 (WebGPU 없어도 보임)

    if (!this.enabled) {
      console.info('[DDGI] WebGPU 미지원 — 프로브 시각화만 표시(컴퓨트 GI 비활성).');
      return;
    }

    // [C] TODO(SH 기반 동적 GI):
    // TODO(1): 프로브 SH 계수 저장용 스토리지 버퍼/텍스처 생성.
    // TODO(2): 갱신 컴퓨트 패스 — Spherical Fibonacci 광선 × SDF 레이마칭 → radiance → SH 누적.
    // TODO(3): MeshStandardNodeMaterial 에 간접광 노드 주입 — 8-probe trilinear 로 irradiance 샘플.
    console.info(`[DDGI] probes=${this.probePositions.length} — 시각화 ON. 컴퓨트 GI는 TODO.`);
  }

  markDirty() { this.dirty = true; }

  update(/* dt */) {
    if (!this.enabled) return;
    // TODO(2-run): 매 프레임 일부 프로브 갱신(라운드로빈) + 시간 누적.
    //   this.dirty 면 더 많이 갱신해 빠르게 수렴 후 this.dirty=false.
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
  }

  // 프로브 위치를 작은 발광 점으로 표시(언릿이라 조명과 무관하게 보임).
  _addDebugProbes() {
    const g = new THREE.SphereGeometry(0.08, 10, 10);
    const m = new THREE.MeshBasicNodeMaterial({ color: new THREE.Color('#8fe3ff') });
    const inst = new THREE.InstancedMesh(g, m, this.probePositions.length);
    const mat4 = new THREE.Matrix4();
    this.probePositions.forEach((p, i) => { mat4.makeTranslation(p.x, p.y, p.z); inst.setMatrixAt(i, mat4); });
    inst.instanceMatrix.needsUpdate = true;
    inst.frustumCulled = false;
    inst.visible = this.debugVisible;
    this.debugMesh = inst;
    this.scene.add(inst);
  }
}
