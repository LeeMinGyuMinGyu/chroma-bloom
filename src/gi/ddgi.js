// src/gi/ddgi.js
// =============================================================================
// DDGI (Dynamic Diffuse Global Illumination) 레이어 — 골격(SCAFFOLD)
// -----------------------------------------------------------------------------
// 이 파일은 "게임을 절대 깨지 않는" additive 레이어다.
//  - WebGPU 미지원이거나 아직 미완성이면 => 안전한 no-op (게임은 기본 라이팅으로 구동).
//  - GI 점수(20점)를 위해서는 아래 TODO를 채워 "프로브 기반 동적 간접광"을 완성한다.
//
// ⚠ 이 코드는 브라우저/GPU에서 검증되지 않았다. 컴퓨트 셰이더는 반드시
//   최신 Chrome에서 직접 실행하며 단계별로 디버깅(프로브 시각화부터)하라.
//
// ── DDGI 핵심 (Majercik et al. 2019) ────────────────────────────────────────
//  1) 씬에 프로브를 3D 그리드로 배치한다(아래 _buildProbeGrid가 위치를 만든다).
//  2) 매 프레임 일부 프로브에서 광선을 쏴 씬과 교차시키고, 교차점의
//     (직접광 + 알베도)를 모아 그 프로브의 irradiance를 갱신한다.
//     · 원논문은 하드웨어 레이트레이싱 사용. 웹(WebGPU)엔 HW RT가 없으므로
//       두 가지 현실적 대안 중 하나를 택한다:
//         (A) SDF 레이마칭: 방을 박스 SDF로 표현하고 컴퓨트에서 마칭(작은 씬에 적합).
//         (B) 큐브 캡처: 각 프로브 위치에서 작은 큐브맵을 렌더 → irradiance로 컨볼브.
//  3) irradiance는 프로브당 옥타헤드럴(octahedral) 맵으로 텍스처 아틀라스에 저장,
//     시간 누적(temporal blend)으로 노이즈/깜빡임을 줄인다.
//  4) 셰이딩 시 각 픽셀을 둘러싼 8개 프로브(probe cage)를 trilinear 보간해
//     표면 노멀 방향의 irradiance를 얻고, (알베도 * irradiance)를 간접광으로 더한다.
//     (누수 방지를 위해 visibility/거리 항을 함께 저장하면 좋다 — 1차 구현에선 생략 가능,
//      대신 "단면 벽 누수"는 알려진 한계로 리포트에 명시.)
//
// ── 본 게임에서의 의미(리포트 논거) ─────────────────────────────────────────
//  플레이어가 칠한 면의 알베도가 바뀌면, (2)에서 모이는 색이 달라지고 (3)(4)를 통해
//  주변으로 "번진다". 즉 칠한 색의 간접광이 곧 퍼즐 신호다. markDirty()는 그 변화를
//  알려 프로브를 더 적극적으로 재수렴시키는 훅이다.
//
// ── 검증된 레퍼런스 ─────────────────────────────────────────────────────────
//  · McGuire 외, DDGI 개요/알고리즘:  https://morgan3d.github.io/articles/2019-04-01-ddgi/
//  · NVIDIA RTXGI-DDGI (HLSL 알고리즘 문서): github.com/NVIDIAGameWorks/RTXGI-DDGI
//  · 학생 구현 예(Vulkan, 읽기 좋음):        github.com/helenl9098/Dynamic-Diffuse-Global-Illumination-Minecraft
//  · three.js WebGPU 컴퓨트 셰이더(TSL) 작성법: three.js 매뉴얼 "WebGPURenderer" + TSL compute
// =============================================================================

import * as THREE from 'three/webgpu';

// 프로브 그리드 설정 — 방이 작으니 작게 시작(부하↓). 동작 확인 후 밀도를 올린다.
const GRID = { nx: 8, ny: 4, nz: 8 };          // 프로브 개수
const AREA = { min: new THREE.Vector3(-9, 0.3, -9), max: new THREE.Vector3(9, 5.5, 9) };

export class DDGI {
  constructor(renderer, scene, camera, { enabled = false } = {}) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.enabled = enabled;
    this.dirty = true;
    this.probePositions = [];   // Vector3[]
    this.debugMesh = null;      // 프로브 시각화(디버그)
  }

  async init() {
    if (!this.enabled) {
      console.info('[DDGI] disabled (WebGPU 미지원 또는 비활성). 기본 라이팅으로 구동.');
      return;
    }
    this._buildProbeGrid();

    // TODO(1): 프로브 데이터 텍스처/스토리지 버퍼 생성
    //   - irradiance 아틀라스 (예: 프로브당 옥타 6x6, 1px 보더 → 8x8 타일)
    //   - (선택) visibility/거리 아틀라스
    // TODO(2): 갱신 컴퓨트 패스 구성 (대안 A 또는 B)
    // TODO(3): 씬 머티리얼에 간접광 노드 주입
    //   - MeshStandardNodeMaterial 의 lighting/output 노드에 (albedo * sampledIrradiance) 가산
    //   - 픽셀 월드좌표로 8프로브 trilinear 샘플 (TSL 노드로 작성)

    // (디버그) 프로브 위치를 작은 점으로 그려 그리드부터 눈으로 확인하는 것을 강력 권장.
    // this._addDebugProbes();

    console.info(`[DDGI] scaffold ready — probes=${this.probePositions.length} (구현 TODO 채우기 필요).`);
  }

  // 칠하기 등으로 씬 라이팅이 바뀌면 호출 → 프로브를 더 빨리 재수렴시키는 신호로 사용
  markDirty() { this.dirty = true; }

  update(/* dt */) {
    if (!this.enabled) return;
    // TODO(2-run): 매 프레임 일부 프로브 갱신(라운드로빈) + 시간 누적.
    //   - this.dirty 면 한 번에 더 많은 프로브를 갱신해 빠르게 수렴시킨 뒤 this.dirty=false.
    //   - 컴퓨트 디스패치는 renderer.computeAsync(node) 형태로 호출(TSL compute).
  }

  _buildProbeGrid() {
    this.probePositions.length = 0;
    const { min, max } = AREA;
    for (let x = 0; x < GRID.nx; x++) {
      for (let y = 0; y < GRID.ny; y++) {
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
    }
  }

  // 디버그: 프로브 위치를 점으로 (구현 시작 시 그리드 확인용 — 리포트 캡쳐로도 좋음)
  _addDebugProbes() {
    const g = new THREE.SphereGeometry(0.06, 8, 8);
    const m = new THREE.MeshBasicNodeMaterial({ color: new THREE.Color('#ffffff') });
    const inst = new THREE.InstancedMesh(g, m, this.probePositions.length);
    const mat4 = new THREE.Matrix4();
    this.probePositions.forEach((p, i) => { mat4.makeTranslation(p.x, p.y, p.z); inst.setMatrixAt(i, mat4); });
    this.debugMesh = inst;
    this.scene.add(inst);
  }
}
