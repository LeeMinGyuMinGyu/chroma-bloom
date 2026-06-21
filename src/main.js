// src/main.js
import * as THREE from 'three/webgpu';
import { Player } from './player.js';
import { PaintSystem, COLOR_HEX } from './paint.js';
import { RoomManager } from './roomManager.js';
import { DDGI } from './gi/ddgi.js';

const $ = (id) => document.getElementById(id);

async function start() {
  const canvas = $('scene');
  const hasWebGPU = typeof navigator !== 'undefined' && !!navigator.gpu;

  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, forceWebGL: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; // 색 클립 완화·자연스러운 하이라이트
  renderer.toneMappingExposure = 1.35;                 // ACES가 누르는 만큼 노출 보정
  await renderer.init();

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#0e0d18');
  // 안개: 먼 벽이 배경색으로 부드럽게 녹아 깊이감↑ (near~far 사이에서 페이드)
  scene.fog = new THREE.Fog('#0e0d18', 18, 46);

  const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 300);

  // --- 라이팅(낮춰서 GI 간접광이 보일 여유 확보) ---
  scene.add(new THREE.AmbientLight('#fff6ee', 0.28));
  scene.add(new THREE.HemisphereLight('#eaf0ff', '#2c2838', 0.45));
  const sun = new THREE.DirectionalLight('#fff4e6', 1.05);
  sun.position.set(4, 8, 2); scene.add(sun);

  // --- 플레이어 / 칠하기 ---
  const player = new Player(camera, canvas);
  const paint = new PaintSystem(camera, []);

  // --- DDGI 레이어(additive). 생성만 먼저(주입은 방1 로드 후) ---
  const gi = new DDGI(renderer, scene, camera, { enabled: hasWebGPU });

  // --- 방 매니저: 방1→2→3 전환. 방1을 먼저 씬에 올림 ---
  const manager = new RoomManager(scene, camera, player, paint, gi);
  manager.start(); // 방1 로드 + 플레이어 스폰 + paintables 설정

  // 방1이 씬에 있는 상태에서 DDGI 초기화 → 주입 대상(방1 면) 확보
  await gi.init();
  gi.setActive(true); // 방1 활성

  paint.onPaint = (mesh, colorName) => {
    manager.onPaint(mesh, colorName);
    gi.markDirty();
    gi.setPanelColor(COLOR_HEX[colorName]);
  };

  // 조준 피드백
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

  // R: 다시하기(새로고침)
  document.addEventListener('keydown', (e) => { if (e.code === 'KeyR') location.reload(); });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // 승리 처리
  let won = false;
  manager.onAllCleared = () => {
    if (won) return;
    won = true; player.unlock();
    $('hud').style.opacity = '0'; $('crosshair').style.opacity = '0';
    $('win').classList.remove('hidden');
  };

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    if (manager.current) player.update(dt, manager.current);
    paint.update();
    gi.update(dt);
    manager.update(dt);
    renderer.render(scene, camera);
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
