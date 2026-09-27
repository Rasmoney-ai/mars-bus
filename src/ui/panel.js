// The small personal screen in front of your seat (in VR). Buttons can be
// used by pointing and pinching (hand tracking), with a controller trigger,
// or by touching the screen with a fingertip.

import * as THREE from 'three';
import { CanvasScreen, roundRect, fitText } from './screens.js';

const W = 512, H = 256;

export class SeatPanel {
  constructor(onAction) {
    this.onAction = onAction;
    this.screen = new CanvasScreen(0.34, 0.17, W, H);
    this.mesh = this.screen.mesh;
    this.mesh.name = 'seat-panel';
    this.buttons = [];
    this.hover = null;
    this.message = '';
    this.messageUntil = 0;
    this.state = {};
  }

  // Show a short message (e.g. after recentering) for a few seconds.
  flash(text, now, seconds = 3) {
    this.message = text;
    this.messageUntil = now + seconds * 1000;
  }

  update(state, now) {
    this.state = state;
    const msg = now < this.messageUntil ? this.message : '';
    const buttons = [];
    if (state.ended) buttons.push({ id: 'restart', label: 'Kør igen', primary: true });
    else if (state.playing) buttons.push({ id: 'pause', label: 'Pause' });
    else {
      buttons.push({ id: 'play', label: state.started ? 'Fortsæt' : 'Start', primary: true });
      if (state.started) buttons.push({ id: 'restart', label: 'Forfra' });
    }
    buttons.push({ id: 'comfort', label: state.comfort ? 'Komfort: til' : 'Komfort: fra' });
    // Layout: equal-width buttons along the bottom.
    const gap = 16, y = 128, h = 104;
    const w = (W - gap * (buttons.length + 1)) / buttons.length;
    buttons.forEach((b, i) => Object.assign(b, { x: gap + i * (w + gap), y, w, h }));
    this.buttons = buttons;

    const key = `${buttons.map((b) => b.label).join(',')}|${this.hover}|${state.line}|${msg}`;
    this.screen.redraw(key, (ctx) => {
      ctx.fillStyle = '#0d1520';
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = '#2e4a66';
      ctx.lineWidth = 6;
      ctx.strokeRect(3, 3, W - 6, H - 6);
      ctx.fillStyle = msg ? '#6fe39a' : '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      fitText(ctx, msg || state.line || '', W / 2, 66, W - 40, 38);
      for (const b of buttons) {
        const hot = this.hover === b.id;
        ctx.fillStyle = b.primary ? (hot ? '#ffb45c' : '#e0772f') : (hot ? '#4d6b88' : '#2e4a66');
        roundRect(ctx, b.x, b.y, b.w, b.h, 18);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        fitText(ctx, b.label, b.x + b.w / 2, b.y + b.h / 2 + 2, b.w - 20, 38);
      }
    });
  }

  // uv (0..1) -> button id or null.
  hitTest(uv) {
    const x = uv.x * W, y = (1 - uv.y) * H;
    for (const b of this.buttons) {
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b.id;
    }
    return null;
  }

  press(id) {
    if (id) this.onAction(id);
  }
}

// Pointing, pinching and poking at the seat panel.
export class PanelInteraction {
  constructor(renderer, rig, panel, hands) {
    this.panel = panel;
    this.hands = hands;
    this.rig = rig;
    this.raycaster = new THREE.Raycaster();
    this.controllers = [renderer.xr.getController(0), renderer.xr.getController(1)];
    this.hoverIds = [null, null];
    const rayGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
    const rayMat = new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.6 });
    this.rays = this.controllers.map((c, i) => {
      rig.add(c);
      const line = new THREE.Line(rayGeo, rayMat);
      line.visible = false;
      c.add(line);
      c.addEventListener('selectstart', () => {
        const id = this.hoverIds[i];
        if (id) this.panel.press(id);
      });
      return line;
    });
    this.cursor = new THREE.Mesh(
      new THREE.CircleGeometry(0.006, 16),
      new THREE.MeshBasicMaterial({ color: '#ffffff', depthTest: false, transparent: true, opacity: 0.9, fog: false }),
    );
    this.cursor.renderOrder = 10;
    this.cursor.visible = false;
    panel.mesh.add(this.cursor);
    this.pokeActive = [false, false];
    this._v = new THREE.Vector3();
  }

  // Call after the bus pose (and its world matrices) is updated for this frame.
  update() {
    const mesh = this.panel.mesh;
    let hover = null;
    this.cursor.visible = false;
    this.controllers.forEach((c, i) => {
      this.hoverIds[i] = null;
      this.rays[i].visible = false;
      if (!c.visible || !mesh.visible) return;
      this.raycaster.ray.origin.setFromMatrixPosition(c.matrixWorld);
      this.raycaster.ray.direction.set(0, 0, -1).transformDirection(c.matrixWorld);
      const hit = this.raycaster.intersectObject(mesh, false)[0];
      if (!hit || hit.distance > 3) return;
      const id = this.panel.hitTest(hit.uv);
      this.hoverIds[i] = id;
      hover = hover || id;
      this.rays[i].visible = true;
      this.rays[i].scale.set(1, 1, hit.distance);
      this.cursor.visible = true;
      this.cursor.position.copy(mesh.worldToLocal(hit.point.clone()));
      this.cursor.position.z = 0.002;
    });

    // Poke: an index fingertip pushed onto the screen presses a button.
    for (let i = 0; i < 2; i++) {
      const tip = this.hands.indexTip(i);
      if (!tip || !mesh.visible) { this.pokeActive[i] = false; continue; }
      const local = mesh.worldToLocal(this.rig.localToWorld(this._v.copy(tip)));
      const inside = Math.abs(local.x) < this.panel.screen.width / 2 && Math.abs(local.y) < this.panel.screen.height / 2;
      if (inside && local.z < 0.012 && local.z > -0.06) {
        if (!this.pokeActive[i]) {
          this.pokeActive[i] = true;
          const uv = { x: local.x / this.panel.screen.width + 0.5, y: local.y / this.panel.screen.height + 0.5 };
          this.panel.press(this.panel.hitTest(uv));
        }
      } else if (!inside || local.z > 0.03) {
        this.pokeActive[i] = false;
      }
      if (inside && local.z < 0.08) {
        hover = hover || this.panel.hitTest({ x: local.x / this.panel.screen.width + 0.5, y: local.y / this.panel.screen.height + 0.5 });
      }
    }
    this.panel.hover = hover;
  }
}
