// src/player.js
// 버전 차이에 안전하도록 PointerLockControls 애드온 대신 최소 구현을 직접 한다.
import * as THREE from 'three/webgpu';

const EYE = 1.6;        // 눈높이
const SPEED = 4.2;      // 이동 속도 (유닛/초)
const SENS = 0.0022;    // 마우스 감도

export class Player {
  constructor(camera, domElement) {
    this.camera = camera;
    this.dom = domElement;
    this.yaw = 0;
    this.pitch = 0;
    this.keys = new Set();
    this.locked = false;
    this._euler = new THREE.Euler(0, 0, 0, 'YXZ');
    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();

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

  spawn(pos) {
    this.camera.position.set(pos.x, EYE, pos.z);
  }

  lock() { this.dom.requestPointerLock?.(); }
  unlock() { document.exitPointerLock?.(); }

  update(dt, room) {
    // 시점
    this._euler.set(this.pitch, this.yaw, 0);
    this.camera.quaternion.setFromEuler(this._euler);

    // 입력 → 평면 이동 방향
    let f = 0, r = 0;
    if (this.keys.has('KeyW')) f += 1;
    if (this.keys.has('KeyS')) f -= 1;
    if (this.keys.has('KeyD')) r += 1;
    if (this.keys.has('KeyA')) r -= 1;
    if (f === 0 && r === 0) return;

    // 카메라가 바라보는 방향을 XZ 평면에 투영
    this._fwd.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this._right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    const move = new THREE.Vector3()
      .addScaledVector(this._fwd, f)
      .addScaledVector(this._right, r);
    if (move.lengthSq() > 0) move.normalize().multiplyScalar(SPEED * dt);

    const p = this.camera.position;
    let nx = p.x + move.x;
    let nz = p.z + move.z;

    // 방 경계 클램프
    const b = room.bounds;
    nx = Math.max(b.minX, Math.min(b.maxX, nx));
    nz = Math.max(b.minZ, Math.min(b.maxZ, nz));

    // 틈(gap) 차단: 다리가 비활성이면 틈을 건너지 못함
    const g = room.gap;
    if (!room.state.bridgeActive) {
      const onNear = p.z <= g.from;          // 출발 플랫폼(틈 앞)
      if (onNear && nz > g.from) nz = g.from; // 틈 진입 방지
    }

    p.x = nx;
    p.z = nz;
    p.y = EYE;
  }
}
