// Rover Curiosity (MSL) ved Murray Buttes — three.js, WebXR / Meta Quest 3.
//   import { buildCuriosity } from './curiosity.js';
//   const { group } = buildCuriosity(THREE, { sunDir, groundColor });
// 1 unit = 1 m, y-up. Origin at ground level under the centre of the rover.
// Front (mast + stowed arm) faces +Z. Lighting baked into vertex colours from sunDir
// (model space). MeshBasicMaterial + vertexColors — no scene lights needed.
// Needs a DOM for the 512×256 canvas atlas.

let _atlas = null, _mats = null;
const AW = 512, AH = 256;
const RECT = { treadA: [0, 0, 256, 128], treadB: [0, 128, 256, 128], panel: [256, 0, 256, 256] };

function makeAtlas(THREE) {
  const c = document.createElement('canvas'); c.width = AW; c.height = AH;
  const g = c.getContext('2d');
  let seed = 23; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

  // wheel treads: aluminium skin, chevron grousers, dents, punctures and tears
  const tread = (x0, y0, holes) => {
    g.save(); g.beginPath(); g.rect(x0, y0, 256, 128); g.clip();
    g.fillStyle = '#34363a'; g.fillRect(x0, y0, 256, 128);
    for (let k = 0; k < 60; k++) { const v = 30 + rnd() * 45 | 0; g.fillStyle = `rgba(${v},${v},${v},0.4)`; g.beginPath(); g.ellipse(x0 + rnd() * 256, y0 + rnd() * 128, 6 + rnd() * 16, 4 + rnd() * 10, rnd() * 3, 0, 7); g.fill(); }
    for (let i = 0; i < 25; i++) {
      const x = x0 + i * 256 / 24;
      [['#1a1b1d', 5], ['#63676b', 2]].forEach(([col, w], q) => {
        g.strokeStyle = col; g.lineWidth = w; g.beginPath();
        g.moveTo(x + q * 2, y0 + 4); g.lineTo(x + 7 + q * 2, y0 + 64); g.lineTo(x + q * 2, y0 + 124); g.stroke();
      });
    }
    for (let k = 0; k < holes; k++) {
      const x = x0 + 12 + rnd() * 232, y = y0 + 14 + rnd() * 100, r = 3 + rnd() * 9;
      g.beginPath(); for (let q = 0; q < 7; q++) { const a = q / 7 * 6.283; g.lineTo(x + Math.cos(a) * r * (0.5 + rnd()), y + Math.sin(a) * r * (0.5 + rnd())); }
      g.closePath(); g.fillStyle = '#060505'; g.fill(); g.strokeStyle = '#8c9094'; g.lineWidth = 1.5; g.stroke();
    }
    g.strokeStyle = '#050404'; g.lineWidth = 2.5;
    for (let k = 0; k < holes / 2; k++) { const x = x0 + rnd() * 256, y = y0 + 20 + rnd() * 88; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 30, y + (rnd() - 0.5) * 40); g.stroke(); }
    g.restore();
  };
  tread(0, 0, 9); tread(0, 128, 14);

  // body panels: white skin, seams, fasteners
  g.fillStyle = '#f1f0ec'; g.fillRect(256, 0, 256, 256);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) { const v = 236 + rnd() * 16 | 0; g.fillStyle = `rgb(${v},${v},${v - 3})`; g.fillRect(258 + i * 64, 2 + j * 85, 60, 81); }
  g.fillStyle = '#bdbcb7'; for (let i = 0; i <= 4; i++) g.fillRect(255 + i * 64, 0, 2, 256); for (let j = 0; j <= 3; j++) g.fillRect(256, j * 85 - 1, 256, 2);
  g.fillStyle = '#d9d8d3'; for (let k = 0; k < 7; k++) g.fillRect(262 + rnd() * 220, 8 + rnd() * 230, 18 + rnd() * 20, 8 + rnd() * 10);

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.name = 'curiosity_atlas';
  return t;
}

