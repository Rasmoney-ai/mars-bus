// Landingsmodul LM-03 for Mars-bus R-10 — three.js, WebXR / Meta Quest 3.
//   import { buildLander } from './lander.js';
//   const { group } = buildLander(THREE, { sunDir, groundColor });
// 1 unit = 1 m, y-up. Origin at ground level under the centre of the lander.
// Hatch and stairs face +Z. Lighting is baked into vertex colours from sunDir
// (model space). All materials are MeshBasicMaterial with vertexColors — no scene lights needed.
// Needs a DOM for the 1024×1024 canvas atlas.

let _atlas = null, _mats = null;
const A = 1024;
const RECT = {
  hull: [0, 0, 512, 512], foil: [512, 0, 256, 256], lock: [768, 0, 256, 64], hazard: [768, 64, 256, 64],
  warn: [512, 256, 512, 128], serial: [512, 384, 512, 128], badge: [0, 512, 256, 256],
  solar: [256, 512, 256, 256], rad: [512, 512, 256, 256],
};

function makeAtlas(THREE) {
  const c = document.createElement('canvas'); c.width = c.height = A;
  const g = c.getContext('2d');
  const F = (w, s) => `${w} ${s}px system-ui, "Segoe UI", sans-serif`;
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, A, A);

  // hull panels: 3 × 6
  for (let i = 0; i < 3; i++) for (let j = 0; j < 6; j++) {
    const v = 244 + (rnd() * 11 | 0); g.fillStyle = `rgb(${v},${v},${v - 2})`;
    g.fillRect(i * 171, j * 85.3, 171, 86);
  }
  g.fillStyle = '#b9b9b6';
  for (let i = 0; i <= 3; i++) g.fillRect(i * 170.6 - 1.5, 0, 3, 512);
  for (let j = 0; j <= 6; j++) g.fillRect(0, j * 85.3 - 1.5, 512, 3);
  g.fillStyle = '#cfcfcb';
  for (let i = 0; i <= 3; i++) for (let y = 8; y < 512; y += 14) { g.beginPath(); g.arc(i * 170.6 + 7, y, 1.6, 0, 7); g.fill(); }
  g.fillStyle = '#d6d6d2'; for (let k = 0; k < 6; k++) g.fillRect(20 + rnd() * 450, 20 + rnd() * 470, 26, 12); // access plates

  // gold foil
  g.save(); g.beginPath(); g.rect(512, 0, 256, 256); g.clip();
  g.fillStyle = '#d6a33c'; g.fillRect(512, 0, 256, 256);
  for (let k = 0; k < 170; k++) {
    const x = 512 + rnd() * 256, y = rnd() * 256, r = 10 + rnd() * 26, a = rnd() * 6;
    g.beginPath(); for (let q = 0; q < 5; q++) { const t = a + q * 1.3 + rnd() * 0.5; g.lineTo(x + Math.cos(t) * r * (0.6 + rnd() * 0.6), y + Math.sin(t) * r * (0.6 + rnd() * 0.6)); }
    const l = rnd(); g.fillStyle = l > 0.5 ? `rgba(255,226,140,${0.25 + rnd() * 0.3})` : `rgba(120,80,20,${0.2 + rnd() * 0.3})`; g.fill();
  }
  g.strokeStyle = 'rgba(90,60,15,0.5)'; g.lineWidth = 1.5;
  for (let k = 0; k < 40; k++) { g.beginPath(); const x = 512 + rnd() * 256, y = rnd() * 256; g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 80, y + (rnd() - 0.5) * 80); g.stroke(); }
  g.restore();

  const stripes = (x, y, w, h, step) => {
    g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip(); g.fillStyle = '#f2c230'; g.fillRect(x, y, w, h); g.fillStyle = '#141414';
    for (let k = x - h; k < x + w + h; k += step) { g.beginPath(); g.moveTo(k, y + h); g.lineTo(k + step / 2, y + h); g.lineTo(k + step / 2 + h, y); g.lineTo(k + h, y); g.closePath(); g.fill(); }
    g.restore();
  };
  // airlock sign + hazard strip
  g.fillStyle = '#f2c230'; g.fillRect(768, 0, 256, 64); g.fillStyle = '#141414'; g.fillRect(768, 0, 256, 5); g.fillRect(768, 59, 256, 5);
  g.font = F(900, 40); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('LUFTSLUSE', 896, 34);
  stripes(768, 64, 256, 64, 48);
  // engine warning band
  stripes(512, 256, 512, 30, 40); stripes(512, 354, 512, 30, 40);
  g.fillStyle = '#f2c230'; g.fillRect(512, 286, 512, 68);
  g.fillStyle = '#141414'; g.font = F(900, 40); g.fillText('ADVARSEL · MOTORZONE', 768, 322, 480);
  // serial number
  g.fillStyle = '#f4f3ef'; g.fillRect(512, 384, 512, 128);
  g.fillStyle = '#1c2830'; g.font = F(900, 104); g.fillText('LM-03', 700, 452);
  g.font = F(700, 30); g.textAlign = 'left'; g.fillText('MARSTUR', 866, 430); g.fillText('R-10', 866, 470);

  // mission badge (same as bus)
  const bx = 128, by = 640, s = 256, R = s * 0.48;
  g.fillStyle = '#f4f3ef'; g.fillRect(0, 512, 256, 256);
  g.beginPath(); g.arc(bx, by, R, 0, 7); g.fillStyle = '#16324a'; g.fill(); g.lineWidth = 8; g.strokeStyle = '#e8c35a'; g.stroke();
  g.beginPath(); g.arc(bx, by + 3, s * 0.2, 0, 7); g.fillStyle = '#c4552f'; g.fill();
  g.fillStyle = '#a2401f'; [[-14, -10, 14], [18, 14, 10], [-4, 24, 8]].forEach(([dx, dy, r]) => { g.beginPath(); g.arc(bx + dx, by + 3 + dy, r, 0, 7); g.fill(); });
  g.save(); g.translate(bx, by + 3); g.rotate(-0.32); g.beginPath(); g.ellipse(0, 0, s * 0.33, s * 0.1, 0, 0, 7); g.lineWidth = 4; g.strokeStyle = '#e8c35a'; g.stroke();
  g.beginPath(); g.arc(s * 0.3, s * 0.045, 6, 0, 7); g.fillStyle = '#fff'; g.fill(); g.restore();
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.font = F(800, 26);
  [...'MARSTUR'].forEach((ch, i) => { const a = -Math.PI / 2 - 0.625 + 1.25 * i / 6; g.save(); g.translate(bx + Math.cos(a) * 97, by + Math.sin(a) * 97); g.rotate(a + Math.PI / 2); g.fillText(ch, 0, 0); g.restore(); });
  g.font = F(800, 30); g.fillText('R-10', bx, by + 97);

  // solar cells
  g.fillStyle = '#c9ccd0'; g.fillRect(256, 512, 256, 256);
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
    const x = 262 + i * 41, y = 518 + j * 41, gr = g.createLinearGradient(x, y, x + 38, y + 38);
    gr.addColorStop(0, '#2b4a78'); gr.addColorStop(1, '#16274a'); g.fillStyle = gr; g.fillRect(x, y, 38, 38);
    g.fillStyle = 'rgba(200,215,235,0.35)'; g.fillRect(x, y + 12, 38, 1); g.fillRect(x, y + 25, 38, 1);
  }
  // radiator
  g.fillStyle = '#f1f1ee'; g.fillRect(512, 512, 256, 256);
  g.fillStyle = '#c3c5c7'; for (let x = 520; x < 768; x += 16) g.fillRect(x, 520, 4, 240);
  g.fillStyle = '#9ea2a6'; g.fillRect(512, 512, 256, 8); g.fillRect(512, 760, 256, 8);

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.name = 'lander_atlas';
  return t;
}

