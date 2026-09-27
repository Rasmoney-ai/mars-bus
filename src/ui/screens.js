// Screens inside the cabin, drawn on canvases:
// - the info screen above the windshield (stop names, countdown),
// - the instrument panel with "AUTOPILOT" and a small route map,
// - the (made-up) mission badge.
// Canvases are only redrawn when their content changes, to keep texture
// uploads rare.

import * as THREE from 'three';
import { formatTime } from '../timeline.js';

const FONT = 'system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

export class CanvasScreen {
  constructor(width, height, pxW, pxH, { transparent = false } = {}) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = pxW;
    this.canvas.height = pxH;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.material = new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false, transparent, fog: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), this.material);
    this.width = width;
    this.height = height;
    this.key = null;
  }

  // Calls draw(ctx, w, h) only if `key` differs from last time.
  redraw(key, draw) {
    if (key === this.key) return false;
    this.key = key;
    draw(this.ctx, this.canvas.width, this.canvas.height);
    this.texture.needsUpdate = true;
    return true;
  }
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Fits text into maxWidth by shrinking the font if needed.
export function fitText(ctx, text, x, y, maxWidth, size, weight = 'bold') {
  let s = size;
  ctx.font = `${weight} ${s}px ${FONT}`;
  while (ctx.measureText(text).width > maxWidth && s > 10) {
    s -= 2;
    ctx.font = `${weight} ${s}px ${FONT}`;
  }
  ctx.fillText(text, x, y);
}

// --- Mission badge (placeholder, no real logos) -------------------------------

