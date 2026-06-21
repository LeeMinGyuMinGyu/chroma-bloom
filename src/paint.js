// src/paint.js
import * as THREE from 'three/webgpu';

export const COLORS = {
  red:    new THREE.Color('#ef7d7d'),
  blue:   new THREE.Color('#7da3ef'),
  yellow: new THREE.Color('#efd97d'),
};
const REACH = 12; // 칠할 수 있는 최대 거리

export class PaintSystem {
  constructor(camera, paintables) {
    this.camera = camera;
    this.paintables = paintables;       // 칠할 수 있는 Mesh 배열
    this.current = 'red';
    this.ray = new THREE.Raycaster();
    this.ray.far = REACH;
    this.onPaint = null;                // (mesh, colorName) => void
    this.onColorChange = null;

    document.addEventListener('keydown', (e) => {
      if (e.code === 'Digit1') this.setColor('red');
      else if (e.code === 'Digit2') this.setColor('blue');
      else if (e.code === 'Digit3') this.setColor('yellow');
    });

    document.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      // 포인터 락 상태에서만 칠하기 (첫 클릭=락 획득은 칠하지 않음)
      if (!document.pointerLockElement) return;
      this.paintAtCenter();
    });
  }

  setColor(name) {
    if (!COLORS[name] || this.current === name) return;
    this.current = name;
    this.onColorChange?.(name);
  }

  paintAtCenter() {
    // 화면 정중앙(크로스헤어)에서 레이 발사
    this.ray.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    const hits = this.ray.intersectObjects(this.paintables, false);
    if (hits.length === 0) return;
    const mesh = hits[0].object;
    mesh.material.color.copy(COLORS[this.current]);
    mesh.userData.paintedColor = this.current;
    this.onPaint?.(mesh, this.current);
  }

  update() { /* 매 프레임 동작 없음 (확장 여지) */ }
}
