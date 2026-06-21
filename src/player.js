// src/player.js
// PointerLockControls 애드온 대신 최소 구현(버전 안전).
import * as THREE from 'three/webgpu';

const EYE = 1.6;        // 눈높이
const SPEED = 4.6;      // 이동 속도 (유닛/초)
const SENS = 0.0034;    // 마우스 감도 (↑)

export class Player {
  constructor(camera, domElement) {
    this.camera = camera;
    this.dom = domElement;
    this.yaw = 0;
    this.pitch = 0;
    this.keys = new Set();
    this.locked = false;
    this._euler = new THREE.Euler(0, 0, 0, 'YXZ');
    this._move = new THREE.Vector3();   // 재사용(GC 방지)

    document.addEventListener('keydown', (e) => this.keys.add(e.code));
    document.addEventListener('keyup', (e) => this.keys.delete(e.code));
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.dom;
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.yaw -= e.movementX * SENS;
      this.pitch -= e.movementY * SENS;
      const lim = Math.PI / 2 - 0.05;
      this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
    });
  }

  spawn(pos) { this.camera.position.set(pos.x, EYE, pos.z); }
  lock() { this.dom.requestPointerLock?.(); }
  unlock() { document.exitPointerLock?.(); }

  update(dt, room) {
    // 시점
    this._euler.set(this.pitch, this.yaw, 0);
    this.camera.quaternion.setFromEuler(this._euler);

    // 입력
    let f = 0, r = 0;
    if (this.keys.has('KeyW')) f += 1;
    if (this.keys.has('KeyS')) f -= 1;
    if (this.keys.has('KeyD')) r += 1;
    if (this.keys.has('KeyA')) r -= 1;
    if (f === 0 && r === 0) return;

    // 바라보는 방향을 XZ 평면에 투영
    const sinY = Math.sin(this.yaw), cosY = Math.cos(this.yaw);
    this._move.set(0, 0, 0)
      .addScaledVector(new THREE.Vector3(-sinY, 0, -cosY), f)
      .addScaledVector(new THREE.Vector3(cosY, 0, -sinY), r);
    if (this._move.lengthSq() > 0) this._move.normalize().multiplyScalar(SPEED * dt);

    const p = this.camera.position;
    let nx = p.x + this._move.x;
    let nz = p.z + this._move.z;

    // 방 경계 클램프
    const b = room.bounds;
    nx = Math.max(b.minX, Math.min(b.maxX, nx));
    nz = Math.max(b.minZ, Math.min(b.maxZ, nz));

    // 틈(gap) 처리: 다리 위(폭 안)에서만 건널 수 있고, 그 외엔 통과 차단
    const g = room.gap;
    const half = g.halfWidth ?? 2;
    const enteringGap = nz > g.from && nz < g.to;
    if (enteringGap) {
      const onBridge = room.state.bridgeActive && Math.abs(nx) <= half;
      if (!onBridge) {
        // 출발한 쪽으로 되돌려 통과 방지
        if (p.z <= g.from) nz = g.from;
        else if (p.z >= g.to) nz = g.to;
        else nz = p.z;
      }
    }

    p.x = nx; p.z = nz; p.y = EYE;
  }
}
