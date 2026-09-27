// Marsbasen — destination for Mars-bus R-10. three.js, WebXR / Meta Quest 3.
//   import { buildMarsBase } from './marsBase.js';
//   const { group } = buildMarsBase(THREE, { sunDir, groundColor });
// 1 unit = 1 m, y-up, origin at ground level in the middle of the base.
// Entrance faces +Z (door at z = 10). Clear zone for the bus: x −6…6, z 20…60.
// Light and shadow are baked into vertex colours from sunDir (model space).
// All materials are MeshBasicMaterial + vertexColors. Needs a DOM for canvas textures.

let _tex = null, _mats = null;
const A = 1024;
const R = {
  sign: [0, 0, 1024, 205], lock: [0, 205, 512, 96], rover: [512, 205, 512, 96], charge: [0, 301, 512, 96],
  warn: [512, 301, 512, 96], hazard: [0, 397, 512, 64], badge: [0, 461, 256, 256], door: [256, 461, 128, 256],
  win: [384, 461, 128, 128], lblVand: [512, 461, 128, 96], lblO2: [640, 461, 128, 96], lblCH4: [768, 461, 128, 96],
  garage: [512, 600, 512, 393], solar: [0, 717, 256, 256], cont: [256, 717, 256, 256],
};

function textures(THREE) {
  if (_tex) return _tex;
  let seed = 3; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const F = (w, s) => `${w} ${s}px system-ui, "Segoe UI", sans-serif`;
  const mk = (w, h, paint, tile) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); paint(g, w, h);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    if (tile) t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
  };
  const stripes = (g, x, y, w, h, step) => {
    g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip(); g.fillStyle = '#f2c230'; g.fillRect(x, y, w, h); g.fillStyle = '#141414';
    for (let k = x - h; k < x + w + h; k += step) { g.beginPath(); g.moveTo(k, y + h); g.lineTo(k + step / 2, y + h); g.lineTo(k + step / 2 + h, y); g.lineTo(k + h, y); g.closePath(); g.fill(); }
    g.restore();
  };
  const badge = (g, cx, cy, r) => {
    g.beginPath(); g.arc(cx, cy, r, 0, 7); g.fillStyle = '#16324a'; g.fill(); g.lineWidth = r * 0.07; g.strokeStyle = '#e8742a'; g.stroke();
    g.beginPath(); g.arc(cx, cy + r * 0.95, r * 0.8, Math.PI * 1.18, Math.PI * 1.82); g.lineTo(cx + r * 0.6, cy + r * 0.62); g.fillStyle = '#c4552f'; g.fill();
    g.beginPath(); g.arc(cx - r * 0.12, cy + r * 0.28, r * 0.3, Math.PI, 0); g.closePath(); g.fillStyle = '#f1efea'; g.fill();
    g.fillRect(cx + r * 0.18, cy + r * 0.12, r * 0.3, r * 0.16);
    g.fillStyle = '#e8c35a'; g.fillRect(cx + r * 0.3, cy - r * 0.2, r * 0.03, r * 0.32);
    g.beginPath(); g.arc(cx + r * 0.315, cy - r * 0.22, r * 0.05, 0, 7); g.fill();
    g.fillStyle = '#fff'; g.font = F(800, r * 0.2); g.textAlign = 'center'; g.textBaseline = 'middle';
    const w = 'MARSBASEN', span = 1.5;
    [...w].forEach((ch, i) => { const a = -Math.PI / 2 - span / 2 + span * i / (w.length - 1); g.save(); g.translate(cx + Math.cos(a) * r * 0.74, cy + Math.sin(a) * r * 0.74); g.rotate(a + Math.PI / 2); g.fillText(ch, 0, 0); g.restore(); });
  };

  const atlas = mk(A, A, g => {
    g.fillStyle = '#f1efea'; g.fillRect(0, 0, A, A);
    // MARSBASEN sign
    g.fillStyle = '#16324a'; g.fillRect(0, 0, 1024, 205); g.fillStyle = '#e8742a'; g.fillRect(0, 0, 1024, 10); g.fillRect(0, 195, 1024, 10);
    badge(g, 104, 102, 78);
    g.fillStyle = '#ffffff'; g.font = F(900, 128); g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText('MARSBASEN', 210, 108, 790);
    const label = ([x, y, w, h], text, bg = '#f2c230', fg = '#141414') => {
      g.fillStyle = bg; g.fillRect(x, y, w, h); g.fillStyle = fg; g.fillRect(x, y, w, 6); g.fillRect(x, y + h - 6, w, 6);
      g.font = F(900, h * 0.55); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, x + w / 2, y + h / 2 + 3, w - 30);
    };
    label(R.lock, 'LUFTSLUSE'); label(R.rover, 'ROVERSLUSE'); label(R.charge, 'LADESTATION', '#16324a', '#ffffff');
    g.fillStyle = '#39d98a'; g.fillRect(R.charge[0], R.charge[1], 512, 6); g.fillRect(R.charge[0], R.charge[1] + 90, 512, 6);
    label(R.warn, 'ADVARSEL · STRÅLING');
    stripes(g, ...R.hazard, 48);
    g.fillStyle = '#f1efea'; g.fillRect(...R.badge); badge(g, 128, 589, 122);
    // personnel door
    { const [x, y, w, h] = R.door; g.fillStyle = '#6b7075'; g.fillRect(x, y, w, h); g.fillStyle = '#d9d7d1'; g.fillRect(x + 8, y + 8, w - 16, h - 12);
      g.fillStyle = '#b9b9b4'; g.fillRect(x + 8, y + 150, w - 16, 3);
      g.beginPath(); g.arc(x + 64, y + 70, 24, 0, 7); g.fillStyle = '#243240'; g.fill(); g.lineWidth = 6; g.strokeStyle = '#2b2f34'; g.stroke();
      g.fillStyle = '#e8742a'; g.fillRect(x + 92, y + 130, 12, 40); }
    // lit window
    { const [x, y, w, h] = R.win; g.fillStyle = '#3a3f45'; g.fillRect(x, y, w, h);
      const gr = g.createLinearGradient(0, y + 10, 0, y + h - 10); gr.addColorStop(0, '#ffe2a8'); gr.addColorStop(1, '#e29a4e');
      g.fillStyle = gr; g.fillRect(x + 12, y + 12, w - 24, h - 24);
      g.fillStyle = 'rgba(80,50,30,0.55)'; g.fillRect(x + 20, y + 70, 36, 46); g.fillRect(x + 70, y + 60, 30, 56); g.fillStyle = '#3a3f45'; g.fillRect(x + 62, y + 12, 5, h - 24); }
    label(R.lblVand, 'VAND', '#f1efea', '#16324a'); label(R.lblO2, 'O₂', '#f1efea', '#16324a'); label(R.lblCH4, 'CH₄', '#f1efea', '#16324a');
    // rover garage door
    { const [x, y, w, h] = R.garage; stripes(g, x, y, w, h, 56);
      g.fillStyle = '#d6d5d0'; g.fillRect(x + 22, y + 22, w - 44, h - 30);
      for (let k = 0; k < 8; k++) { g.fillStyle = k % 2 ? '#cfcdc7' : '#dcdbd6'; g.fillRect(x + 22, y + 22 + k * 43, w - 44, 43); g.fillStyle = '#a9a8a3'; g.fillRect(x + 22, y + 22 + k * 43, w - 44, 3); }
      g.fillStyle = '#243240'; for (let k = 0; k < 4; k++) g.fillRect(x + 70 + k * 100, y + 80, 70, 26);
      g.fillStyle = '#e8742a'; g.fillRect(x + 22, y + h - 60, w - 44, 16); }
    // solar cells
    { const [x, y] = R.solar; g.fillStyle = '#c9ccd0'; g.fillRect(x, y, 256, 256);
      for (let i = 0; i < 8; i++) for (let j = 0; j < 4; j++) { const gr = g.createLinearGradient(x, y + j * 63, x + 32, y + j * 63 + 60); gr.addColorStop(0, '#2d4d7c'); gr.addColorStop(1, '#172a4e'); g.fillStyle = gr; g.fillRect(x + 4 + i * 31.5, y + 4 + j * 63, 29, 59); } }
    // container side (grey corrugation, tinted by vertex colour)
    { const [x, y] = R.cont; g.fillStyle = '#ffffff'; g.fillRect(x, y, 256, 256);
      for (let k = 0; k < 256; k += 12) { g.fillStyle = '#d4d4d4'; g.fillRect(x + k, y, 4, 256); g.fillStyle = '#f4f4f4'; g.fillRect(x + k + 5, y, 3, 256); }
      g.fillStyle = '#8f8f8f'; g.fillRect(x, y, 256, 10); g.fillRect(x, y + 246, 256, 10); g.fillRect(x, y, 10, 256); g.fillRect(x + 246, y, 10, 256);
      g.fillStyle = '#2b2f34'; g.font = F(800, 30); g.textAlign = 'left'; g.fillText('MB-CARGO', x + 20, y + 40); }
  });
  const panels = mk(512, 512, (g) => {
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { const v = 240 + (rnd() * 14 | 0); g.fillStyle = `rgb(${v},${v},${v - 3})`; g.fillRect(i * 256, j * 256, 256, 256); }
    g.fillStyle = '#b5b5b1'; g.fillRect(0, 0, 512, 4); g.fillRect(0, 0, 4, 512); g.fillRect(254, 0, 4, 512); g.fillRect(0, 254, 512, 4);
    g.fillStyle = '#cfcfcb'; for (let y = 10; y < 512; y += 20) { [7, 261].forEach(x => { g.beginPath(); g.arc(x, y, 2, 0, 7); g.fill(); }); }
  }, true);
  const sand = mk(512, 512, (g) => {
    g.fillStyle = '#8c5234'; g.fillRect(0, 0, 512, 512);
    for (let r = 0; r < 8; r++) for (let c = -1; c < 5; c++) {
      const x = c * 128 + (r % 2) * 64 + (rnd() - 0.5) * 10, y = r * 64 + (rnd() - 0.5) * 4, base = 168 + rnd() * 26;
      const gr = g.createRadialGradient(x + 64, y + 22, 8, x + 64, y + 34, 74);
      gr.addColorStop(0, `rgb(${base + 26},${base * 0.66 + 22},${base * 0.47 + 12})`); gr.addColorStop(1, `rgb(${base - 30},${base * 0.5 - 8},${base * 0.34 - 6})`);
      g.fillStyle = gr; g.beginPath(); g.ellipse(x + 64, y + 33, 66, 34, (rnd() - 0.5) * 0.06, 0, 7); g.fill();
      g.strokeStyle = 'rgba(90,50,30,0.25)'; g.lineWidth = 3; g.beginPath(); g.moveTo(x + 14, y + 36); g.quadraticCurveTo(x + 64, y + 30 + rnd() * 10, x + 114, y + 36); g.stroke();
    }
    for (let k = 0; k < 2500; k++) { g.fillStyle = `rgba(${rnd() > 0.5 ? '200,130,90' : '90,50,30'},0.25)`; g.fillRect(rnd() * 512, rnd() * 512, 2, 2); }
  }, true);
  const fabric = mk(512, 512, (g) => {
    g.fillStyle = '#f4f3ee'; g.fillRect(0, 0, 512, 512);
    for (let k = 0; k < 300; k++) { g.strokeStyle = `rgba(0,0,0,${0.02 + rnd() * 0.03})`; g.lineWidth = 2 + rnd() * 4; g.beginPath(); const x = rnd() * 512, y = rnd() * 512; g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 30, y + 40 + rnd() * 60); g.stroke(); }
    g.fillStyle = '#c8c6bf'; g.fillRect(0, 0, 8, 512); g.fillStyle = '#dcd9d2'; g.fillRect(0, 250, 512, 12);
  }, true);
  const green = mk(512, 256, (g) => {
    const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, '#ffe0a0'); gr.addColorStop(0.45, '#e9a35c'); gr.addColorStop(1, '#5a3a22');
    g.fillStyle = gr; g.fillRect(0, 0, 512, 256);
    g.fillStyle = 'rgba(255,240,200,0.9)'; g.fillRect(20, 26, 472, 6); g.fillRect(20, 110, 472, 5);
    [[70, 22], [150, 18], [226, 16]].forEach(([y, s], row) => {
      g.fillStyle = '#5b4632'; g.fillRect(14, y + s, 484, 7);
      for (let x = 24; x < 490; x += s * 0.9) {
        const c = ['#3f8f3a', '#5fb04a', '#2d6b2e', '#79c25a'][(rnd() * 4) | 0];
        g.fillStyle = c; g.beginPath(); g.ellipse(x + rnd() * 6, y + s * 0.3 + rnd() * 5, s * (0.55 + rnd() * 0.3), s * (0.7 + rnd() * 0.4), 0, 0, 7); g.fill();
        if (row === 0 && rnd() > 0.7) { g.fillStyle = '#e04a3a'; g.beginPath(); g.arc(x + 4, y + 8, 3, 0, 7); g.fill(); }
      }
    });
    g.fillStyle = '#5a5e62'; g.fillRect(0, 0, 512, 10); g.fillRect(0, 0, 10, 256); g.fillRect(250, 0, 8, 256); g.fillRect(0, 128, 512, 5);
  }, true);
  return (_tex = { atlas, panels, sand, fabric, green });
}

