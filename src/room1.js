// src/room1.js
// 흰(고알베도) 방: 정면 흰 패널을 빨강으로 칠하면 빛의 다리가 생겨 틈을 건넌다.
// 흰 바탕이라 칠한 색의 간접광(번짐)이 또렷하게 보인다 → GI 쇼케이스에 유리.
import * as THREE from 'three/webgpu';
import { COLORS } from './paint.js';

function box(w, h, d, colorHex, opts = {}) {
  const mat = new THREE.MeshStandardNodeMaterial({
    color: new THREE.Color(colorHex),
    roughness: opts.roughness ?? 0.95,
    metalness: 0.0,
  });
  if (opts.emissive) { mat.emissive = new THREE.Color(opts.emissive); mat.emissiveIntensity = opts.emissiveIntensity ?? 0; }
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
}

export function setupRoom1(scene, camera) {
  const group = new THREE.Group();
  scene.add(group);

  // 흰 톤 팔레트
  const FLOOR = '#cfccd6', WALL = '#dcd9e3', PANEL = '#eceaf0';

  // 두 플랫폼(사이에 틈)
  const platA = box(18, 0.5, 7, FLOOR); platA.position.set(0, -0.25, -5.5); group.add(platA);
  const platB = box(18, 0.5, 7, FLOOR); platB.position.set(0, -0.25, 5.5); group.add(platB);

  // 둘러싸는 벽 + 천장(폐쇄 공간 → 조명 일관 + 번짐이 벽에 잘 맺힘)
  const back  = box(20, 6, 0.4, WALL); back.position.set(0, 3, -9.2); group.add(back);
  const front = box(20, 6, 0.4, WALL); front.position.set(0, 3, 9.2); group.add(front);
  const left  = box(0.4, 6, 20, WALL); left.position.set(-9.2, 3, 0); group.add(left);
  const right = box(0.4, 6, 20, WALL); right.position.set(9.2, 3, 0); group.add(right);
  const ceil  = box(20, 0.4, 20, WALL); ceil.position.set(0, 6, 0); group.add(ceil);

  // 칠할 수 있는 정면 흰 패널 (빨강 → 다리)
  const panel = box(6, 3, 0.3, PANEL, { roughness: 0.85 });
  panel.position.set(0, 1.6, 2.0);
  panel.userData.role = 'bridgeWall';
  group.add(panel);

  // 빛의 다리 타일 (처음엔 숨김)
  const tiles = [];
  for (const z of [-1.5, -0.5, 0.5, 1.5]) {
    const t = box(4, 0.35, 0.9, '#bdbac6', { emissive: '#ef7d7d', emissiveIntensity: 0 });
    t.position.set(0, 0.0, z); t.visible = false; group.add(t); tiles.push(t);
  }

  // 출구 패드
  const exit = box(2.4, 0.08, 2.4, '#e7e4ee', { emissive: '#efd97d', emissiveIntensity: 0.6 });
  exit.position.set(0, 0.05, 6.5); group.add(exit);

  let bounce = null; // PLACEHOLDER GI 바운스 라이트
  const state = { bridgeActive: false, cleared: false, _glow: 0 };

  function onPaint(mesh, colorName) {
    if (mesh.userData.role === 'bridgeWall' && colorName === 'red' && !state.bridgeActive) {
      state.bridgeActive = true;
      mesh.material.emissive = new THREE.Color(COLORS.red);
      mesh.material.emissiveIntensity = 0.8;
      tiles.forEach((t) => { t.visible = true; });

      // ▼▼ PLACEHOLDER 간접광 — 실제 DDGI 간접광으로 교체할 것 (src/gi/ddgi.js) ▼▼
      bounce = new THREE.PointLight(COLORS.red.clone(), 0, 16, 2.0);
      bounce.position.set(0, 1.6, 1.0);
      scene.add(bounce);
      // ▲▲ PLACEHOLDER 끝 ▲▲
    }
  }

  function update(dt) {
    if (state.bridgeActive && state._glow < 1) {
      state._glow = Math.min(1, state._glow + dt * 1.5);
      const g = state._glow;
      tiles.forEach((t) => { t.material.emissiveIntensity = 1.3 * g; });
      if (bounce) bounce.intensity = 30 * g; // PLACEHOLDER (candela 스케일 — 보이게 튜닝)
    }
    if (!state.cleared && state.bridgeActive && camera) {
      const p = camera.position;
      if (p.z > 2 && Math.hypot(p.x - exit.position.x, p.z - exit.position.z) < 1.8) state.cleared = true;
    }
  }

  return {
    group,
    paintables: [panel],
    spawn: { x: 0, z: -6 },
    bounds: { minX: -8, maxX: 8, minZ: -8.5, maxZ: 8.5 },
    gap: { from: -2, to: 2, halfWidth: 2 },
    state, onPaint, update,
  };
}
