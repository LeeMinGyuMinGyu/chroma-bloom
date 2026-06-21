// src/main.js
import * as THREE from 'three/webgpu';
import { Player } from './player.js';
import { PaintSystem, COLOR_HEX } from './paint.js';
import { setupRoom1 } from './room1.js';
import { DDGI } from './gi/ddgi.js';

const $ = (id) => document.getElementById(id);

async function start() {
  const canvas = $('scene');
  const hasWebGPU = typeof navigator !== 'undefined' && !!navigator.gpu;

  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, forceWebGL: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5)); // 프레임 위해 상한 낮춤
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.NoToneMapping; // 흰 룸이 어두워지지 않도록
  await renderer.init();

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#101019');

  const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 300);

  // --- 라이팅: 흰 룸이 또렷이 보이도록(검은 화면 방지). Ambient를 충분히. ---
  scene.add(new THREE.AmbientLight('#ffffff', 1.0));                 // 모든 면 기본 밝기 보장
  scene.add(new THREE.HemisphereLight('#eaf0ff', '#3a3640', 1.4));   // 부드러운 채움
  const sun = new THREE.DirectionalLight('#fff4e6', 1.6);
  sun.position.set(4, 8, 2); scene.add(sun);

  // --- 방 / 플레이어 / 칠하기 ---
  const room = setupRoom1(scene, camera);
  const player = new Player(camera, canvas);
  player.spawn(room.spawn);
  const paint = new PaintSystem(camera, room.paintables);

  // --- DDGI 레이어(additive, 미지원/미완성이면 no-op) ---
  const gi = new DDGI(renderer, scene, camera, { enabled: hasWebGPU });
  await gi.init();

  paint.onPaint = (mesh, colorName) => { room.onPaint(mesh, colorName, scene); gi.markDirty(); gi.setPanelColor(COLOR_HEX[colorName]); };
  // 조준 피드백: paintable을 겨누면 크로스헤어가 커지고 현재 색으로
  const crosshair = $('crosshair');
  paint.onAim = (aiming, colorName) => {
    if (aiming) {
      crosshair.style.background = COLOR_HEX[colorName];
      crosshair.style.transform = 'translate(-50%,-50%) scale(1.9)';
    } else {
      crosshair.style.background = 'rgba(255,255,255,0.85)';
      crosshair.style.transform = 'translate(-50%,-50%) scale(1)';
    }
  };

  // 색 선택 HUD
  const chips = Array.from(document.querySelectorAll('.chip'));
  const syncPalette = () => chips.forEach((c) => c.dataset.on = String(c.dataset.color === paint.current));
  paint.onColorChange = syncPalette;

  // R: 다시하기(가장 안전한 리셋 = 새로고침)
  document.addEventListener('keydown', (e) => { if (e.code === 'KeyR') location.reload(); });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

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
      won = true; player.unlock();
      $('hud').style.opacity = '0'; $('crosshair').style.opacity = '0';
      $('win').classList.remove('hidden');
    }
  });

  $('startBtn').addEventListener('click', () => {
    $('loading').classList.add('hidden');
    $('hud').style.opacity = '1'; $('crosshair').style.opacity = '1';
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
  document.getElementById('errorMsg').textContent = String(err?.message || err);
  document.getElementById('error')?.classList.remove('hidden');
});
