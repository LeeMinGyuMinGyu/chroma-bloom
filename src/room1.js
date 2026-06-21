// src/room1.js
// 튜토리얼 방: "정면 패널을 빨강으로 칠하면 빛의 다리가 생겨 틈을 건넌다."
import * as THREE from 'three/webgpu';
import { COLORS } from './paint.js';

function box(w, h, d, colorHex, opts = {}) {
  const mat = new THREE.MeshStandardNodeMaterial({
    color: new THREE.Color(colorHex),
    roughness: opts.roughness ?? 0.9,
    metalness: 0.0,
  });
  if (opts.emissive) { mat.emissive = new THREE.Color(opts.emissive); mat.emissiveIntensity = opts.emissiveIntensity ?? 0; }
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  return mesh;
}

export function setupRoom1(scene, camera) {
  const group = new THREE.Group();
  scene.add(group);

  // --- 두 플랫폼 (사이에 틈) ---
  const platA = box(18, 0.5, 7, '#2a2733'); platA.position.set(0, -0.25, -5.5); group.add(platA);
  const platB = box(18, 0.5, 7, '#2a2733'); platB.position.set(0, -0.25, 5.5); group.add(platB);

  // --- 둘러싸는 벽 (시각용, 칠하기 대상 아님) ---
  const wallMatHex = '#34313f';
  const back = box(20, 6, 0.4, wallMatHex); back.position.set(0, 3, -9.2); group.add(back);
  const front = box(20, 6, 0.4, wallMatHex); front.position.set(0, 3, 9.2); group.add(front);
  const left = box(0.4, 6, 20, wallMatHex); left.position.set(-9.2, 3, 0); group.add(left);
  const right = box(0.4, 6, 20, wallMatHex); right.position.set(9.2, 3, 0); group.add(right);

  // --- 칠할 수 있는 정면 패널 (빨강 → 다리) ---
  const panel = box(6, 3, 0.3, '#4a4658', { roughness: 0.8 });
  panel.position.set(0, 1.6, 2.0);
  panel.userData.role = 'bridgeWall';
  group.add(panel);

  // --- 빛의 다리 타일 (처음엔 숨김) ---
  const tiles = [];
  const zs = [-1.5, -0.5, 0.5, 1.5];
  for (const z of zs) {
    const t = box(4, 0.35, 0.9, '#201d28', { emissive: '#ef7d7d', emissiveIntensity: 0 });
    t.position.set(0, 0.0, z);
    t.visible = false;
    group.add(t);
    tiles.push(t);
  }

  // --- 출구 패드 ---
  const exit = box(2.4, 0.08, 2.4, '#3a3645', { emissive: '#efd97d', emissiveIntensity: 0.5 });
  exit.position.set(0, 0.05, 6.5);
  group.add(exit);

  // --- PLACEHOLDER: GI 바운스 대용 라이트 (DDGI 완성 시 제거) ---
  let bounce = null;

  const state = { bridgeActive: false, cleared: false, _glow: 0 };

  function onPaint(mesh, colorName /*, scene */) {
    if (mesh.userData.role === 'bridgeWall' && colorName === 'red' && !state.bridgeActive) {
      state.bridgeActive = true;

      // 패널 자체를 빨갛게 빛나게
      mesh.material.emissive = new THREE.Color(COLORS.red);
      mesh.material.emissiveIntensity = 0.7;

      // 다리 타일 노출 (update에서 서서히 밝아짐)
      tiles.forEach((t) => { t.visible = true; });

      // ▼▼ PLACEHOLDER 간접광 — 실제 DDGI 간접광으로 교체할 것 (src/gi/ddgi.js) ▼▼
      bounce = new THREE.PointLight(COLORS.red.clone(), 0, 14, 2.0);
      bounce.position.set(0, 1.6, 1.2);
      scene.add(bounce);
      // ▲▲ PLACEHOLDER 끝 ▲▲
    }
  }

  function update(dt) {
    // 다리/바운스 글로우 인
    if (state.bridgeActive && state._glow < 1) {
      state._glow = Math.min(1, state._glow + dt * 1.5);
      const g = state._glow;
      tiles.forEach((t) => { t.material.emissiveIntensity = 1.2 * g; });
      if (bounce) bounce.intensity = 4.5 * g; // PLACEHOLDER
    }

    // 클리어 판정: 다리 활성 + 건너편에서 출구 도달
    if (!state.cleared && state.bridgeActive && camera) {
      const p = camera.position;
      if (p.z > 2 && Math.hypot(p.x - exit.position.x, p.z - exit.position.z) < 1.8) {
        state.cleared = true;
      }
    }
  }

  return {
    group,
    paintables: [panel],          // 칠하기 대상
    spawn: { x: 0, z: -6 },
    bounds: { minX: -8, maxX: 8, minZ: -8.5, maxZ: 8.5 },
    gap: { from: -2, to: 2 },     // 다리 비활성 시 z>from 진입 차단
    state,
    onPaint,
    update,
  };
}