export function buildCuriosity(THREE, { sunDir = new THREE.Vector3(0.45, 0.75, 0.5), groundColor = '#9a4f32' } = {}) {
  if (!_atlas) _atlas = makeAtlas(THREE);
  if (!_mats) _mats = {
    plain: new THREE.MeshBasicMaterial({ name: 'curiosity_plain', vertexColors: true, side: THREE.DoubleSide, toneMapped: false }),
    atlas: new THREE.MeshBasicMaterial({ name: 'curiosity_atlas', map: _atlas, vertexColors: true, side: THREE.DoubleSide, toneMapped: false }),
    shadow: new THREE.MeshBasicMaterial({ name: 'curiosity_ground_shadow', vertexColors: true, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  };
  const s = sunDir.clone().normalize();
  const V2 = (x, y) => new THREE.Vector2(x, y), V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const lin = hex => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

  const ground = lin(groundColor);
  const C = {
    white: lin('#e8e6e0'), alu: lin('#c2c5c8'), alu2: lin('#9da1a6'), dark: lin('#3a3d41'),
    gold: lin('#c8963a'), copper: lin('#b0673a'), black: lin('#1d1e20'), rod: lin('#232427'), cam: lin('#17191c'), lens: lin('#2b3844'),
    dust: mix(ground, lin('#c98a5c'), 0.45), sky: lin('#f3e4d4'), sun: lin('#fff1dc'), bounce: lin('#c0643c'), full: [1, 1, 1],
  };

  // ---------- baking ----------
  const BOX = { min: V3(-0.62, 0.6, -0.96), max: V3(0.62, 1.13, 0.8) }; // body blocks the sun
  function inShadow(p, n) {
    const o = p.clone().addScaledVector(n, 0.03);
    if (o.x > BOX.min.x && o.x < BOX.max.x && o.y > BOX.min.y && o.y < BOX.max.y && o.z > BOX.min.z && o.z < BOX.max.z) return false;
    let t0 = 0, t1 = 1e9;
    for (const k of ['x', 'y', 'z']) {
      if (Math.abs(s[k]) < 1e-6) { if (o[k] < BOX.min[k] || o[k] > BOX.max[k]) return false; continue; }
      let a = (BOX.min[k] - o[k]) / s[k], b = (BOX.max[k] - o[k]) / s[k]; if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a); t1 = Math.min(t1, b); if (t0 > t1) return false;
    }
    return t1 > 0;
  }
  function shade(p, n, albedo, o) {
    const ndl = Math.max(0, n.x * s.x + n.y * s.y + n.z * s.z);
    const vis = o.noCast ? 1 : inShadow(p, n) ? 0.12 : 1;
    let ao = o.ao ?? 1;
    if (p.y < 0.62 && Math.abs(p.x) < 0.95 && p.z > -1.0 && p.z < 0.85) ao *= 0.55;      // under the deck
    if (Math.abs(p.x) > 0.85 && Math.abs(p.x) < 1.05 && p.y < 0.5) ao *= 0.72;            // inboard wheel faces
    if (n.y < -0.4) ao *= 0.8;
    ao *= 0.7 + 0.3 * sm(-0.05, 1.1, p.y);
    const amb = (0.34 + 0.1 * (n.y * 0.5 + 0.5)) * ao, bnc = 0.1 * Math.max(0, -n.y) * ao, sun = 0.64 * ndl * vis;
    let alb = albedo;
    if (!o.noDust) {
      const up = Math.max(0, n.y), d = (0.1 + 0.68 * Math.pow(up, 1.4) + 0.2 * ndl * (1 - up)) * (o.dust ?? 1);
      alb = mix(alb, C.dust, Math.min(0.92, d));
    }
    return [0, 1, 2].map(i => alb[i] * (amb * C.sky[i] + bnc * C.bounce[i] + sun * C.sun[i]));
  }

  const B = { plain: [], atlas: [], shadow: [] };
  const _p = V3(0, 0, 0), _n = V3(0, 0, 0);
  function add(mat, geo, tint, o = {}) {
    if (tint === C.rod && o.dust == null) o = { ...o, dust: 0.3 };
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    const P = g.attributes.position, N = g.attributes.normal, col = new Float32Array(P.count * 3);
    for (let i = 0; i < P.count; i++) {
      _p.fromBufferAttribute(P, i); _n.fromBufferAttribute(N, i).normalize();
      col.set(shade(_p, _n, typeof tint === 'function' ? tint(_p) : tint, o), i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    B[mat].push(g); return g;
  }

  // ---------- geometry helpers ----------
  const M4 = (p, r) => new THREE.Matrix4().compose(V3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), V3(1, 1, 1));
  const xf = (g, p = [0, 0, 0], r = [0, 0, 0]) => g.applyMatrix4(M4(p, r));
  const BB = (x0, y0, z0, x1, y1, z1) => xf(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2]);
  const tube = (a, b, r, seg = 8, open = true) => {
    const d = b.clone().sub(a), g = new THREE.CylinderGeometry(r, r, d.length(), seg, 1, open);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), d.clone().normalize()));
    return g.translate(...a.clone().add(b).multiplyScalar(0.5).toArray());
  };
  const cylX = (r, len, seg, p) => xf(new THREE.CylinderGeometry(r, r, len, seg), p, [0, 0, Math.PI / 2]);
  const toAtlas = (u, v, [x0, y0, w, h]) => [(x0 + 2 + u * (w - 4)) / AW, 1 - (y0 + 2 + (1 - v) * (h - 4)) / AH];
  const uvRect = (g, rect) => { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, ...toAtlas(uv.getX(i), uv.getY(i), rect)); return g; };

  // ---------- body (warm electronics box) + deck ----------
  const taper = g => { const P = g.attributes.position; for (let i = 0; i < P.count; i++) { const k = 0.78 + 0.22 * sm(0.62, 1.1, P.getY(i)); P.setX(i, P.getX(i) * k); } return g; }; // belly narrower than back
  add('atlas', uvRect(taper(BB(-0.62, 0.62, -0.95, 0.62, 1.1, 0.8)), RECT.panel), C.full);
  add('plain', BB(-0.66, 1.1, -1.0, 0.66, 1.135, 0.85), C.alu, { dust: 1.1 });
  add('plain', BB(-0.47, 0.6, -0.93, 0.47, 0.625, 0.78), C.alu2);
  [-1, 1].forEach(sg => add('plain', taper(BB(sg * 0.63 - 0.01, 0.62, -0.7, sg * 0.63 + 0.01, 1.05, 0.5)), C.gold));   // side foil
  // deck instruments
  add('plain', BB(-0.1, 1.135, 0.1, 0.35, 1.25, 0.5), C.white);                 // SAM
  add('plain', BB(0.38, 1.135, 0.15, 0.58, 1.2, 0.45), C.copper);               // CheMin
  add('plain', BB(-0.55, 1.135, -0.2, -0.2, 1.19, 0.2), C.alu2);
  [[0.05, 0.3], [0.2, 0.35]].forEach(([x, z]) => add('plain', xf(new THREE.CylinderGeometry(0.035, 0.035, 0.05, 8), [x, 1.275, z]), C.alu));
  add('plain', tube(V3(-0.7, 1.19, 0.12), V3(0.7, 1.19, 0.12), 0.035, 8, false), C.rod);
  add('plain', xf(new THREE.CylinderGeometry(0.07, 0.07, 0.06, 10), [0, 1.165, 0.12]), C.gold);
  // front hazcams
  [-1, 1].forEach(sg => { add('plain', BB(sg * 0.3 - 0.07, 0.52, 0.76, sg * 0.3 + 0.07, 0.6, 0.84), C.cam, { noDust: true }); add('plain', BB(sg * 0.3 - 0.07, 0.52, -0.97, sg * 0.3 + 0.07, 0.6, -0.9), C.cam, { noDust: true }); });

  // ---------- rocker-bogie + wheels ----------
  const WR = 0.25, WW = 0.4, WX = 1.2, WY = 0.2, UX = 0.9;
  const wheels = [];
  [-1, 1].forEach(sg => {
    const P = V3(sg * 0.72, 0.88, 0.15), K = V3(sg * 0.86, 0.8, 0.6), BP = V3(sg * 0.85, 0.6, -0.45);
    const UF = V3(sg * UX, 0.66, 1.05), UM = V3(sg * UX, 0.52, 0.05), UR = V3(sg * UX, 0.66, -0.95);
    add('plain', tube(V3(sg * 0.7, 1.19, 0.12), P, 0.025, 6), C.rod);
    add('plain', tube(P, K, 0.045, 8), C.rod); add('plain', tube(K, UF, 0.04, 8), C.rod);
    add('plain', tube(P, BP, 0.045, 8), C.rod);
    add('plain', tube(BP, UM, 0.038, 8), C.rod); add('plain', tube(BP, UR, 0.038, 8), C.rod);
    add('plain', cylX(0.075, 0.08, 12, [P.x, P.y, P.z]), C.gold);
    add('plain', cylX(0.06, 0.08, 12, [BP.x, BP.y, BP.z]), C.gold);
    [[UF, 1.05, true], [UM, 0.05, false], [UR, -0.95, true]].forEach(([U, z, corner]) => {
      add('plain', tube(U, V3(U.x, WY, z), 0.035, 8), C.rod);
      add('plain', tube(V3(U.x, WY, z), V3(sg * (WX - WW / 2), WY, z), 0.04, 8, false), C.rod);
      if (corner) add('plain', xf(new THREE.CylinderGeometry(0.06, 0.06, 0.13, 10), [U.x, U.y, z]), C.gold);
      wheels.push([sg, z]);
    });
  });
  wheels.forEach(([sg, z], wi) => {
    const rot = rnd() * Math.PI * 2, cx = sg * WX, m = M4([cx, WY, z], [rot, 0, 0]);
    const tr = new THREE.CylinderGeometry(WR, WR, WW, 20, 2, true); tr.rotateZ(Math.PI / 2);
    const P = tr.attributes.position;
    for (let i = 0; i < P.count; i++) {                                                  // dents on the mid ring
      const a = Math.atan2(P.getZ(i), P.getY(i)), q = Math.round((a + Math.PI) / (Math.PI * 2) * 20) % 20;
      const dent = (Math.abs(P.getX(i)) < 0.01 && ((q * 7 + wi * 3) % 5 === 0)) ? 0.9 : 1;
      P.setY(i, P.getY(i) * dent); P.setZ(i, P.getZ(i) * dent);
    }
    uvRect(tr, wi % 2 ? RECT.treadA : RECT.treadB);
    add('atlas', tr.applyMatrix4(m), C.full, { dust: 0.55 });
    const ox = sg * (WX + WW / 2 - 0.03);
    add('plain', new THREE.RingGeometry(WR - 0.035, WR, 20).rotateY(sg * Math.PI / 2).translate(ox + sg * 0.03, 0, 0).applyMatrix4(M4([0, WY, z], [rot, 0, 0])), C.rod, { dust: 0.5 });
    add('plain', xf(new THREE.CircleGeometry(WR - 0.01, 16).rotateY(sg * Math.PI / 2), [sg * (WX - WW / 2 + 0.02), WY, z]), C.rod, { noDust: true, ao: 0.75 });
    add('plain', cylX(0.07, 0.1, 12, [ox, WY, z]), C.rod);
    for (let k = 0; k < 6; k++) {
      const a = rot + k * Math.PI / 3;
      add('plain', new THREE.BoxGeometry(0.02, 0.17, 0.035).translate(0, 0.13, 0).rotateX(a).translate(ox, WY, z), C.rod);
    }
  });

  // ---------- remote sensing mast + head (looking toward the bus) ----------
  const MX = -0.42, MZ = 0.7, PIV = [MX, 1.84, MZ];
  add('plain', tube(V3(MX, 1.135, MZ), V3(MX, 1.78, MZ), 0.06, 14), C.white);
  add('plain', xf(new THREE.CylinderGeometry(0.075, 0.075, 0.08, 12), [MX, 1.8, MZ]), C.gold);
  [-1, 1].forEach(sg => add('plain', tube(V3(MX, 1.55, MZ), V3(MX + sg * 0.16, 1.55, MZ - 0.12), 0.012, 5, false), C.alu));  // REMS booms
  const HM = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0.12, 0.28, 0, 'YXZ')).setPosition(...PIV);
  const head = (g, tint, o) => add('plain', g.applyMatrix4(HM), tint, o);
  head(tube(V3(0, -0.06, 0), V3(0, 0.03, 0), 0.05, 10), C.rod);                        // neck
  head(BB(-0.27, 0.02, -0.11, 0.27, 0.145, 0.12), C.alu2);                             // camera bar (wide, shallow)
  head(BB(-0.28, 0.145, -0.14, 0.28, 0.3, 0.13), C.alu);                               // ChemCam box, long side-to-side
  head(BB(-0.285, 0.3, -0.145, 0.285, 0.315, 0.135), C.white);
  head(tube(V3(0.11, 0.222, 0.13), V3(0.11, 0.222, 0.155), 0.062, 14, false), C.cam, { noDust: true }); // ChemCam aperture
  head(xf(new THREE.CircleGeometry(0.06, 14), [0.11, 0.222, 0.1305]), C.cam, { noDust: true });
  head(xf(new THREE.CircleGeometry(0.042, 14), [0.11, 0.222, 0.132]), C.lens, { noDust: true });
  head(BB(-0.2, 0.18, 0.13, -0.06, 0.265, 0.14), C.alu2);
  [[-0.065, 0.045], [0.045, 0.035]].forEach(([x, w]) => {                              // Mastcams (unequal pair)
    head(BB(x - w, 0.04, 0.08, x + w, 0.125, 0.18), C.cam, { noDust: true });
    head(xf(new THREE.CircleGeometry(w * 0.6, 10), [x, 0.082, 0.181]), C.lens, { noDust: true });
  });
  [-1, 1].forEach(sg => [0.03, 0.09].forEach(y => {                                    // Navcams at the bar ends
    head(BB(sg * 0.18, y, 0.0, sg * 0.25, y + 0.045, 0.14), C.cam, { noDust: true });
    head(xf(new THREE.CircleGeometry(0.016, 8), [sg * 0.215, y + 0.022, 0.141]), C.lens, { noDust: true });
  }));

  // ---------- robotic arm, stowed across the front ----------
  const S = V3(0.38, 0.86, 0.86), E = V3(-0.44, 0.8, 1.0), W = V3(0.16, 0.93, 1.1), T = V3(0.3, 0.72, 1.14);
  add('plain', xf(new THREE.CylinderGeometry(0.08, 0.08, 0.14, 12), S.toArray(), [Math.PI / 2, 0, 0]), C.gold);
  add('plain', tube(S, E, 0.05, 8), C.rod);
  add('plain', xf(new THREE.CylinderGeometry(0.08, 0.08, 0.13, 12), E.toArray()), C.gold);
  add('plain', tube(E, W, 0.045, 8), C.rod);
  add('plain', xf(new THREE.CylinderGeometry(0.065, 0.065, 0.1, 10), W.toArray(), [0, 0, Math.PI / 2]), C.gold);
  add('plain', tube(W, T, 0.045, 8), C.rod);
  add('plain', BB(T.x - 0.09, T.y - 0.09, T.z - 0.09, T.x + 0.09, T.y + 0.09, T.z + 0.09), C.white);
  add('plain', BB(T.x - 0.05, T.y - 0.28, T.z - 0.05, T.x + 0.05, T.y - 0.09, T.z + 0.05), C.alu2);   // drill housing
  add('plain', tube(V3(T.x, T.y - 0.28, T.z), V3(T.x, T.y - 0.4, T.z), 0.015, 6, false), C.dark);
  add('plain', tube(T, V3(T.x, T.y, T.z + 0.2), 0.045, 10), C.gold);                                  // APXS
  add('plain', BB(T.x + 0.09, T.y - 0.05, T.z - 0.05, T.x + 0.19, T.y + 0.05, T.z + 0.06), C.cam, { noDust: true }); // MAHLI
  add('plain', BB(T.x - 0.24, T.y - 0.08, T.z - 0.07, T.x - 0.09, T.y + 0.08, T.z + 0.07), C.alu);   // CHIMRA
  add('plain', tube(V3(T.x, T.y + 0.09, T.z), V3(T.x, T.y + 0.17, T.z), 0.035, 8), C.copper);        // DRT

  // ---------- high-gain (hexagonal), UHF, LGA ----------
  add('plain', tube(V3(0.42, 1.135, -0.5), V3(0.42, 1.33, -0.5), 0.04, 8), C.alu2);
  add('plain', xf(new THREE.CylinderGeometry(0.06, 0.06, 0.1, 10), [0.42, 1.33, -0.5], [0, 0, Math.PI / 2]), C.gold);
  add('plain', xf(new THREE.CylinderGeometry(0.2, 0.2, 0.04, 6), [0.42, 1.4, -0.5], [0.45, 0.35, 0]), C.white);
  add('plain', xf(new THREE.CylinderGeometry(0.21, 0.19, 0.03, 6), [0.41, 1.375, -0.51], [0.45, 0.35, 0]), C.gold);
  add('plain', xf(new THREE.CylinderGeometry(0.09, 0.09, 0.12, 12), [-0.36, 1.195, -0.62]), C.white);
  add('plain', tube(V3(0.02, 1.135, -0.8), V3(0.02, 1.45, -0.8), 0.018, 6), C.alu);
  add('plain', xf(new THREE.CylinderGeometry(0.035, 0.035, 0.08, 8), [0.02, 1.48, -0.8]), C.white);

  // ---------- RTG + heat-rejection radiators (rear) ----------
  const RA = V3(0, 0.95, -1.05), RB = V3(0, 1.38, -1.6), rAx = RB.clone().sub(RA).normalize();
  add('plain', tube(RA, RB, 0.2, 12, false), C.black, { dust: 0.8 });
  [RA, RB].forEach(p => add('plain', tube(p.clone().addScaledVector(rAx, -0.03), p.clone().addScaledVector(rAx, 0.03), 0.22, 12, false), C.dark));
  {
    const cap = new THREE.CircleGeometry(0.22, 12); cap.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V3(0, 0, 1), rAx));
    add('plain', cap.translate(...RB.clone().addScaledVector(rAx, 0.03).toArray()), C.dark);
    const q = new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), rAx), mid = RA.clone().lerp(RB, 0.5), len = RA.distanceTo(RB) - 0.04;
    for (let k = 0; k < 8; k++) {
      const fin = new THREE.BoxGeometry(0.015, len, 0.14).translate(0, 0, 0.26).rotateY(k * Math.PI / 4 + Math.PI / 8);
      add('plain', fin.applyQuaternion(q).translate(mid.x, mid.y, mid.z), C.black, { dust: 0.9 });
    }
  }
  [-1, 1].forEach(sg => {
    add('plain', tube(V3(sg * 0.2, 1.1, -0.95), RA.clone().setX(sg * 0.12), 0.025, 6), C.alu);
    const pan = new THREE.BoxGeometry(0.03, 0.5, 0.5);
    add('plain', xf(pan, [sg * 0.48, 1.1, -1.2], [0.55, sg * 0.35, 0]), C.white);
    add('plain', xf(new THREE.BoxGeometry(0.035, 0.26, 0.4), [sg * 0.48 + sg * 0.004, 1.1, -1.2], [0.55, sg * 0.35, 0]), C.alu2, { dust: 0.7 });
    add('plain', tube(V3(sg * 0.55, 1.1, -0.95), V3(sg * 0.55, 1.2, -1.05), 0.02, 5), C.alu);
  });

  // ---------- fake ground shadow ----------
  {
    const sy = Math.max(0.15, s.y), sxz = V2(-s.x / sy, -s.z / sy);
    const off = sxz.clone().multiplyScalar(0.85), shift = off.clone().multiplyScalar(0.5);
    const N = 22, half = 3.1;
    const rect = (x, z, cx, cz, hx, hz, f) => { const dx = Math.max(0, Math.abs(x - cx) - hx), dz = Math.max(0, Math.abs(z - cz) - hz); return 1 - sm(0, f, Math.hypot(dx, dz)); };
    const dark = (x, z, u, v) => {
      let d = rect(x, z, 0, -0.1, 0.72, 0.95, 0.9) * 0.75;
      d = Math.max(d, rect(x, z, off.x, off.y - 0.1, 0.62, 0.9, 0.7) * 0.85);
      for (const [sg, wz] of wheels) d = Math.max(d, (1 - sm(0.18, 0.55, Math.hypot(x - sg * WX, z - wz))) * 0.8);
      return d * (1 - sm(0.7, 1.0, Math.max(Math.abs(u), Math.abs(v))));
    };
    const pos = [], col = [], idx = [];
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const u = i / N * 2 - 1, v = j / N * 2 - 1, x = shift.x + u * half, z = shift.y + v * half;
      pos.push(x, 0.015, z);
      const k = 1 - 0.6 * dark(x, z, u, v); col.push(ground[0] * k, ground[1] * k, ground[2] * k);
    }
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => i % 3 === 1 ? 1 : 0), 3));
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
  const group = new THREE.Group(); group.name = 'Curiosity_MSL';
  for (const k of ['plain', 'atlas', 'shadow']) {
    const m = new THREE.Mesh(merge(B[k]), _mats[k]); m.name = 'curiosity_' + (k === 'shadow' ? 'ground_shadow' : k);
    if (k === 'shadow') m.renderOrder = -1;
    group.add(m);
  }
  return { group };
}