export function buildMarsBase(THREE, { sunDir = new THREE.Vector3(0.4, 0.72, 0.56), groundColor = '#9a4f32' } = {}) {
  const T = textures(THREE);
  if (!_mats) {
    const basic = (name, o) => new THREE.MeshBasicMaterial({ name, vertexColors: true, toneMapped: false, ...o });
    _mats = {
      plain: basic('base_plain', { side: THREE.DoubleSide }),
      atlas: basic('base_atlas', { map: T.atlas, side: THREE.DoubleSide }),
      panels: basic('base_panels', { map: T.panels }),
      sand: basic('base_sandbags', { map: T.sand }),
      fabric: basic('base_fabric', { map: T.fabric }),
      green: basic('base_greenhouse', { map: T.green, side: THREE.DoubleSide }),
      ground: basic('base_ground', { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    };
  }
  const s = sunDir.clone().normalize();
  const V2 = (x, y) => new THREE.Vector2(x, y), V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const lin = hex => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const C = {
    white: lin('#eeece6'), grey: lin('#c9cac8'), dgrey: lin('#8e9296'), dark: lin('#2b2f34'), orange: lin('#e8742a'), gold: lin('#d9ad4c'),
    silver: lin('#b7bcc2'), regolith: lin('#b0663f'), dust: lin('#a8603e'), sky: lin('#f3e4d4'), sun: lin('#fff1dc'), bounce: lin('#c0643c'),
    lamp: lin('#ffe6b8'), red: lin('#ff4a3a'), green: lin('#38e07a'), glass: lin('#1a2530'), full: [1, 1, 1], ground: lin(groundColor),
  };

  // ---------- occluders for baked sun shadows ----------
  const OCC = [];
  const box = (x0, y0, z0, x1, y1, z1) => (OCC.push({ b: [x0, y0, z0, x1, y1, z1] }), OCC.length - 1);
  const sph = (x, y, z, r) => (OCC.push({ c: V3(x, y, z), r }), OCC.length - 1);
  function hit(p, d, skip) {
    for (let i = 0; i < OCC.length; i++) {
      if (i === skip) continue; const o = OCC[i];
      if (o.b) {
        let t0 = 0.02, t1 = 1e9; const b = o.b, P = [p.x, p.y, p.z], D = [d.x, d.y, d.z]; let ok = true;
        for (let a = 0; a < 3; a++) {
          if (Math.abs(D[a]) < 1e-8) { if (P[a] < b[a] || P[a] > b[a + 3]) { ok = false; break; } continue; }
          let ta = (b[a] - P[a]) / D[a], tb = (b[a + 3] - P[a]) / D[a]; if (ta > tb) [ta, tb] = [tb, ta];
          t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) { ok = false; break; }
        }
        if (ok) return true;
      } else {
        const oc = p.clone().sub(o.c), b = oc.dot(d), c = oc.lengthSq() - o.r * o.r, disc = b * b - c;
        if (disc >= 0 && -b - Math.sqrt(disc) > 0.02) return true;
      }
    }
    return false;
  }
  const _q = V3(0, 0, 0);
  function shade(p, n, alb, o) {
    const ndl = Math.max(0, n.dot(s));
    let vis = 1;
    if (ndl > 0 && !o.noCast) { _q.copy(p).addScaledVector(n, 0.05); vis = hit(_q, s, o.self ?? -1) ? 0.12 : 1; }
    let ao = (o.ao ?? 1) * (0.7 + 0.3 * sm(-0.3, 2.2, p.y));
    if (n.y < -0.4) ao *= 0.8;
    const amb = (0.33 + 0.11 * (n.y * 0.5 + 0.5)) * ao, bnc = 0.08 * Math.max(0, -n.y) * ao, sun = 0.64 * ndl * vis;
    if (!o.noDust) alb = mix(alb, C.dust, Math.min(1, (sm(2.5, 0, p.y) * 0.55 + (n.y > 0.7 ? 0.12 : 0)) * (o.dust ?? 1)));
    return [0, 1, 2].map(i => alb[i] * (amb * C.sky[i] + bnc * C.bounce[i] + sun * C.sun[i]));
  }

  const B = { plain: [], atlas: [], panels: [], sand: [], fabric: [], green: [], ground: [] };
  const _p = V3(0, 0, 0), _n = V3(0, 0, 0);
  function add(mat, geo, tint, o = {}) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv, col = new Float32Array(P.count * 3);
    for (let i = 0; i < P.count; i++) {
      _p.fromBufferAttribute(P, i); _n.fromBufferAttribute(N, i).normalize();
      if (o.tile) {
        const ax = Math.abs(_n.x), ay = Math.abs(_n.y), az = Math.abs(_n.z), k = o.tile;
        U.setXY(i, ...(ax >= ay && ax >= az ? [_p.z * k, _p.y * k] : ay >= az ? [_p.x * k, _p.z * k] : [_p.x * k, _p.y * k]));
      }
      const alb = typeof tint === 'function' ? tint(_p) : tint;
      col.set(o.emit ? alb : shade(_p, _n, alb, o), i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    B[mat].push(g); return g;
  }

  // ---------- helpers ----------
  const xf = (g, p = [0, 0, 0], r = [0, 0, 0], sc = [1, 1, 1]) => g.applyMatrix4(new THREE.Matrix4().compose(V3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), V3(...sc)));
  const BB = (x0, y0, z0, x1, y1, z1) => xf(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2]);
  const tube = (a, b, r, seg = 6, open = true) => {
    const d = b.clone().sub(a), g = new THREE.CylinderGeometry(r, r, d.length(), seg, 1, open);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), d.clone().normalize()));
    return g.translate(...a.clone().add(b).multiplyScalar(0.5).toArray());
  };
  const toA = (u, v, [x0, y0, w, h]) => [(x0 + 2 + u * (w - 4)) / A, 1 - (y0 + 2 + (1 - v) * (h - 4)) / A];
  const uvRect = (g, rect, rot = false) => { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) { const u = uv.getX(i), v = uv.getY(i); uv.setXY(i, ...(rot ? toA(v, 1 - u, rect) : toA(u, v, rect))); } return g; };
  const plane = (w, h, rect, p, ry = 0, rot = false) => uvRect(xf(new THREE.PlaneGeometry(w, h), p, [0, ry, 0]), rect, rot);
  const scaleUV = (g, su, sv) => { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv); return g; };
  // arch (half superellipse) extruded along X, from x0 to x1; centre zc, half-width w, height h
  function archX(zc, w, h, x0, x1, pw = 0.7, seg = 14) {
    const sh = new THREE.Shape(); for (let i = 0; i <= seg; i++) { const t = Math.PI * i / seg; sh[i ? 'lineTo' : 'moveTo'](zc + w * Math.cos(t), h * Math.pow(Math.sin(t), pw)); }
    const g = new THREE.ExtrudeGeometry(sh, { depth: x1 - x0, bevelEnabled: false, curveSegments: 1 });
    return g.applyMatrix4(new THREE.Matrix4().makeBasis(V3(0, 0, 1), V3(0, 1, 0), V3(-1, 0, 0)).setPosition(x1, 0, 0));
  }
  const lookPlane = (w, h, rect, pos, dir) => { const g = uvRect(new THREE.PlaneGeometry(w, h), rect); g.lookAt(dir); return g.translate(pos.x, pos.y, pos.z); };

  // =============== register occluders first (ids used as `self`) ===============
  const oVest = box(-3, 0, 4, 3, 4.4, 10), oSign = box(-2.6, 4.8, 8.9, 2.6, 6.0, 9.1);
  const oHab = box(-13.5, 0, -8.5, 13.5, 4.6, 2.6);
  const oDomeA = sph(-27, -2, -8, 9), oDomeB = sph(27, -1.5, -12, 8);
  const oGH = box(-22, 0, 4, -12, 3.3, 16), oGar = box(11, 0, 0, 25, 7.8, 14), oBerm = box(25, 0, 0, 27.6, 3.4, 14);
  const oTH = box(30, 0, 2.6, 40.4, 3.3, 14.4), oTV = box(42.2, 0, -3.8, 45.8, 8.8, 5.3);
  const oCont = box(-44, 0, -2, -30, 5.2, 10.2), oDish = sph(-7, 5.2, -16.5, 2.6), oRB = box(28, 0, -38, 52, 2.4, -35);
  const oRover = box(15.8, 0, 16.3, 17.8, 2.2, 20.7);
  const rows = [];
  [-42, -37, -32, -27, -22].forEach(z => rows.push({ x0: -53, x1: -31, z }));
  [-24, -18].forEach(z => rows.push({ x0: 29, x1: 51, z }));
  rows.forEach(r => r.occ = box(r.x0, 0.35, r.z - 0.9, r.x1, 1.9, r.z + 0.9));

  // =============== ENTRANCE (airlock hub) ===============
  add('panels', BB(-3, 0, 4, 3, 4.2, 10), C.white, { tile: 0.25, self: oVest });
  add('plain', BB(-3.15, 4.2, 3.9, 3.15, 4.4, 10.15), C.grey, { self: oVest });
  add('plain', BB(-3.02, 3.55, 9.99, 3.02, 3.8, 10.03), C.orange, { self: oVest });
  [-1, 1].forEach(sg => add('plain', BB(sg > 0 ? 2.99 : -3.03, 3.55, 4, sg > 0 ? 3.03 : -2.99, 3.8, 10.03), C.orange, { self: oVest }));
  add('atlas', plane(1.4, 2.35, R.door, [0, 1.475, 10.03]), C.full, { self: oVest });
  [[-0.85, 1.52], [0.85, 1.52]].forEach(([x, y]) => add('plain', BB(x - 0.12, 0.3, 10.0, x + 0.12, 2.8, 10.12), C.orange, { self: oVest }));
  add('plain', BB(-0.97, 2.68, 10.0, 0.97, 2.84, 10.12), C.orange, { self: oVest });
  [-1.2, 1.2].forEach(x => add('atlas', plane(0.16, 2.5, R.hazard, [x, 1.55, 10.035], 0, true), C.full, { self: oVest }));
  add('plain', BB(-1.7, 0, 10, 1.7, 0.3, 11.9), C.dgrey, { dust: 1.4 });
  add('plain', BB(-1.75, 2.9, 10, 1.75, 3.25, 11.45), C.white, { self: oVest });
  add('atlas', plane(1.7, 0.3, R.lock, [0, 3.075, 11.46]), C.full);
  [-1.45, 1.45].forEach(x => { add('plain', BB(x - 0.16, 2.45, 10.0, x + 0.16, 2.66, 10.16), C.dark, { self: oVest }); add('plain', BB(x - 0.13, 2.48, 10.16, x + 0.13, 2.6, 10.18), C.lamp, { emit: true }); });
  add('atlas', plane(1.3, 1.3, R.badge, [-2.2, 1.9, 10.03]), C.full, { self: oVest });
  add('atlas', plane(0.95, 0.95, R.win, [2.2, 1.9, 10.03]), C.full, { emit: true });
  [-2.8, 2.8].forEach(z => add('atlas', plane(0.9, 0.9, R.win, [3.03, 1.9, 7 + z * 0.35], Math.PI / 2), C.full, { emit: true }));
  [-2.2, 2.2].forEach(x => add('plain', BB(x - 0.07, 4.4, 8.93, x + 0.07, 4.85, 9.07), C.dgrey));
  add('plain', BB(-2.62, 4.78, 8.9, 2.62, 6.02, 9.1), C.dark, { self: oSign });
  add('atlas', plane(5.1, 1.02, R.sign, [0, 5.4, 9.11]), C.full, { self: oSign, ao: 1.08 });
  add('plain', BB(-2.5, 6.02, 9.05, 2.5, 6.12, 9.35), C.dgrey, { self: oSign });
  [-1.6, 0, 1.6].forEach(x => add('plain', BB(x - 0.12, 5.98, 9.28, x + 0.12, 6.03, 9.42), C.lamp, { emit: true }));
  // light poles along the approach
  [[-7, 12], [7, 12], [-7, 18], [7, 18]].forEach(([x, z]) => {
    add('plain', tube(V3(x, 0, z), V3(x, 4.2, z), 0.08, 6), C.dgrey);
    add('plain', BB(x - 0.25, 4.15, z - 0.2, x + 0.25, 4.35, z + 0.2), C.dark);
    add('plain', BB(x - 0.2, 4.1, z - 0.15, x + 0.2, 4.15, z + 0.15), C.lamp, { emit: true });
  });

  // =============== MAIN HABITAT (regolith-covered, half-buried) ===============
  add('sand', archX(-3, 7, 5.5, -9, 9), C.full, { tile: 0.42, self: oHab });
  [-1, 1].forEach(sg => add('sand', xf(new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), [sg * 9, 0, -3], [0, 0, 0], [6, 5.5, 7]), C.full, { tile: 0.42, self: oHab }));
  [[-6.5, 3.92], [6.5, 3.92], [-11.2, 3.3], [11.2, 3.3]].forEach(([x, z]) => {
    add('plain', BB(x - 0.8, 0.9, z - 0.6, x + 0.8, 2.3, z + 0.7), C.grey, { self: oHab });
    add('plain', BB(x - 0.9, 2.3, z - 0.6, x + 0.9, 2.42, z + 0.85), C.orange, { self: oHab });
    add('atlas', plane(1.2, 1.0, R.win, [x, 1.6, z + 0.71]), C.full, { emit: true });
  });
  [[-4, -3, 1.3], [5, -5, 1.0], [-7, -6, 0.9]].forEach(([x, z, h]) => {
    const y = 5.5 * Math.pow(Math.sin(Math.acos((z + 3) / 7)), 0.7) - 0.2;
    add('plain', tube(V3(x, y, z), V3(x, y + h, z), 0.3, 10, false), C.silver);
    add('plain', xf(new THREE.CylinderGeometry(0.42, 0.42, 0.12, 10), [x, y + h + 0.1, z]), C.dgrey);
  });
  add('plain', BB(-1, 5.35, -4.5, 1, 5.75, -2.5), C.grey, { self: oHab });
  add('plain', BB(-0.9, 5.75, -4.4, 0.9, 5.8, -2.6), C.orange);

  // =============== INFLATABLE DOMES + covered tunnels ===============
  [[-27, -2, -8, 9, oDomeA], [27, -1.5, -12, 8, oDomeB]].forEach(([x, cy, z, r, id]) => {
    const th = Math.acos(-cy / r);
    add('fabric', scaleUV(xf(new THREE.SphereGeometry(r, 30, 12, 0, Math.PI * 2, 0, th), [x, cy, z]), 10, 3), C.white, { self: id });
    const rb = r + 0.5, t1 = Math.acos((2.8 - cy) / rb), t2 = Math.acos(-cy / rb);
    add('sand', xf(new THREE.SphereGeometry(rb, 30, 3, 0, Math.PI * 2, t1, t2 - t1), [x, cy, z]), C.full, { tile: 0.42, self: id });
    add('plain', xf(new THREE.TorusGeometry(Math.sin(t1) * rb - 0.1, 0.12, 4, 30), [x, cy + Math.cos(t1) * rb, z], [Math.PI / 2, 0, 0]), C.orange, { self: id });
    const d = V3(0, 0.62, 0.78).normalize(), wp = V3(x, cy, z).addScaledVector(d, r + 0.04);
    add('plain', (() => { const g = new THREE.PlaneGeometry(2.8, 1.1); g.lookAt(d); return g.translate(wp.x, wp.y, wp.z); })(), C.dark, { self: id });
    [-0.7, 0.7].forEach(dx => { const p = wp.clone().add(V3(dx, 0, 0)).addScaledVector(d, 0.02); add('atlas', lookPlane(1.1, 0.85, R.win, p, d), C.full, { emit: true }); });
  });
  add('sand', archX(-4, 1.9, 2.4, -19, -13.5, 0.8, 10), C.full, { tile: 0.42 });
  add('sand', archX(-6, 1.9, 2.4, 13.5, 19.6, 0.8, 10), C.full, { tile: 0.42 });

  // =============== GREENHOUSE (front-left) ===============
  {
    const cx = -17, w = 5, h = 4.2, z0 = 4, z1 = 16;
    add('green', scaleUV(xf(new THREE.CylinderGeometry(1, 1, z1 - z0, 20, 1, true, -Math.PI / 2, Math.PI), [cx, 0, (z0 + z1) / 2], [-Math.PI / 2, 0, 0], [w, 1, h]), 5, 6), C.full, { emit: true });
    for (let z = z0; z <= z1 + 0.01; z += 2) add('plain', xf(new THREE.TorusGeometry(1, 0.012, 4, 20, Math.PI), [cx, 0, z], [0, 0, 0], [w + 0.04, h + 0.04, 4]), C.dgrey);
    const endShape = new THREE.Shape(); for (let i = 0; i <= 20; i++) { const t = Math.PI * i / 20; endShape[i ? 'lineTo' : 'moveTo'](cx + w * Math.cos(t), h * Math.sin(t)); }
    [z0, z1].forEach(z => add('plain', new THREE.ShapeGeometry(endShape).translate(0, 0, z + (z === z1 ? 0.01 : -0.01)), C.white, { self: oGH }));
    add('atlas', plane(1.2, 2.2, R.door, [cx, 1.1, z1 + 0.03]), C.full);
    add('plain', BB(cx - 0.75, 0, z1, cx + 0.75, 2.4, z1 + 0.03), C.orange, { self: oGH });
    [-3, 3].forEach(dx => add('atlas', plane(1.3, 1.1, R.win, [cx + dx, 1.6, z1 + 0.03]), C.full, { emit: true }));
    [-1, 1].forEach(sg => add('sand', BB(cx + sg * w - 0.5, 0, z0 - 0.3, cx + sg * w + 0.5, 0.75, z1 + 0.3), C.full, { tile: 0.42, self: oGH }));
  }

  // =============== GARAGE + rover airlock + charging (front-right) ===============
  add('panels', BB(11, 0, 0, 25, 7, 14), C.white, { tile: 0.25, self: oGar });
  add('sand', BB(10.6, 7, -0.4, 25.4, 7.8, 14.4), C.full, { tile: 0.42, self: oGar });
  { const sh = new THREE.Shape([V2(25, 0), V2(29.2, 0), V2(25, 6.8)]); add('sand', new THREE.ExtrudeGeometry(sh, { depth: 14.4, bevelEnabled: false }).translate(0, 0, -0.2), C.full, { tile: 0.42, self: oBerm }); }
  add('plain', BB(11, 6.2, 14, 25, 6.5, 14.05), C.orange, { self: oGar });
  add('atlas', plane(6, 4.6, R.garage, [18, 2.3, 14.03]), C.full, { self: oGar });
  [[14.85, 15.15], [20.85, 21.15]].forEach(([a, b]) => add('plain', BB(a, 0, 14, b, 4.9, 14.25), C.orange, { self: oGar }));
  add('plain', BB(14.85, 4.6, 14, 21.15, 4.9, 14.25), C.orange, { self: oGar });
  add('atlas', plane(3.4, 0.64, R.rover, [18, 5.45, 14.03]), C.full, { self: oGar });
  [14.3, 21.7].forEach(x => { add('plain', BB(x - 0.2, 5.0, 14, x + 0.2, 5.25, 14.3), C.dark); add('plain', BB(x - 0.16, 4.96, 14.02, x + 0.16, 5.0, 14.26), C.lamp, { emit: true }); });
  add('atlas', plane(2.4, 2.4, R.badge, [12.9, 3.6, 14.03]), C.full, { self: oGar });
  add('plain', BB(14.5, 0, 14, 21.5, 0.1, 16), C.dgrey, { dust: 1.5 });
  add('atlas', plane(1.0, 2.0, R.door, [11 - 0.03, 1.0, 11.5], -Math.PI / 2), C.full, { self: oGar });
  add('atlas', plane(1.2, 1.0, R.win, [11 - 0.03, 2.6, 8.5], -Math.PI / 2), C.full, { emit: true });
  // charging station
  add('plain', BB(12.9, 0, 16.3, 13.6, 1.5, 16.8), C.white);
  add('plain', BB(12.85, 1.5, 16.25, 13.65, 1.62, 16.85), C.orange);
  add('plain', BB(13.1, 1.2, 16.81, 13.4, 1.32, 16.83), C.green, { emit: true });
  add('plain', tube(V3(13.25, 0, 17.6), V3(13.25, 2.4, 17.6), 0.05, 6), C.dgrey);
  add('atlas', plane(1.5, 0.3, R.charge, [13.25, 2.2, 17.66]), C.full);
  const cab = [V3(13.6, 0.9, 16.8), V3(14.4, 0.25, 17.3), V3(15.2, 0.08, 17.9), V3(15.9, 0.6, 18.3)];
  for (let i = 0; i < cab.length - 1; i++) add('plain', tube(cab[i], cab[i + 1], 0.045, 5), C.dark);
  [[14.4, 15.9, 16.1, 16.2], [14.4, 19.2, 21.8, 21.9], [14.4, 16.1, 14.5, 21.9], [19.1, 16.1, 19.2, 21.9]].forEach(([x0, z0, x1, z1]) => add('plain', BB(x0, 0, z0, x1, 0.04, z1), C.orange, { noDust: true }));
  // small utility rover (parked at the charger)
  {
    const rx = 16.8, rz = 18.5;
    add('plain', BB(rx - 0.95, 0.55, rz - 2.1, rx + 0.95, 0.9, rz + 2.1), C.gold, { self: oRover });
    add('plain', BB(rx - 0.85, 0.9, rz - 0.4, rx + 0.85, 2.1, rz + 1.9), C.white, { self: oRover });
    add('plain', BB(rx - 0.86, 1.45, rz + 0.2, rx + 0.86, 1.85, rz + 1.91), C.glass, { self: oRover });
    add('plain', BB(rx - 0.8, 0.9, rz - 2.0, rx + 0.8, 1.3, rz - 0.5), C.grey, { self: oRover });
    add('plain', BB(rx - 0.4, 2.1, rz + 0.8, rx + 0.4, 2.18, rz + 1.2), C.orange);
    [-1.5, 0, 1.5].forEach(dz => [-1, 1].forEach(sg => add('plain', xf(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 12), [rx + sg * 1.05, 0.42, rz + dz], [0, 0, Math.PI / 2]), C.dark, { dust: 1.6 })));
  }

  // =============== STORAGE: tanks (right) and containers (left) ===============
  [[4, R.lblVand], [8.5, R.lblO2], [13, R.lblCH4]].forEach(([z, lbl]) => {
    add('plain', xf(new THREE.CylinderGeometry(1.4, 1.4, 9, 16, 1, true), [35, 1.9, z], [0, 0, Math.PI / 2]), C.white, { self: oTH });
    [-1, 1].forEach(sg => add('plain', xf(new THREE.SphereGeometry(1.4, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2), [35 + sg * 4.5, 1.9, z], [0, 0, -sg * Math.PI / 2], [1, 0.45, 1]), C.white, { self: oTH }));
    [31.5, 38.5].forEach(x => add('plain', xf(new THREE.CylinderGeometry(1.43, 1.43, 0.35, 16, 1, true), [x, 1.9, z], [0, 0, Math.PI / 2]), C.orange, { self: oTH }));
    [31, 35, 39].forEach(x => add('plain', BB(x - 0.25, 0, z - 1.1, x + 0.25, 0.9, z + 1.1), C.dgrey, { self: oTH }));
    add('atlas', plane(1.2, 0.9, lbl, [35, 2.6, z + 1.25], 0), C.full, { self: oTH });
  });
  [-1.2, 3.8].forEach(z => {
    add('plain', xf(new THREE.CylinderGeometry(1.8, 1.8, 7, 16, 1, true), [44, 3.5, z]), C.white, { self: oTV });
    add('plain', xf(new THREE.SphereGeometry(1.8, 16, 5, 0, Math.PI * 2, 0, Math.PI / 2), [44, 7, z], [0, 0, 0], [1, 0.5, 1]), C.white, { self: oTV });
    add('plain', xf(new THREE.CylinderGeometry(1.83, 1.83, 0.4, 16, 1, true), [44, 5.6, z]), C.orange, { self: oTV });
    add('atlas', plane(0.3, 5.0, R.hazard, [44, 3.0, z + 1.82], 0, true), C.full, { self: oTV });
  });
  add('plain', tube(V3(40.3, 1.2, 8.5), V3(42.6, 1.2, 3.8), 0.14, 6), C.silver);
  add('plain', tube(V3(29.5, 0.9, 8.5), V3(25.8, 0.9, 8.5), 0.16, 6), C.silver);
  const cont = (x, y, z, rotY, tint) => add('atlas', uvRect(xf(new THREE.BoxGeometry(6.1, 2.6, 2.44), [x, y + 1.3, z], [0, rotY, 0]), R.cont), tint, { self: oCont });
  cont(-37, 0, 0, 0, C.orange); cont(-37, 0, 3, 0, C.white); cont(-37, 2.6, 1.5, 0.05, C.orange);
  cont(-37.5, 0, 7.5, 0, C.white); cont(-31.5, 0, 9, Math.PI / 2 - 0.08, C.orange); cont(-43, 0, 4.5, Math.PI / 2, C.white);

  // =============== ENERGY: solar fields + kilopower behind a berm ===============
  rows.forEach(r => {
    for (let x = r.x0 + 2.75; x < r.x1; x += 5.5) {
      add('atlas', uvRect(xf(new THREE.BoxGeometry(5.3, 0.06, 2.2), [x, 1.25, r.z], [0.44, 0, 0]), R.solar), C.full, { noDust: true, self: r.occ });
      [-1.8, 1.8].forEach(dx => add('plain', BB(x + dx - 0.06, 0, r.z - 0.06, x + dx + 0.06, 1.2, r.z + 0.06), C.dgrey, { self: r.occ }));
    }
  });
  add('plain', xf(new THREE.SphereGeometry(1, 20, 6, 0, Math.PI * 2, 0, Math.PI / 2), [40, 0, -36.5], [0, 0, 0], [12.5, 2.6, 2.6]), C.regolith, { self: oRB, dust: 0 });
  add('plain', BB(38, 0, -44.5, 42, 0.3, -40.5), C.dgrey);
  add('plain', xf(new THREE.CylinderGeometry(0.5, 0.55, 2.2, 12), [40, 1.4, -42.5]), C.silver);
  add('plain', xf(new THREE.CylinderGeometry(2.6, 0.55, 2.0, 16, 1, true), [40, 3.5, -42.5]), C.white);
  add('plain', tube(V3(40, 4.5, -42.5), V3(40, 5.3, -42.5), 0.06, 6), C.dgrey);
  add('plain', tube(V3(33, 0, -33.5), V3(33, 2.2, -33.5), 0.06, 6), C.dgrey);
  add('atlas', plane(2.6, 0.5, R.warn, [33, 2.1, -33.44]), C.full);

  // =============== COMMUNICATION: lattice mast + dish ===============
  {
    const mx = 6, mz = -18, H = 18, leg = k => { const a = k * Math.PI * 2 / 3 + 0.3; return t => V3(mx + Math.cos(a) * (0.9 - 0.5 * t), H * t, mz + Math.sin(a) * (0.9 - 0.5 * t)); };
    const L = [leg(0), leg(1), leg(2)];
    L.forEach(f => add('plain', tube(f(0), f(1), 0.07, 5), C.white));
    for (let i = 0; i < 6; i++) { const t0 = i / 6, t1 = (i + 1) / 6; for (let k = 0; k < 3; k++) { add('plain', tube(L[k](t1), L[(k + 1) % 3](t1), 0.03, 4), C.orange); add('plain', tube(L[k](t0), L[(k + 1) % 3](t1), 0.025, 4), C.white); } }
    add('plain', xf(new THREE.SphereGeometry(0.16, 8, 6), [mx, H + 0.25, mz]), C.red, { emit: true });
    add('plain', tube(V3(mx, H, mz), V3(mx, H + 1.4, mz), 0.03, 4), C.dgrey);
    [0, 1, 2].forEach(k => { const a = k * Math.PI * 2 / 3 + 0.3; add('plain', tube(V3(mx, 13, mz), V3(mx + Math.cos(a) * 9, 0, mz + Math.sin(a) * 9), 0.025, 3), C.dgrey, { noCast: true }); });
    const dx = -7, dz = -16.5;
    add('plain', xf(new THREE.CylinderGeometry(0.5, 0.7, 3.4, 10), [dx, 1.7, dz]), C.white, { self: oDish });
    add('plain', BB(dx - 0.5, 3.4, dz - 0.4, dx + 0.5, 4.0, dz + 0.4), C.dgrey, { self: oDish });
    const pts = []; for (let i = 0; i <= 8; i++) { const r = 3.2 * i / 8; pts.push(V2(Math.max(0.01, r), r * r * 0.085)); }
    const dish = new THREE.LatheGeometry(pts, 24); dish.rotateX(0.62);
    add('plain', dish.translate(dx, 4.6, dz), C.white, { self: oDish });
    const fd = V3(0, Math.cos(0.62), Math.sin(0.62)), feed = V3(dx, 4.6, dz).addScaledVector(fd, 2.4);
    [[-1.6, 0], [1.6, 0], [0, 1.6]].forEach(([ox, oy]) => add('plain', tube(V3(dx + ox, 4.6 + oy * 0.6, dz + oy * 0.6 * 0 - (oy ? 0.8 : 0) + 0.2), feed, 0.03, 4), C.dgrey));
    add('plain', xf(new THREE.CylinderGeometry(0.15, 0.22, 0.45, 8), feed.toArray(), [0.62, 0, 0]), C.dark);
  }

  // =============== GROUND: baked shadows, AO, tracks, paths ===============
  const footprints = OCC.map(o => o.b ? { b: o.b } : { c: o.c, r: Math.sqrt(Math.max(0, o.r * o.r - o.c.y * o.c.y)) });
  const jitter = [[0, 0], [1.3, 0], [-1.3, 0], [0, 1.3], [0, -1.3], [0.9, 0.9], [-0.9, 0.9], [0.9, -0.9], [-0.9, -0.9]];
  const _g = V3(0, 0, 0);
  function groundK(x, z) {
    let v = 0;
    for (const [jx, jz] of jitter) { _g.set(x + jx, 0.05, z + jz); v += hit(_g, s, -1) ? 1 : 0; }
    const sh = v / jitter.length * 0.52 * sm(0.02, 0.25, s.y);
    let ao = 0;
    for (const f of footprints) {
      let d;
      if (f.b) { const dx = Math.max(f.b[0] - x, 0, x - f.b[3]), dz = Math.max(f.b[2] - z, 0, z - f.b[5]); d = Math.hypot(dx, dz); if (f.b[4] - f.b[1] < 2.2 && f.b[1] > 0.2) d += 1.5; }
      else d = Math.max(0, Math.hypot(x - f.c.x, z - f.c.z) - f.r);
      ao = Math.max(ao, (1 - sm(0, 2.8, d)) * 0.28);
    }
    return 1 - Math.max(sh, ao);
  }
  {
    const X0 = -66, X1 = 66, Z0 = -56, Z1 = 66, st = 2, nx = Math.round((X1 - X0) / st), nz = Math.round((Z1 - Z0) / st);
    const pos = [], col = [], idx = [];
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
      const x = X0 + i * st, z = Z0 + j * st, u = i / nx * 2 - 1, v = j / nz * 2 - 1;
      const edge = sm(0.86, 1.0, Math.max(Math.abs(u), Math.abs(v)));
      const k = 1 - (1 - groundK(x, z)) * (1 - edge);
      pos.push(x, 0.02, z); col.push(C.ground[0] * k, C.ground[1] * k, C.ground[2] * k);
    }
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx);
    const ng = g.toNonIndexed(); ng.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(ng.attributes.position.count * 3).map((_, i) => i % 3 === 1 ? 1 : 0), 3));
    ng.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(ng.attributes.position.count * 2), 2));
    B.ground.push(ng);
  }
  // strips: polyline → 3-wide triangle strip, centre darker, edges = baked ground
  function strip(pts, width, dark, y = 0.04) {
    const P = [], Cc = [];
    const smooth = []; for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 2.5)); for (let k = 0; k < n; k++) smooth.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]); }
    smooth.push(pts[pts.length - 1]);
    const rowsV = smooth.map((p, i) => {
      const a = smooth[Math.max(0, i - 1)], b = smooth[Math.min(smooth.length - 1, i + 1)];
      const t = V2(b[0] - a[0], b[1] - a[1]).normalize(), nrm = V2(-t.y, t.x);
      return [-1, 0, 1].map(o => { const x = p[0] + nrm.x * o * width / 2, z = p[1] + nrm.y * o * width / 2, k = groundK(x, z) * (o === 0 ? dark : 1); return [x, z, k]; });
    });
    for (let i = 0; i < rowsV.length - 1; i++) for (let o = 0; o < 2; o++) {
      const q = [rowsV[i][o], rowsV[i][o + 1], rowsV[i + 1][o], rowsV[i + 1][o + 1]];
      [[0, 2, 1], [1, 2, 3]].forEach(tri => tri.forEach(k => { const [x, z, kk] = q[k]; P.push(x, y, z); Cc.push(C.ground[0] * kk, C.ground[1] * kk, C.ground[2] * kk); }));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(P.length).map((_, i) => i % 3 === 1 ? 1 : 0), 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(P.length / 3 * 2), 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(Cc, 3));
    B.ground.push(g);
  }
  strip([[0, 64], [0, 12.2]], 6.5, 0.9, 0.03);
  [-1.18, 1.18].forEach(x => strip([[x, 64], [x, 12.5]], 0.55, 0.72));
  [-0.85, 0.85].forEach(o => strip([[1 + o, 26], [6 + o, 23 + o * 0.3], [12 + o * 0.6, 20.5 + o * 0.6], [16 + o * 0.9, 18.5 + o * 0.9], [18 + o, 15.5]], 0.45, 0.74));
  [-0.85, 0.85].forEach(o => strip([[24, 16 + o], [30, 17 + o], [37, 17.2 + o], [42, 12 + o]], 0.45, 0.76));
  strip([[-1.8, 12.2], [-8, 14.2], [-13, 16.8], [-17, 17.6]], 1.3, 0.84);
  strip([[-14, -6], [-20, -14], [-28, -20], [-35, -21]], 1.2, 0.86);
  strip([[40, -37], [32, -26], [20, -14], [12, -9]], 0.8, 0.78);
  strip([[-18, 0], [-26, 3], [-32, 5.5]], 1.4, 0.82);

  // ---------- merge ----------
  const group = new THREE.Group(); group.name = 'MarsBase';
  for (const k of Object.keys(B)) {
    if (!B[k].length) continue;
    let n = 0; B[k].forEach(g => n += g.attributes.position.count);
    const out = new THREE.BufferGeometry();
    ['position', 'normal', 'uv', 'color'].forEach(a => {
      const size = a === 'uv' ? 2 : 3, arr = new Float32Array(n * size); let o = 0;
      B[k].forEach(g => { arr.set(g.attributes[a].array, o); o += g.attributes[a].array.length; });
      out.setAttribute(a, new THREE.BufferAttribute(arr, size));
    });
    out.computeBoundingSphere();
    const m = new THREE.Mesh(out, _mats[k]); m.name = _mats[k].name;
    if (k === 'ground') m.renderOrder = -1;
    group.add(m);
  }
  return { group };
}
