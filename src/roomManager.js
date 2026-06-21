// src/roomManager.js
// 방 3개 전환 관리. 방1 클리어 → 방2 → 방3 → 승리.
// DDGI(프로브 점 + 주입)는 방1에서만 보이게: 방2·3 진입 시 gi 디버그/주입을 숨김.
import { setupRoom1 } from './room1.js';
import { setupRoom2 } from './room2.js';
import { setupRoom3 } from './room3.js';

export class RoomManager {
  constructor(scene, camera, player, paint, gi) {
    this.scene = scene; this.camera = camera;
    this.player = player; this.paint = paint; this.gi = gi;
    this.builders = [setupRoom1, setupRoom2, setupRoom3];
    this.index = 0;
    this.room = null;
    this.onAllCleared = null;
    this._transitioning = false;
  }

  start() { this._load(0); }

  _clearCurrent() {
    if (!this.room) return;
    // 현재 방 그룹을 씬에서 제거
    this.scene.remove(this.room.group);
    this.room.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose?.();
    });
    this.room = null;
  }

  _load(i) {
    this._clearCurrent();
    this.index = i;
    this.room = this.builders[i](this.scene, this.camera);
    // 플레이어 스폰 이동
    this.player.spawn(this.room.spawn);
    // paintables 갱신 (paint.js는 this.paintables 배열을 직접 사용)
    this.paint.paintables = this.room.paintables;

    // DDGI는 방1(i===0)에서만 보이게
    if (this.gi) {
      const giOn = (i === 0);
      if (this.gi.setActive) this.gi.setActive(giOn);
    }
    this._transitioning = false;
  }

  // main 루프에서 매 프레임 호출
  update(dt) {
    if (!this.room || this._transitioning) return;
    this.room.update(dt);
    if (this.room.state.cleared) {
      this._transitioning = true;
      if (this.index < this.builders.length - 1) {
        // 다음 방 (살짝 딜레이로 전환감)
        setTimeout(() => this._load(this.index + 1), 350);
      } else {
        // 마지막 방 클리어 → 승리
        if (this.onAllCleared) this.onAllCleared();
      }
    }
  }

  onPaint(mesh, colorName) {
    if (this.room) this.room.onPaint(mesh, colorName, this.scene);
  }

  get current() { return this.room; }
}