export function drawBadge(ctx, size) {
  const c = size / 2;
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = '#1b2a47';
  ctx.beginPath(); ctx.arc(c, c, c * 0.98, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#e0772f';
  ctx.lineWidth = size * 0.025;
  ctx.beginPath(); ctx.arc(c, c, c * 0.93, 0, Math.PI * 2); ctx.stroke();

  // Inner scene: sky, planet, bus.
  ctx.save();
  ctx.beginPath(); ctx.arc(c, c, c * 0.62, 0, Math.PI * 2); ctx.clip();
  const sky = ctx.createLinearGradient(0, c * 0.4, 0, c * 1.6);
  sky.addColorStop(0, '#c98f5e'); sky.addColorStop(1, '#f0cf9c');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#fff8e6';
  ctx.beginPath(); ctx.arc(c * 1.3, c * 0.72, c * 0.07, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#a4472a';
  ctx.beginPath(); ctx.arc(c, c * 2.35, c * 1.2, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#7f3420';
  ctx.beginPath(); ctx.arc(c * 0.55, c * 1.42, c * 0.08, 0, Math.PI * 2); ctx.fill();
  // Bus silhouette.
  const bw = c * 0.62, bh = c * 0.2, bx = c - bw / 2, by = c * 0.98;
  ctx.fillStyle = '#ffffff';
  roundRect(ctx, bx, by, bw, bh, bh * 0.45); ctx.fill();
  ctx.fillStyle = '#2d3e5e';
  for (let i = 0; i < 4; i++) {
    roundRect(ctx, bx + bw * 0.12 + i * bw * 0.19, by + bh * 0.2, bw * 0.13, bh * 0.36, bh * 0.1); ctx.fill();
  }
  ctx.fillStyle = '#caa24a';
  ctx.fillRect(bx + bw * 0.05, by + bh * 0.95, bw * 0.9, bh * 0.18);
  ctx.fillStyle = '#2b2b2b';
  for (let i = 0; i < 5; i++) {
    ctx.beginPath(); ctx.arc(bx + bw * 0.14 + i * bw * 0.18, by + bh * 1.2, bh * 0.2, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();

  // Text around the ring.
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${Math.round(size * 0.085)}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  curvedText(ctx, 'MARS-BUSSEN', c, c, c * 0.78, -Math.PI / 2, true);
  ctx.font = `bold ${Math.round(size * 0.07)}px ${FONT}`;
  curvedText(ctx, 'MARSBASE · 50 ÅR', c, c, c * 0.78, Math.PI / 2, false);
}

function curvedText(ctx, text, cx, cy, r, center, top) {
  const chars = [...text];
  const widths = chars.map((ch) => ctx.measureText(ch).width * 1.08);
  const total = widths.reduce((a, b) => a + b, 0);
  let angle = center + (top ? -1 : 1) * (total / r) / 2;
  for (let i = 0; i < chars.length; i++) {
    const w = widths[i];
    angle += (top ? 1 : -1) * (w / r) / 2;
    ctx.save();
    ctx.translate(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
    ctx.rotate(angle + (top ? Math.PI / 2 : -Math.PI / 2));
    ctx.fillText(chars[i], 0, 0);
    ctx.restore();
    angle += (top ? 1 : -1) * (w / r) / 2;
  }
}

// --- Cabin screens -----------------------------------------------------------

export class CabinScreens {
  constructor(bus, placements, timeline) {
    this.timeline = timeline;
    this.info = new CanvasScreen(placements.info.width, placements.info.height, 1024, 236);
    this.info.mesh.matrix.copy(placements.info.matrix);
    this.info.mesh.matrixAutoUpdate = false;
    bus.group.add(this.info.mesh);

    this.dash = new CanvasScreen(placements.dash.width, placements.dash.height, 512, 256);
    this.dash.mesh.matrix.copy(placements.dash.matrix);
    this.dash.mesh.matrixAutoUpdate = false;
    bus.group.add(this.dash.mesh);

    const badge = new CanvasScreen(1, 1, 256, 256, { transparent: true });
    badge.redraw('badge', (ctx, w) => drawBadge(ctx, w));
    badge.material.alphaTest = 0.5;
    badge.material.transparent = false;
    for (const b of placements.badges) {
      const m = new THREE.Mesh(badge.mesh.geometry, badge.material);
      m.matrix.copy(b.matrix).multiply(new THREE.Matrix4().makeScale(b.size, b.size, 1));
      m.matrixAutoUpdate = false;
      bus.group.add(m);
    }
    this._buildMapBackground();
    this._lastDash = 0;
  }

  _buildMapBackground() {
    const path = this.timeline.path;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < path.count; i++) {
      minX = Math.min(minX, path.x[i]); maxX = Math.max(maxX, path.x[i]);
      minZ = Math.min(minZ, path.z[i]); maxZ = Math.max(maxZ, path.z[i]);
    }
    const size = 256, pad = 26;
    const scale = (size - 2 * pad) / Math.max(maxX - minX, maxZ - minZ);
    const ox = size / 2 - ((minX + maxX) / 2) * scale;
    const oz = size / 2 - ((minZ + maxZ) / 2) * scale;
    this.map = { scale, ox, oz, size };
    const bg = document.createElement('canvas');
    bg.width = bg.height = size;
    const ctx = bg.getContext('2d');
    ctx.fillStyle = '#0f1a24';
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = 'rgba(120,170,200,0.12)';
    ctx.lineWidth = 1;
    for (let g = 0; g <= size; g += 32) {
      ctx.beginPath(); ctx.moveTo(g, 0); ctx.lineTo(g, size); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, g); ctx.lineTo(size, g); ctx.stroke();
    }
    ctx.strokeStyle = '#e8a765';
    ctx.lineWidth = 4;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i < path.count; i += 8) {
      const x = ox + path.x[i] * scale, y = oz + path.z[i] * scale;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.lineTo(ox + path.x[path.count - 1] * scale, oz + path.z[path.count - 1] * scale);
    ctx.stroke();
    this.timeline.stops.forEach((stop, i) => {
      const p = path.sample(stop.s);
      const x = ox + p.x * scale, y = oz + p.z * scale;
      ctx.fillStyle = stop.final ? '#6fe39a' : i === 0 ? '#9aa7b4' : '#ffffff';
      ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#0f1a24';
      ctx.font = `bold 12px ${FONT}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(i === 0 ? 'L' : stop.final ? 'B' : String(i), x, y + 1);
    });
    this.mapBg = bg;
  }

  update(status, view, playing, now) {
    // Info screen above the windshield.
    this.info.redraw(`${status.title}|${status.subtitle}|${status.big}`, (ctx, w, h) => {
      ctx.fillStyle = '#0d1520';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#2e4a66';
      ctx.lineWidth = 6;
      ctx.strokeRect(3, 3, w - 6, h - 6);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (status.big) {
        ctx.fillStyle = '#ffffff';
        fitText(ctx, status.title, w * 0.4, h / 2, w * 0.66, 64);
        ctx.fillStyle = '#ffc36b';
        ctx.font = `bold 170px ${FONT}`;
        ctx.fillText(status.big, w * 0.84, h / 2 + 8);
      } else {
        ctx.fillStyle = '#ffffff';
        fitText(ctx, status.title, w / 2, status.subtitle ? h * 0.36 : h / 2, w - 60, 72);
        if (status.subtitle) {
          ctx.fillStyle = '#ffc36b';
          fitText(ctx, status.subtitle, w / 2, h * 0.72, w - 60, 50, '600');
        }
      }
    });

    // Instrument panel: map + AUTOPILOT, at most 4 redraws per second.
    const pose = view.pose;
    const m = this.map;
    const mx = Math.round((m.ox + pose.x * m.scale) * 2) / 2;
    const my = Math.round((m.oz + pose.z * m.scale) * 2) / 2;
    const hd = Math.round(pose.heading / 0.05);
    const kmh = Math.round(pose.v * 3.6);
    const mode = !playing ? (status.phase === 'end' ? 'SLUT' : 'PAUSE') : pose.v > 0.05 ? 'KØRER' : 'HOLDER';
    const dist = status.distance != null ? Math.round(status.distance / 10) * 10 : null;
    const eta = status.eta != null ? formatTime(status.eta) : '';
    const key = `${mx}|${my}|${hd}|${kmh}|${mode}|${status.next ? status.next.name : ''}|${dist}|${eta}`;
    if (key !== this.dash.key && now - this._lastDash > 250) {
      this._lastDash = now;
      this.dash.redraw(key, (ctx, w, h) => {
        ctx.drawImage(this.mapBg, 0, 0);
        // Bus marker: a triangle pointing in the driving direction.
        ctx.save();
        ctx.translate(mx, my);
        ctx.rotate(-pose.heading);
        ctx.fillStyle = '#29d3ff';
        ctx.strokeStyle = '#0f1a24';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(8, 8); ctx.lineTo(0, 4); ctx.lineTo(-8, 8); ctx.closePath();
        ctx.fill(); ctx.stroke();
        ctx.restore();

        ctx.fillStyle = '#121c26';
        ctx.fillRect(256, 0, 256, h);
        ctx.fillStyle = '#6fe39a';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.font = `bold 34px ${FONT}`;
        ctx.fillText('AUTOPILOT', 272, 44);
        const pill = { KØRER: '#3fbf6f', HOLDER: '#e0a030', PAUSE: '#8a96a3', SLUT: '#8a96a3' }[mode];
        ctx.fillStyle = pill;
        roundRect(ctx, 272, 58, 110, 30, 15); ctx.fill();
        ctx.fillStyle = '#0f1a24';
        ctx.font = `bold 18px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.fillText(mode, 327, 80);
        ctx.textAlign = 'left';
        ctx.fillStyle = '#e6edf3';
        ctx.font = `bold 22px ${FONT}`;
        ctx.fillText(`${kmh} km/t`, 396, 81);
        if (status.next) {
          ctx.fillStyle = '#8fa3b5';
          ctx.font = `18px ${FONT}`;
          ctx.fillText('Næste stop', 272, 130);
          ctx.fillStyle = '#ffffff';
          fitText(ctx, status.next.name, 272, 162, 228, 28);
          ctx.fillStyle = '#ffc36b';
          ctx.font = `bold 40px ${FONT}`;
          ctx.fillText(`${dist} m`, 272, 214);
          ctx.fillStyle = '#8fa3b5';
          ctx.font = `20px ${FONT}`;
          ctx.fillText(eta ? `om ${eta}` : '', 272, 242);
        } else {
          ctx.fillStyle = '#ffffff';
          fitText(ctx, 'Marsbasen', 272, 162, 228, 28);
        }
      });
    }
  }
}
