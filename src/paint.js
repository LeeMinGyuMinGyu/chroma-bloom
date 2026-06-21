// src/paint.js
import * as THREE from 'three/webgpu';

export const COLOR_HEX = { red: '#ef7d7d', blue: '#7da3ef', yellow: '#efd97d' };
export const COLORS = {
  red: new THREE.Color(COLOR_HEX.red),
  blue: new THREE.Color(COLOR_HEX.blue),
  yellow: new THREE.Color(COLOR_HEX.yellow),
};
const REACH = 13; // 칠할 수 있는 최대 거리

export class PaintSystem {
  constructor(camera, paintables) {
    this.camera = camera;
    this.paintables = paintables;
    this.current = 'red';
    this.ray = new THREE.Raycaster();
    this.ray.far = REACH;
    this._center = new THREE.Vector2(0, 0);
    this._aiming = null;
    this.onPaint = null;
    this.onColorChange = null;
    this.onAim = null;

    document.addEventListener('keydown', (e) => {
      if (e.code === 'Digit1') this.setColor('red');
      else if (e.code === 'Digit2') this.setColor('blue');
      else if (e.code === 'Digit3') this.setColor('yellow');
    });
    document.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (!document.pointerLockElement) return; // 첫 클릭(락 획득)은 칠하지 않음
      this.paintAtCenter();
    });
  }

  setColor(name) {
    if (!COLORS[name] || this.current === name) return;
    this.current = name;
    this.onColorChange?.(name);
    if (this._aiming) this.onAim?.(true, name); // 조준 중이면 크로스헤어 색 갱신
  }

  _aim() {
    this.ray.setFromCamera(this._center, this.camera);
    return this.ray.intersectObjects(this.paintables, false);
  }

  paintAtCenter() {
    const hits = this._aim();
    if (hits.length === 0) return;
    const mesh = hits[0].object;
    mesh.material.color.copy(COLORS[this.current]);
    mesh.userData.paintedColor = this.current;
    this.onPaint?.(mesh, this.current);
  }

  update() {
    // 조준 상태 변화 시에만 콜백
    const aiming = this._aim().length > 0;
    if (aiming !== this._aiming) {
      this._aiming = aiming;
      this.onAim?.(aiming, this.current);
    }
  }
}
