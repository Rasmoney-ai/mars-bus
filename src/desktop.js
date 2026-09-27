// Desktop mode: drag with the mouse (or a finger) to look around, and keys
// for start/pause, jumping between stops and scrubbing the timeline.

import { SEATS } from './config.js';

export class DesktopControls {
  // actions: { togglePlay, seekBy, nextStop, prevStop, restart, toggleComfort,
  //            toggleSimulated, selectSeat, toggleOutside, toggleMute,
  //            toggleHelp, showMenu }
  constructor(element, camera, outsideCamera, actions) {
    this.camera = camera;
    this.outsideCamera = outsideCamera;
    this.actions = actions;
    this.enabled = false;
    this.outside = false;
    this.yaw = 0;
    this.pitch = -0.1;
    this.orbitYaw = 0.6;
    this.orbitPitch = 0.35;
    this._drag = null;
    this.onClick = null;

    element.addEventListener('pointerdown', (e) => {
      if (!this.enabled || e.button !== 0) return;
      this._drag = { x: e.clientX, y: e.clientY, id: e.pointerId, moved: 0 };
      element.setPointerCapture(e.pointerId);
    });
    element.addEventListener('pointermove', (e) => {
      if (!this._drag || e.pointerId !== this._drag.id) return;
      const dx = e.clientX - this._drag.x, dy = e.clientY - this._drag.y;
      this._drag.x = e.clientX; this._drag.y = e.clientY;
      this._drag.moved += Math.abs(dx) + Math.abs(dy);
      const k = 0.0035;
      if (this.outside) {
        this.orbitYaw -= dx * k;
        this.orbitPitch = Math.min(1.3, Math.max(0.05, this.orbitPitch + dy * k));
      } else {
        this.yaw -= dx * k;
        this.pitch = Math.min(1.4, Math.max(-1.4, this.pitch - dy * k));
      }
    });
    const end = (e) => {
      if (this._drag && e.pointerId === this._drag.id) {
        // A click without dragging: let the app check what was clicked.
        if (e.type === 'pointerup' && this._drag.moved < 6 && this.onClick) this.onClick(e.clientX, e.clientY);
        this._drag = null;
      }
    };
    element.addEventListener('pointerup', end);
    element.addEventListener('pointercancel', end);

    window.addEventListener('keydown', (e) => this._key(e));
  }

  _key(e) {
    if (!this.enabled || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target && e.target.tagName === 'INPUT') e.target.blur();
    const a = this.actions;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const step = e.shiftKey ? 30 : 10;
    const map = {
      ' ': a.togglePlay,
      ArrowRight: () => a.seekBy(step),
      ArrowLeft: () => a.seekBy(-step),
      n: a.nextStop,
      f: a.prevStop,
      r: a.restart,
      k: a.toggleComfort,
      p: a.toggleSimulated,
      v: () => { this.outside = !this.outside; },
      m: a.toggleMute,
      h: a.toggleHelp,
      Escape: a.showMenu,
    };
    if (/^[0-9]$/.test(k)) {
      const n = k === '0' ? 10 : parseInt(k, 10);
      if (n <= SEATS.count) a.selectSeat(n);
      e.preventDefault();
      return;
    }
    const fn = map[k];
    if (fn) {
      fn();
      e.preventDefault();
    }
  }

  // Apply the look direction to the seat camera (not used in VR).
  apply() {
    this.camera.position.set(0, SEATS.eyeHeight, 0);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    const r = 13;
    const c = this.outsideCamera;
    c.position.set(
      Math.sin(this.orbitYaw) * Math.cos(this.orbitPitch) * r,
      1.5 + Math.sin(this.orbitPitch) * r,
      Math.cos(this.orbitYaw) * Math.cos(this.orbitPitch) * r,
    );
    c.rotation.set(-this.orbitPitch * 0.85, this.orbitYaw, 0, 'YXZ');
  }

  get activeCamera() {
    return this.outside ? this.outsideCamera : this.camera;
  }
}
