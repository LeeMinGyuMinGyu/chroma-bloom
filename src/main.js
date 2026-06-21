// src/main.js
// 게임 진입점. 게임 레이어(무조건 구동) + DDGI 레이어(선택적, WebGPU에서만)를 조립한다.
import * as THREE from 'three/webgpu';
import { Player } from './player.js';
import { PaintSystem, COLORS } from './paint.js';
import { setupRoom1 } from './room1.js';
import { DDGI } from './gi/ddgi.js';

const $ = (id) => document.getElementById(id);

async function start() {
  const canvas = $('scene');

  // WebGPU 사용 가능 여부. 컴퓨트 기반 DDGI는 WebGPU에서만 의미가 있다.
  // (WebGPURenderer는 미지원 시 자동으로 WebGL2로 폴백하므로 게임 자체는 그래도 돌아간다.)
  const hasWebGPU = typeof navigator !== 'undefined' && !!navigator.gpu;

  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, forceWebGL: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  await renderer.init();

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#15131c'); // 거의 어둡지만 순흑은 아님(파스텔이 살게)

  const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 300);

  // --- 기본 라이팅: GI가 없어도 장면이 보이도록 보장 ---
  scene.add(new THREE.AmbientLight('#aab', 0.18));
  const key = new THREE.PointLight('#fff3e0', 9, 60, 1.5);
  key.position.set(2, 7, -3);
  scene.add(key);
  const fill = new THREE.DirectionalLight('#9fb6ff', 0.25);
  fill.position.set(-4, 6, 6);
  scene.add(fill);

  // --- 방 / 플레이어 / 칠하기 ---
  const room = setupRoom1(scene, camera);
  const player = new Player(camera, canvas);
  player.spawn(room.spawn);

  const paint = new PaintSystem(camera, room.paintables);

  // --- DDGI 레이어 (additive). 미지원/미완성이어도 안전한 no-op. ---
  const gi = new DDGI(renderer, scene, camera, { enabled: hasWebGPU });
  await gi.init();

  // 칠할 때마다: 방 로직(다리 활성 등) + GI에 "장면 바뀜" 통지
  paint.onPaint = (mesh, colorName) => {
    room.onPaint(mesh, colorName, scene);
    gi.markDirty();
  };

  // --- 리사이즈 ---
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // --- HUD: 색 선택 표시 ---
  const chips = Array.from(document.querySelectorAll('.chip'));
  const syncPalette = () => chips.forEach((c) => c.dataset.on = String(c.dataset.color === paint.current));
  paint.onColorChange = syncPalette;

  // --- 루프 ---
  const clock = new THREE.Clock();
  let won = false;
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    player.update(dt, room);
    paint.update();
    gi.update(dt);
    room.update(dt);
    renderer.render(scene, camera);

    if (!won && room.state.cleared) {
      won = true;
      player.unlock();
      $('hud').style.opacity = '0';
      $('crosshair').style.opacity = '0';
      $('win').classList.remove('hidden');
    }
  });

  // --- 시작 버튼: 포인터 락 + UI 전환 ---
  $('startBtn').addEventListener('click', () => {
    $('loading').classList.add('hidden');
    $('hud').style.opacity = '1';
    $('crosshair').style.opacity = '1';
    player.lock();
    if (!hasWebGPU) {
      const n = $('notice');
      n.textContent = '이 브라우저는 WebGPU 미지원 — 게임은 실행되지만 GI 효과는 최신 Chrome/Edge에서 보입니다.';
      n.style.display = 'block';
      setTimeout(() => { n.style.display = 'none'; }, 6000);
    }
  });

  syncPalette();
}

start().catch((err) => {
  console.error(err);
  document.getElementById('loading')?.classList.add('hidden');
  const e = document.getElementById('error');
  document.getElementById('errorMsg').textContent = String(err?.message || err);
  e?.classList.remove('hidden');
});