export function buildLander(THREE, { sunDir = new THREE.Vector3(0.45, 0.75, 0.5), groundColor = '#9a4f32' } = {}) {
  if (!_atlas) _atlas = makeAtlas(THREE);
  if (!_mats) _mats = {
    atlas: new THREE.MeshBasicMaterial({ name: 'lander_atlas', map: _atlas, vertexColors: true, side: THREE.DoubleSide, toneMapped: false }),
    plain: new THREE.MeshBasicMaterial({ name: 'lander_plain', vertexColors: true, side: THREE.DoubleSide, toneMapped: false }),
    shadow: new THREE.MeshBasicMaterial({ name: 'lander_ground_shadow', vertexColors: true, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  };
  const s = sunDir.clone().normalize();
  const V2 = (x, y) => new THREE.Vector2(x, y), V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const lin = hex => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

  const C = {
    white: lin('#eeece6'), silver: lin('#b7bcc2'), dark: lin('#2b2f34'), metal: lin('#8e9398'), door: lin('#dcd9d2'),
    soot: lin('#16130f'), bronze: lin('#6e6258'), glassTop: lin('#51687c'), glassBot: lin('#0a1017'),
    dust: lin('#a8603e'), sky: lin('#f3e4d4'), sun: lin('#fff1dc'), bounce: lin('#c0643c'),
    lamp: lin('#fff1cf'), red: lin('#ff4a3a'), green: lin('#38e07a'), ground: lin(groundColor), full: [1, 1, 1],
  };

  // ---------- baking ----------
  const HULL_R = 3.1;
  function inShadow(p) {
    const r2 = p.x * p.x + p.z * p.z;
    if (r2 < 3.14 * 3.14 && p.y > 1.2 && p.y < 11.6) return false;
    const a = s.x * s.x + s.z * s.z; if (a < 1e-6) return false;
    const b = 2 * (p.x * s.x + p.z * s.z), c = r2 - HULL_R * HULL_R, disc = b * b - 4 * a * c;
    if (disc < 0) return false;
    const t0 = (-b - Math.sqrt(disc)) / (2 * a); if (t0 <= 0) return false;
    const y = p.y + t0 * s.y; return y > 1.25 && y < 11.5;
  }
  function shade(p, n, albedo, o) {
    const ndl = Math.max(0, n.x * s.x + n.y * s.y + n.z * s.z);
    const vis = o.noCast ? 1 : inShadow(p) ? 0.1 : 1;
    let ao = o.ao ?? 1;
    const r = Math.hypot(p.x, p.z);
    if (r < 3.4 && p.y < 1.45) ao *= 0.55;
    if (n.y < -0.4) ao *= 0.82;
    ao *= 0.72 + 0.28 * sm(-0.2, 1.4, p.y);
    const amb = (0.34 + 0.1 * (n.y * 0.5 + 0.5)) * ao, bnc = 0.09 * Math.max(0, -n.y) * ao, sun = 0.64 * ndl * vis;
    let alb = albedo;
    if (!o.noDust) {
      const d = sm(2.8, 0.1, p.y) * (0.3 + 0.7 * Math.max(0, n.y)) * 0.72 * (o.dust ?? 1);
      alb = mix(alb, C.dust, Math.min(1, d));
    }
    return [0, 1, 2].map(i => alb[i] * (amb * C.sky[i] + bnc * C.bounce[i] + sun * C.sun[i]));
  }

  const B = { atlas: [], plain: [], shadow: [] };
  const _p = V3(0, 0, 0), _n = V3(0, 0, 0);
  function add(mat, geo, tint, o = {}) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    const P = g.attributes.position, N = g.attributes.normal, col = new Float32Array(P.count * 3);
    for (let i = 0; i < P.count; i++) {
      _p.fromBufferAttribute(P, i); _n.fromBufferAttribute(N, i).normalize();
      if (o.out && (_n.x * _p.x + _n.z * _p.z) < 0) { _n.negate(); N.setXYZ(i, _n.x, _n.y, _n.z); }
      const alb = typeof tint === 'function' ? tint(_p) : tint;
      col.set(o.emit ? alb : shade(_p, _n, alb, o), i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    B[mat].push(g); return g;
  }

  // ---------- geometry helpers ----------
  const xf = (g, p = [0, 0, 0], r = [0, 0, 0]) => g.applyMatrix4(new THREE.Matrix4().compose(V3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), V3(1, 1, 1)));
  const BB = (x0, y0, z0, x1, y1, z1) => xf(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2]);
  const tube = (a, b, r, seg = 8, open = true) => {
    const d = b.clone().sub(a), g = new THREE.CylinderGeometry(r, r, d.length(), seg, 1, open);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), d.clone().normalize()));
    return g.translate(...a.clone().add(b).multiplyScalar(0.5).toArray());
  };
  const inset = 2;
  const toAtlas = (u, v, [x0, y0, w, h]) => [(x0 + inset + u * (w - 2 * inset)) / A, 1 - (y0 + inset + (1 - v) * (h - 2 * inset)) / A];
  function uvCyl(g, rect, ph0, ph1, y0, y1) {
    const P = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < P.count; i++) {
      let a = Math.atan2(P.getX(i), P.getZ(i)); while (a < ph0 - 1e-3) a += Math.PI * 2; while (a > ph1 + 1e-3) a -= Math.PI * 2;
      uv.setXY(i, ...toAtlas((a - ph0) / (ph1 - ph0), (P.getY(i) - y0) / (y1 - y0), rect));
    }
    return g;
  }
  const uvRect = (g, rect, rot = false) => { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) { const u = uv.getX(i), v = uv.getY(i); uv.setXY(i, ...(rot ? toAtlas(v, 1 - u, rect) : toAtlas(u, v, rect))); } return g; };
  const lathe = (pts, seg, ph0 = 0, phl = Math.PI * 2) => new THREE.LatheGeometry(pts.map(([r, y]) => V2(r, y)), seg, ph0, phl);
  const HULL = [[3.2, 3.4], [3.05, 3.6], [3.05, 10.0], [2.85, 11.2], [2.35, 12.3], [1.6, 13.3], [0.9, 13.9], [0.55, 14.08]];
  const rOf = y => { for (let i = 0; i < HULL.length - 1; i++) { const [r0, y0] = HULL[i], [r1, y1] = HULL[i + 1]; if (y >= y0 && y <= y1) return r0 + (r1 - r0) * (y - y0) / (y1 - y0); } return 3.05; };
  const patch = (y0, y1, ph0, ph1, off, seg = 4, vseg = 2) => { const pts = []; for (let j = 0; j <= vseg; j++) { const y = y0 + (y1 - y0) * j / vseg; pts.push([rOf(y) + off, y]); } return lathe(pts, seg, ph0, ph1 - ph0); };
  const atlasPatch = (rect, y0, y1, ph0, ph1, off, seg, o = {}) => add('atlas', uvCyl(patch(y0, y1, ph0, ph1, off, seg), rect, ph0, ph1, y0, y1), C.full, { out: true, ...o });
  const Q = Math.PI / 2;

  // ---------- main body ----------
  for (let k = 0; k < 4; k++) add('atlas', uvCyl(lathe(HULL, 8, k * Q, Q), RECT.hull, k * Q, (k + 1) * Q, 3.4, 14.08), C.white, { out: true });
  for (let k = 0; k < 8; k++) { const a = k * Q / 2; add('atlas', uvCyl(lathe([[3.2, 1.45], [3.2, 3.2]], 4, a, Q / 2), RECT.foil, a, a + Q / 2, 1.45, 3.2), C.full, { out: true }); }
  for (let k = 0; k < 4; k++) add('atlas', uvCyl(lathe([[3.21, 3.2], [3.21, 3.4]], 8, k * Q, Q), RECT.warn, k * Q, (k + 1) * Q, 3.2, 3.4), C.full, { out: true });
  [[6.0, 6.22], [9.92, 10.08]].forEach(([a, b]) => add('plain', lathe([[3.075, a], [3.075, b]], 32), C.silver, { out: true }));
  add('plain', lathe([[0.001, 1.25], [2.9, 1.25], [3.2, 1.45]], 32), p => mix(C.silver, C.soot, 1 - sm(1.2, 3.1, Math.hypot(p.x, p.z)) * 0.9), { noDust: true });
  // docking port, mast, beacon, whip antennas
  add('plain', lathe([[0.001, 14.08], [0.6, 14.08], [0.6, 14.3], [0.5, 14.36], [0.001, 14.36]], 20), C.silver);
  add('plain', lathe([[0.62, 14.14], [0.62, 14.2]], 20), C.dark, { out: true });
  add('plain', tube(V3(0, 14.36, 0), V3(0, 15.35, 0), 0.03, 6), C.metal);
  add('plain', xf(new THREE.SphereGeometry(0.075, 10, 6), [0, 15.42, 0]), C.red, { emit: true });
  [[-0.9, 13.8, 0.3], [0.6, 13.95, -0.55]].forEach(([x, y, z]) => add('plain', tube(V3(x, y, z), V3(x * 1.15, y + 0.9, z * 1.15), 0.012, 5), C.metal));

  // windows: crew ring + forward cockpit windows
  const glass = p => mix(C.glassBot, C.glassTop, sm(9.1, 9.6, p.y) * 0.7);
  for (let k = 0; k < 10; k++) {
    const c = k * Math.PI * 2 / 10 + Math.PI / 10, w = 0.075;
    add('plain', patch(9.08, 9.57, c - w - 0.02, c + w + 0.02, 0.012, 3, 1), C.dark, { out: true });
    add('plain', patch(9.13, 9.52, c - w, c + w, 0.022, 3, 1), glass, { out: true, emit: true });
  }
  const cglass = p => mix(C.glassBot, C.glassTop, sm(10.7, 11.35, p.y) * 0.8);
  [-0.3, 0, 0.3].forEach(c => {
    add('plain', patch(10.62, 11.4, c - 0.13, c + 0.13, 0.012, 3, 2), C.dark, { out: true });
    add('plain', patch(10.68, 11.33, c - 0.11, c + 0.11, 0.022, 3, 2), cglass, { out: true, emit: true });
  });

  // decals
  atlasPatch(RECT.badge, 6.55, 7.95, -0.23, 0.23, 0.015, 4);
  atlasPatch(RECT.badge, 6.55, 7.95, Math.PI - 0.23, Math.PI + 0.23, 0.015, 4);
  [Q, -Q].forEach(c => atlasPatch(RECT.serial, 4.3, 5.2, c - 0.6, c + 0.6, 0.015, 8));

  // RCS pods
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + k * Q, d = V3(Math.sin(a), 0, Math.cos(a)), t = V3(Math.cos(a), 0, -Math.sin(a));
    const c = d.clone().multiplyScalar(3.08).setY(10.45);
    add('plain', new THREE.BoxGeometry(0.34, 0.42, 0.3).rotateY(a).translate(c.x, c.y, c.z), C.silver);
    [-1, 1].forEach(sg => add('plain', tube(c.clone().addScaledVector(t, sg * 0.15), c.clone().addScaledVector(t, sg * 0.3), 0.045, 8, false), C.dark, { noDust: true }));
    add('plain', tube(c.clone().setY(10.64), c.clone().setY(10.78), 0.04, 8, false), C.dark);
  }

  // high-gain dish on a boom (rear-left)
  {
    const a = Math.PI + 0.75, d = V3(Math.sin(a), 0, Math.cos(a));
    const base = d.clone().multiplyScalar(rOf(12.0) - 0.05).setY(12.0), tip = d.clone().multiplyScalar(rOf(12.0) + 0.9).setY(12.45);
    add('plain', tube(base, tip, 0.05, 6), C.metal);
    const pts = []; for (let i = 0; i <= 6; i++) { const r = 0.7 * i / 6; pts.push([Math.max(0.001, r), r * r * 0.45]); }
    const dish = lathe(pts, 20); dish.rotateX(-0.5).rotateY(a);
    add('plain', dish.translate(tip.x, tip.y + 0.05, tip.z), C.white);
    add('plain', tube(tip, tip.clone().add(V3(0, 0.45, 0)).addScaledVector(d, 0.2), 0.015, 5), C.metal);
  }

  // radiator panels (rear) + solar wings (±X)
  [[2.62, 3.08], [3.2, 3.66]].forEach(([a, b]) => {
    atlasPatch(RECT.rad, 6.45, 9.3, a, b, 0.2, 5, {});
    [6.8, 8.9].forEach(y => { const m = (a + b) / 2, d = V3(Math.sin(m), 0, Math.cos(m)); add('plain', new THREE.BoxGeometry(0.12, 0.12, 0.26).rotateY(m).translate(...d.multiplyScalar(3.14).setY(y).toArray()), C.metal); });
  });
  [1, -1].forEach(sg => {
    add('plain', tube(V3(sg * 3.0, 7.9, 0), V3(sg * 3.55, 7.9, 0), 0.07, 8, false), C.metal);
    add('plain', BB(sg > 0 ? 3.5 : -3.62, 7.8, -0.12, sg > 0 ? 3.62 : -3.5, 8.0, 0.12), C.dark);
    const pan = new THREE.BoxGeometry(2.95, 0.05, 1.3);
    uvRect(pan, RECT.solar);
    add('atlas', pan.rotateX(-0.32).translate(sg * 5.1, 7.9, 0), C.full, { noDust: true });
    add('plain', BB(sg * 6.58 - 0.05, 7.87, -0.05, sg * 6.58 + 0.05, 7.95, 0.05), sg > 0 ? C.green : C.red, { emit: true });
  });

  // ---------- engines ----------
  const NOZ = [[0.32, 1.25], [0.24, 1.12], [0.3, 0.95], [0.44, 0.75], [0.58, 0.55], [0.66, 0.42]];
  const nozTint = p => mix(C.bronze, C.soot, sm(1.1, 0.45, p.y));
  [[0, 0], [0, 1.6], [1.6, 0], [0, -1.6], [-1.6, 0]].forEach(([x, z]) => {
    add('plain', lathe(NOZ, 18).translate(x, 0, z), nozTint, { noDust: true, ao: 0.9 });
    add('plain', lathe([[0.665, 0.42], [0.69, 0.44], [0.69, 0.47], [0.62, 0.52]], 18).translate(x, 0, z), C.soot, { noDust: true });
  });

  // ---------- landing legs (4, diagonal) ----------
  const feet = [];
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + k * Q, d = V3(Math.sin(a), 0, Math.cos(a)), t = V3(Math.cos(a), 0, -Math.sin(a));
    const H = d.clone().multiplyScalar(3.1).setY(4.2), F = d.clone().multiplyScalar(5.9).setY(0.3);
    feet.push(F.clone());
    const mid = H.clone().lerp(F, 0.58), low = H.clone().lerp(F, 0.54), J = H.clone().lerp(F, 0.74);
    add('plain', tube(H, mid, 0.18, 10), C.white);
    add('plain', tube(low, F, 0.12, 10), C.silver);
    add('atlas', uvRect(tube(H.clone().lerp(F, 0.48), mid, 0.185, 10), RECT.hazard, true), C.full);
    add('plain', xf(new THREE.SphereGeometry(0.24, 10, 6), H.toArray()), C.metal);
    [-1, 1].forEach(sg => {
      const Ab = d.clone().multiplyScalar(3.18).addScaledVector(t, sg * 1.05).setY(1.55);
      add('plain', tube(Ab, J, 0.085, 8), C.silver);
      add('plain', xf(new THREE.BoxGeometry(0.22, 0.22, 0.22), Ab.toArray()), C.dark);
      const Au = d.clone().multiplyScalar(3.12).addScaledVector(t, sg * 0.8).setY(3.6);
      add('plain', tube(Au, H.clone().lerp(F, 0.3), 0.06, 6), C.metal);
    });
    add('plain', xf(new THREE.SphereGeometry(0.2, 10, 6), F.toArray()), C.metal, { dust: 1.3 });
    add('plain', xf(new THREE.CylinderGeometry(0.52, 0.82, 0.32, 18), [F.x, -0.04, F.z]), C.silver, { dust: 1.6 });
    add('plain', xf(new THREE.CylinderGeometry(0.84, 0.84, 0.06, 18, 1, true), [F.x, -0.17, F.z]), C.dark, { dust: 1.6 });
  }

  // ---------- airlock, platform, stairs (+Z) ----------
  add('plain', BB(-1.0, 3.4, 2.55, 1.0, 6.1, 3.75), C.white);
  add('plain', BB(-1.06, 6.1, 2.5, 1.06, 6.2, 3.82), C.silver);
  const hatch = (x0, y0, x1, y1, r) => { const sh = new THREE.Shape(); sh.moveTo(x0 + r, y0); sh.lineTo(x1 - r, y0); sh.quadraticCurveTo(x1, y0, x1, y0 + r); sh.lineTo(x1, y1 - r); sh.quadraticCurveTo(x1, y1, x1 - r, y1); sh.lineTo(x0 + r, y1); sh.quadraticCurveTo(x0, y1, x0, y1 - r); sh.lineTo(x0, y0 + r); sh.quadraticCurveTo(x0, y0, x0 + r, y0); return sh; };
  const frame = hatch(-0.58, 3.44, 0.58, 5.5, 0.24); frame.holes.push(hatch(-0.47, 3.52, 0.47, 5.4, 0.18));
  add('plain', new THREE.ExtrudeGeometry(frame, { depth: 0.08, bevelEnabled: false, curveSegments: 4 }).translate(0, 0, 3.72), C.dark);
  add('plain', new THREE.ExtrudeGeometry(hatch(-0.47, 3.52, 0.47, 5.4, 0.18), { depth: 0.03, bevelEnabled: false, curveSegments: 4 }).translate(0, 0, 3.73), C.door);
  add('plain', xf(new THREE.CircleGeometry(0.13, 16), [0, 4.95, 3.765]), C.glassBot, { emit: true });
  add('plain', xf(new THREE.TorusGeometry(0.14, 0.02, 6, 16), [0, 4.95, 3.765]), C.dark);
  add('plain', BB(0.26, 4.3, 3.76, 0.34, 4.62, 3.8), C.metal);
  [-0.68, 0.68].forEach(x => add('atlas', uvRect(xf(new THREE.PlaneGeometry(0.12, 2.0), [x, 4.47, 3.755]), RECT.hazard, true), C.full));
  add('atlas', uvRect(xf(new THREE.PlaneGeometry(1.0, 0.25), [0, 5.75, 3.755]), RECT.lock), C.full);
  add('plain', BB(-0.18, 5.94, 3.75, 0.18, 6.02, 3.82), C.lamp, { emit: true });

  add('plain', BB(-1.12, 3.24, 3.75, 1.12, 3.36, 4.8), C.metal);
  const post = (x, z, y0 = 3.36, h = 1.0) => add('plain', tube(V3(x, y0, z), V3(x, y0 + h, z), 0.028, 6), C.silver);
  [-1.08, 1.08].forEach(x => { post(x, 3.8); post(x, 4.76); add('plain', tube(V3(x, 4.36, 3.8), V3(x, 4.36, 4.76), 0.028, 6), C.silver); });
  [-1, 1].forEach(sg => { post(sg * 0.62, 4.76); add('plain', tube(V3(sg * 1.08, 4.36, 4.76), V3(sg * 0.62, 4.36, 4.76), 0.028, 6), C.silver); });
  const S0 = V3(0, 3.3, 4.8), S1 = V3(0, 0.0, 8.1), sl = S1.clone().sub(S0), L = sl.length(), tilt = Math.atan2(-sl.y, sl.z);
  [-0.56, 0.56].forEach(x => {
    add('plain', new THREE.BoxGeometry(0.07, 0.24, L).rotateX(tilt).translate(x, (S0.y + S1.y) / 2, (S0.z + S1.z) / 2), C.dark);
    add('plain', tube(V3(x * 1.1, S0.y + 1.0, S0.z), V3(x * 1.1, S1.y + 0.95, S1.z), 0.026, 6), C.silver);
    [0.12, 0.5, 0.88].forEach(t => { const p = S0.clone().lerp(S1, t); add('plain', tube(V3(x * 1.1, p.y, p.z), V3(x * 1.1, p.y + 0.97, p.z), 0.022, 5), C.silver); });
    const m = S0.clone().lerp(S1, 0.5); add('plain', tube(V3(x, m.y, m.z), V3(x, -0.15, m.z), 0.05, 6), C.metal);
  });
  const steps = 14;
  for (let i = 0; i < steps; i++) { const p = S0.clone().lerp(S1, (i + 0.5) / steps); add('plain', BB(-0.54, p.y + 0.0, p.z - 0.13, 0.54, p.y + 0.04, p.z + 0.13), C.metal); }
  add('plain', BB(-0.8, -0.12, 7.95, 0.8, 0.04, 8.9), C.metal, { dust: 1.4 });

  // ---------- fake ground shadow (opaque, fades to groundColor) ----------
  {
    const sy = Math.max(0.12, s.y), sxz = V2(-s.x / sy, -s.z / sy);
    const A0 = sxz.clone().multiplyScalar(1.25), A1 = sxz.clone().multiplyScalar(11.5);
    const shift = sxz.lengthSq() > 1e-6 ? sxz.clone().normalize().multiplyScalar(Math.min(4.5, sxz.length() * 4)) : V2(0, 0);
    const N = 32, half = 11.5;
    const segD = (px, pz) => { const ab = A1.clone().sub(A0), ap = V2(px, pz).sub(A0); const t = Math.max(0, Math.min(1, ap.dot(ab) / Math.max(1e-6, ab.lengthSq()))); return ap.sub(ab.multiplyScalar(t)).length(); };
    const dark = (x, z, u, v) => {
      let d = (1 - sm(2.4, 5.4, Math.hypot(x, z))) * 0.8;
      d = Math.max(d, (1 - sm(-0.8, 1.4, segD(x, z) - 3.1)) * 0.85);
      for (const f of feet) d = Math.max(d, (1 - sm(0.55, 1.4, Math.hypot(x - f.x, z - f.z))) * 0.7);
      d = Math.max(d, (1 - sm(0.3, 1.2, Math.abs(x) + Math.max(0, Math.abs(z - 6.4) - 1.8))) * 0.4 * (z > 4 && z < 9 ? 1 : 0));
      return d * (1 - sm(0.72, 1.0, Math.max(Math.abs(u), Math.abs(v))));
    };
    const pos = [], col = [], idx = [];
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const u = i / N * 2 - 1, v = j / N * 2 - 1, x = shift.x + u * half, z = shift.y + v * half;
      pos.push(x, 0.02, z);
      const k = 1 - 0.62 * dark(x, z, u, v); col.push(C.ground[0] * k, C.ground[1] * k, C.ground[2] * k);
    }
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => i % 3 === 1 ? 1 : 0), 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((N + 1) * (N + 1) * 2), 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    B.shadow.push(g.toNonIndexed());
  }

  // ---------- merge per material ----------
  function merge(list) {
    let n = 0; list.forEach(g => n += g.attributes.position.count);
    const out = new THREE.BufferGeometry();
    ['position', 'normal', 'uv', 'color'].forEach(k => {
      const size = k === 'uv' ? 2 : 3, arr = new Float32Array(n * size); let o = 0;
      list.forEach(g => { arr.set(g.attributes[k].array, o); o += g.attributes[k].array.length; });
      out.setAttribute(k, new THREE.BufferAttribute(arr, size));
    });
    out.computeBoundingSphere(); return out;
  }
  const group = new THREE.Group(); group.name = 'Lander_LM03';
  for (const k of ['plain', 'atlas', 'shadow']) {
    const m = new THREE.Mesh(merge(B[k]), _mats[k]); m.name = k === 'shadow' ? 'lander_ground_shadow' : 'lander_' + k;
    if (k === 'shadow') m.renderOrder = -1;
    group.add(m);
  }
  return { group };
}
