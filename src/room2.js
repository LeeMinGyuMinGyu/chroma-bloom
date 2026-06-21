// src/room2.js
// 방2: 파랑 다리 (방1 구조 재탕, 색·좌표 변경). DDGI 주입 대상 아님(방1 전용).
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

export function setupRoom2(scene, camera) {
  const group = new THREE.Group();
  scene.add(group);

  // 약간 다른 팔레트(파랑 방 느낌)
  const FLOOR = '#cdd0d8', WALL = '#d7dae3', PANEL = '#e9ebf0';

  // 방1과 동일 구조: 두 플랫폼 + 틈
  const platA = box(18, 0.5, 7, FLOOR); platA.position.set(0, -0.25, -5.5); group.add(platA);
  const platB = box(18, 0.5, 7, FLOOR); platB.position.set(0, -0.25, 5.5); group.add(platB);

  const back  = box(20, 6, 0.4, WALL); back.position.set(0, 3, -9.2); group.add(back);
  const front = box(20, 6, 0.4, WALL); front.position.set(0, 3, 9.2); group.add(front);
  const left  = box(0.4, 6, 20, WALL); left.position.set(-9.2, 3, 0); group.add(left);
  const right = box(0.4, 6, 20, WALL); right.position.set(9.2, 3, 0); group.add(right);
  const ceil  = box(20, 0.4, 20, WALL); ceil.position.set(0, 6, 0); group.add(ceil);

  // 파랑으로 칠하는 패널
  const panel = box(6, 3, 0.3, PANEL, { roughness: 0.85 });
  panel.position.set(0, 1.6, 2.0);
  panel.userData.role = 'bridgeWall';
  panel.userData.needColor = 'blue';
  group.add(panel);

  // 파랑 다리 타일
  const tiles = [];
  for (const z of [-1.5, -0.5, 0.5, 1.5]) {
    const t = box(4, 0.35, 0.9, '#b6c2dc', { emissive: '#7da3ef', emissiveIntensity: 0 });
    t.position.set(0, 0.0, z); t.visible = false; group.add(t); tiles.push(t);
  }

  const exit = box(2.4, 0.08, 2.4, '#e4e7ee', { emissive: '#7da3ef', emissiveIntensity: 0.6 });
  exit.position.set(0, 0.05, 6.5); group.add(exit);

  const state = { bridgeActive: false, cleared: false, _glow: 0 };

  function onPaint(mesh, colorName) {
    if (mesh.userData.role === 'bridgeWall' && colorName === 'blue' && !state.bridgeActive) {
      state.bridgeActive = true;
      mesh.material.emissive = new THREE.Color(COLORS.blue);
      mesh.material.emissiveIntensity = 0.8;
      tiles.forEach((t) => { t.visible = true; });
    }
  }

  function update(dt) {
    if (state.bridgeActive && state._glow < 1) {
      state._glow = Math.min(1, state._glow + dt * 1.5);
      const g = state._glow;
      tiles.forEach((t) => { t.material.emissiveIntensity = 1.3 * g; });
    }
    if (!state.cleared && state.bridgeActive && camera) {
      const p = camera.position;
      if (p.z > 2 && Math.hypot(p.x - exit.position.x, p.z - exit.position.z) < 1.8) state.cleared = true;
    }
  }

  return {
    group, paintables: [panel],
    spawn: { x: 0, z: -6 },
    bounds: { minX: -8, maxX: 8, minZ: -8.5, maxZ: 8.5 },
    gap: { from: -2, to: 2, halfWidth: 2 },
    state, onPaint, update,
  };
}
