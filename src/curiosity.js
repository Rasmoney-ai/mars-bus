// Rover Curiosity (MSL) ved Murray Buttes — three.js, WebXR / Meta Quest 3. Rigged.
//   import { buildCuriosity } from './curiosity.js';
//   const rover = buildCuriosity(THREE, { sunDir, groundColor });
//   scene.add(rover.group);
//   rover.setPose({ wheelAngle, steer, mastYaw, mastPitch, arm, turnYaw });   // every frame, cheap
//   rover.relight(sunDir);                                                   // after the rover turned
// 1 unit = 1 m, y-up. Origin at ground level under the centre of the rover. Front (mast + arm) faces +Z.
// All lighting is baked into vertex / instance colours (MeshBasicMaterial, no scene lights needed).
// 8 draw calls: body, wheels (InstancedMesh ×6), steering forks (InstancedMesh ×4), mast head,
// arm upper / forearm / turret, ground shadow. 2 materials. Needs a DOM for the 512×256 canvas atlas.

let _atlas = null, _mats = null;
const AW = 512, AH = 256;
const RECT = { tread: [0, 0, 256, 128], treadB: [0, 128, 256, 128], panel: [256, 0, 256, 256] };
const WHITE_UV = [(512 - 16) / AW, 1 - (256 - 16) / AH];

function makeAtlas(THREE) {
  const c = document.createElement('canvas'); c.width = AW; c.height = AH;
  const g = c.getContext('2d');
  let seed = 23; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
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
  g.fillStyle = '#f1f0ec'; g.fillRect(256, 0, 256, 256);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) { const v = 236 + rnd() * 16 | 0; g.fillStyle = `rgb(${v},${v},${v - 3})`; g.fillRect(258 + i * 64, 2 + j * 85, 60, 81); }
  g.fillStyle = '#bdbcb7'; for (let i = 0; i <= 4; i++) g.fillRect(255 + i * 64, 0, 2, 256); for (let j = 0; j <= 3; j++) g.fillRect(256, j * 85 - 1, 256, 2);
  g.fillStyle = '#d9d8d3'; for (let k = 0; k < 7; k++) g.fillRect(262 + rnd() * 200, 8 + rnd() * 200, 18 + rnd() * 20, 8 + rnd() * 10);
  g.fillStyle = '#ffffff'; g.fillRect(512 - 32, 256 - 32, 32, 32);                // flat white patch for untextured parts
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.name = 'curiosity_atlas';
  return t;
}

export function buildCuriosity(THREE, { sunDir = new THREE.Vector3(0.45, 0.75, 0.5), groundColor = '#9a4f32' } = {}) {
  if (!_atlas) _atlas = makeAtlas(THREE);
  if (!_mats) _mats = {
    main: new THREE.MeshBasicMaterial({ name: 'curiosity_main', map: _atlas, vertexColors: true, side: THREE.DoubleSide, toneMapped: false }),
    shadow: new THREE.MeshBasicMaterial({ name: 'curiosity_ground_shadow', vertexColors: true, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  };
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const lin = hex => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const DEG = Math.PI / 180;

  const ground = lin(groundColor);
  const C = {
    white: lin('#e8e6e0'), alu: lin('#c2c5c8'), alu2: lin('#9da1a6'), dark: lin('#3a3d41'),
    gold: lin('#c8963a'), copper: lin('#b0673a'), black: lin('#1d1e20'), rod: lin('#232427'), cam: lin('#17191c'), lens: lin('#2b3844'),
    dust: mix(ground, lin('#c98a5c'), 0.45), sky: lin('#f3e4d4'), sun: lin('#fff1dc'), bounce: lin('#c0643c'), full: [1, 1, 1],
  };

  // ---------- geometry recording ----------
  const L = { body: [], head: [], upper: [], fore: [], turret: [], wheel: [], fork: [] };
  function add(list, g, tint, o = {}) {
    if (tint === C.rod && o.dust == null) o = { ...o, dust: 0.3 };
    const n = g.attributes.position.count;
    if (!g.index) g.setIndex([...Array(n).keys()]);
    if (!o.uv) { const uv = g.attributes.uv.array; for (let i = 0; i < uv.length; i += 2) { uv[i] = WHITE_UV[0]; uv[i + 1] = WHITE_UV[1]; } }
    const alb = new Float32Array(n * 3), k = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { alb.set(tint, i * 3); k[i * 3] = o.noDust ? 0 : (o.dust ?? 1); k[i * 3 + 1] = o.ao ?? 1; k[i * 3 + 2] = o.noCast ? 0 : 1; }
    g.setAttribute('alb', new THREE.BufferAttribute(alb, 3)); g.setAttribute('k', new THREE.BufferAttribute(k, 3));
    L[list].push(g); return g;
  }
  const M4 = (p, r) => new THREE.Matrix4().compose(V3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), V3(1, 1, 1));
  const xf = (g, p = [0, 0, 0], r = [0, 0, 0]) => g.applyMatrix4(M4(p, r));
  const BB = (x0, y0, z0, x1, y1, z1) => xf(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2]);
  const tube = (a, b, r, seg = 8, open = true) => {
    const d = b.clone().sub(a), g = new THREE.CylinderGeometry(r, r, d.length(), seg, 1, open);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), d.clone().normalize()));
    return g.translate(...a.clone().add(b).multiplyScalar(0.5).toArray());
  };
  const cylX = (r, len, seg, p) => xf(new THREE.CylinderGeometry(r, r, len, seg), p, [0, 0, Math.PI / 2]);
  const cylY = (r, h, seg, p) => xf(new THREE.CylinderGeometry(r, r, h, seg), p);
  const toAtlas = (u, v, [x0, y0, w, h]) => [(x0 + 2 + u * (w - 4)) / AW, 1 - (y0 + 2 + (1 - v) * (h - 4)) / AH];
  const uvRect = (g, rect) => { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, ...toAtlas(uv.getX(i), uv.getY(i), rect)); return g; };

  // ---------- body (warm electronics box) + deck ----------
  const taper = g => { const P = g.attributes.position; for (let i = 0; i < P.count; i++) { const k = 0.78 + 0.22 * sm(0.62, 1.1, P.getY(i)); P.setX(i, P.getX(i) * k); } return g; };
  add('body', uvRect(taper(BB(-0.62, 0.62, -0.95, 0.62, 1.1, 0.8)), RECT.panel), C.full, { uv: true });
  add('body', BB(-0.66, 1.1, -1.0, 0.66, 1.135, 0.85), C.alu, { dust: 1.1 });
  add('body', BB(-0.47, 0.6, -0.93, 0.47, 0.625, 0.78), C.alu2);
  [-1, 1].forEach(sg => add('body', taper(BB(sg * 0.63 - 0.01, 0.62, -0.7, sg * 0.63 + 0.01, 1.05, 0.5)), C.gold));
  add('body', BB(-0.1, 1.135, 0.1, 0.35, 1.25, 0.5), C.white);
  add('body', BB(0.38, 1.135, 0.15, 0.58, 1.2, 0.45), C.copper);
  add('body', BB(-0.55, 1.135, -0.2, -0.2, 1.19, 0.2), C.alu2);
  [[0.05, 0.3], [0.2, 0.35]].forEach(([x, z]) => add('body', cylY(0.035, 0.05, 8, [x, 1.275, z]), C.alu));
  add('body', tube(V3(-0.7, 1.19, 0.12), V3(0.7, 1.19, 0.12), 0.035, 8, false), C.rod);
  add('body', cylY(0.07, 0.06, 10, [0, 1.165, 0.12]), C.gold);
  [-1, 1].forEach(sg => { add('body', BB(sg * 0.3 - 0.07, 0.52, 0.76, sg * 0.3 + 0.07, 0.6, 0.84), C.cam, { noDust: true }); add('body', BB(sg * 0.3 - 0.07, 0.52, -0.97, sg * 0.3 + 0.07, 0.6, -0.9), C.cam, { noDust: true }); });

  // ---------- rocker-bogie (static) ----------
  const WR = 0.25, WW = 0.4, WX = 1.2, WY = 0.2, UX = 0.9;
  const WH = [];                                     // wheels: side, z, corner
  [-1, 1].forEach(sg => {
    const P = V3(sg * 0.72, 0.88, 0.15), K = V3(sg * 0.86, 0.8, 0.6), BP = V3(sg * 0.85, 0.6, -0.45);
    const UF = V3(sg * UX, 0.66, 1.05), UM = V3(sg * UX, 0.52, 0.05), UR = V3(sg * UX, 0.66, -0.95);
    add('body', tube(V3(sg * 0.7, 1.19, 0.12), P, 0.025, 6), C.rod);
    add('body', tube(P, K, 0.045, 8), C.rod); add('body', tube(K, UF, 0.04, 8), C.rod);
    add('body', tube(P, BP, 0.045, 8), C.rod);
    add('body', tube(BP, UM, 0.038, 8), C.rod); add('body', tube(BP, UR, 0.038, 8), C.rod);
    add('body', cylX(0.075, 0.08, 12, [P.x, P.y, P.z]), C.gold);
    add('body', cylX(0.06, 0.08, 12, [BP.x, BP.y, BP.z]), C.gold);
    [[UF, 1.05, true], [UM, 0.05, false], [UR, -0.95, true]].forEach(([U, z, corner]) => {
      if (corner) {                                  // bracket out to the steering actuator above the wheel
        add('body', tube(U, V3(sg * WX, U.y, z), 0.035, 8), C.rod);
        add('body', cylY(0.065, 0.1, 12, [sg * WX, 0.64, z]), C.gold);
      } else {
        add('body', tube(U, V3(U.x, WY, z), 0.035, 8), C.rod);
        add('body', tube(V3(U.x, WY, z), V3(sg * (WX - WW / 2), WY, z), 0.04, 8, false), C.rod);
      }
      WH.push({ sg, x: sg * WX, z, corner });
    });
  });

  // ---------- wheel + fork (instanced, built for the +X side; mirrored for −X) ----------
  {
    const tr = new THREE.CylinderGeometry(WR, WR, WW, 20, 2, true); tr.rotateZ(Math.PI / 2);
    const P = tr.attributes.position;
    for (let i = 0; i < P.count; i++) {
      const a = Math.atan2(P.getZ(i), P.getY(i)), q = Math.round((a + Math.PI) / (Math.PI * 2) * 20) % 20;
      const dent = (Math.abs(P.getX(i)) < 0.01 && (q * 7) % 5 === 0) ? 0.9 : 1;
      P.setY(i, P.getY(i) * dent); P.setZ(i, P.getZ(i) * dent);
    }
    add('wheel', uvRect(tr, RECT.treadB), C.full, { uv: true, dust: 0.55 });
    add('wheel', new THREE.RingGeometry(WR - 0.035, WR, 20).rotateY(Math.PI / 2).translate(WW / 2, 0, 0), C.rod, { dust: 0.5 });
    add('wheel', new THREE.CircleGeometry(WR - 0.01, 16).rotateY(Math.PI / 2).translate(-WW / 2 + 0.02, 0, 0), C.rod, { noDust: true, ao: 0.6 });
    add('wheel', cylX(0.07, 0.1, 12, [WW / 2 - 0.03, 0, 0]), C.rod);
    for (let k = 0; k < 6; k++) add('wheel', new THREE.BoxGeometry(0.02, 0.17, 0.035).translate(0, 0.13, 0).rotateX(k * Math.PI / 3).translate(WW / 2 - 0.03, 0, 0), C.rod);
    const f0 = V3(0, 0.39, 0), f1 = V3(-0.25, 0.36, 0), f2 = V3(-0.25, 0, 0), f3 = V3(-WW / 2 + 0.01, 0, 0);
    add('fork', tube(f0, f1, 0.03, 8), C.rod); add('fork', tube(f1, f2, 0.035, 8), C.rod); add('fork', tube(f2, f3, 0.045, 8), C.rod);
    add('fork', cylY(0.045, 0.06, 10, [0, 0.4, 0]), C.rod);
  }

  // ---------- mast (static) + head (yaw/pitch) ----------
  const MX = -0.42, MZ = 0.7, PIV = V3(MX, 1.84, MZ);
  add('body', tube(V3(MX, 1.135, MZ), V3(MX, 1.78, MZ), 0.06, 14), C.white);
  add('body', cylY(0.075, 0.08, 12, [MX, 1.8, MZ]), C.gold);
  [-1, 1].forEach(sg => add('body', tube(V3(MX, 1.55, MZ), V3(MX + sg * 0.16, 1.55, MZ - 0.12), 0.012, 5, false), C.alu));
  const hd = (g, t, o) => add('head', g, t, o);
  hd(tube(V3(0, -0.06, 0), V3(0, 0.03, 0), 0.05, 10), C.rod);
  hd(BB(-0.27, 0.02, -0.11, 0.27, 0.145, 0.12), C.alu2);
  hd(BB(-0.28, 0.145, -0.14, 0.28, 0.3, 0.13), C.alu);
  hd(BB(-0.285, 0.3, -0.145, 0.285, 0.315, 0.135), C.white);
  hd(tube(V3(0.11, 0.222, 0.13), V3(0.11, 0.222, 0.155), 0.062, 14, false), C.cam, { noDust: true });
  hd(xf(new THREE.CircleGeometry(0.06, 14), [0.11, 0.222, 0.1305]), C.cam, { noDust: true });
  hd(xf(new THREE.CircleGeometry(0.042, 14), [0.11, 0.222, 0.132]), C.lens, { noDust: true });
  hd(BB(-0.2, 0.18, 0.13, -0.06, 0.265, 0.14), C.alu2);
  [[-0.065, 0.045], [0.045, 0.035]].forEach(([x, w]) => {
    hd(BB(x - w, 0.04, 0.08, x + w, 0.125, 0.18), C.cam, { noDust: true });
    hd(xf(new THREE.CircleGeometry(w * 0.6, 10), [x, 0.082, 0.181]), C.lens, { noDust: true });
  });
  [-1, 1].forEach(sg => [0.03, 0.09].forEach(y => {
    hd(BB(sg * 0.18, y, 0.0, sg * 0.25, y + 0.045, 0.14), C.cam, { noDust: true });
    hd(xf(new THREE.CircleGeometry(0.016, 8), [sg * 0.215, y + 0.022, 0.141]), C.lens, { noDust: true });
  }));

  // ---------- robotic arm: shoulder azimuth + elevation, elbow, wrist; all in one vertical plane ----------
  const S = V3(0.38, 0.86, 0.95), L1 = 0.82, L2 = 0.62, OFF = 0.12, LT = 0.46, TGT = V3(0, 0.05, 2.0);
  add('body', BB(0.3, 0.78, 0.78, 0.46, 0.9, 0.9), C.alu2);
  add('body', cylY(0.08, 0.14, 12, [S.x, S.y, S.z]), C.gold);
  add('upper', cylX(0.065, 0.16, 12, [0, 0, 0]), C.gold);
  add('upper', tube(V3(0, 0, 0.05), V3(0, 0, L1), 0.05, 8), C.rod);
  add('fore', cylX(0.07, OFF + 0.08, 12, [-OFF / 2, 0, 0]), C.gold);
  add('fore', tube(V3(0, 0, 0.05), V3(0, 0, L2 - 0.04), 0.045, 8), C.rod);
  const tu = (g, t, o) => add('turret', g, t, o);
  tu(cylX(0.06, 0.11, 10, [0, 0, 0]), C.gold);
  tu(BB(-0.035, -0.035, 0.03, 0.035, 0.035, 0.08), C.rod);
  tu(BB(-0.09, -0.09, 0.08, 0.09, 0.09, 0.24), C.white);
  tu(BB(-0.05, -0.05, 0.24, 0.05, 0.05, 0.4), C.alu2);
  tu(tube(V3(0, 0, 0.4), V3(0, 0, LT), 0.015, 6, false), C.dark);
  tu(tube(V3(0, 0.09, 0.16), V3(0, 0.27, 0.16), 0.045, 10), C.gold);                 // APXS
  tu(tube(V3(0, -0.09, 0.16), V3(0, -0.17, 0.16), 0.035, 8), C.copper);              // DRT
  tu(BB(0.09, -0.08, 0.09, 0.24, 0.08, 0.23), C.alu);                                  // CHIMRA
  tu(BB(-0.18, -0.05, 0.11, -0.09, 0.05, 0.21), C.cam, { noDust: true });              // MAHLI

  // arm keyframes [azimuth ψ, upper θ1, forearm θ2, turret θ3] — θ are absolute pitch angles in the arm plane
  const ARM0 = [-90 * DEG, -3 * DEG, 172 * DEG, -90 * DEG];
  const ARM1 = [-55 * DEG, 28 * DEG, 70 * DEG, -30 * DEG];
  const ARM2 = (() => {
    const dx = TGT.x - S.x, dz = TGT.z - S.z, R = Math.hypot(dx, dz), psi = Math.atan2(dx, dz) - Math.asin(OFF / R);
    const h = Math.sqrt(R * R - OFF * OFF), wy = TGT.y + LT - S.y, r = Math.hypot(h, wy);
    const t1 = Math.atan2(wy, h) + Math.acos((L1 * L1 + r * r - L2 * L2) / (2 * L1 * r));
    const ex = L1 * Math.cos(t1), ey = L1 * Math.sin(t1);
    return [psi, t1, Math.atan2(wy - ey, h - ex), -90 * DEG];
  })();
  const ARM_T = 0.45, armQ = [0, 0, 0, 0];
  function armAngles(t) {
    t = Math.min(1, Math.max(0, t));
    const seg0 = t < ARM_T, u = seg0 ? t / ARM_T : (t - ARM_T) / (1 - ARM_T), d = seg0 ? ARM_T : 1 - ARM_T;
    const h00 = 2 * u * u * u - 3 * u * u + 1, h10 = u * u * u - 2 * u * u + u, h01 = -2 * u * u * u + 3 * u * u, h11 = u * u * u - u * u;
    for (let j = 0; j < 4; j++) {
      const m = ARM2[j] - ARM0[j];
      armQ[j] = seg0 ? h00 * ARM0[j] + h01 * ARM1[j] + h11 * d * m : h00 * ARM1[j] + h10 * d * m + h01 * ARM2[j];
    }
    return armQ;
  }

  // ---------- merge ----------
  function merge(list) {
    let n = 0, ni = 0; list.forEach(g => { n += g.attributes.position.count; ni += g.index.count; });
    const out = new THREE.BufferGeometry(), idx = new Uint16Array(ni);
    [['position', 3], ['normal', 3], ['uv', 2], ['alb', 3], ['k', 3]].forEach(([k, size]) => {
      const arr = new Float32Array(n * size); let o = 0;
      list.forEach(g => { arr.set(g.attributes[k].array, o); o += g.attributes[k].array.length; });
      out.setAttribute(k, new THREE.BufferAttribute(arr, size));
    });
    let o = 0, base = 0; list.forEach(g => { const a = g.index.array; for (let i = 0; i < a.length; i++) idx[o++] = a[i] + base; base += g.attributes.position.count; });
    out.setIndex(new THREE.BufferAttribute(idx, 1));
    out.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    out.computeBoundingSphere(); return out;
  }
  const mesh = (list, name) => { const m = new THREE.Mesh(merge(L[list]), _mats.main); m.name = name; return m; };

  const group = new THREE.Group(); group.name = 'Curiosity_MSL';
  const body = mesh('body', 'curiosity_body'); group.add(body);
  const headYaw = new THREE.Group(); headYaw.name = 'curiosity_mast_yaw'; headYaw.position.copy(PIV); group.add(headYaw);
  const headPitch = new THREE.Group(); headPitch.name = 'curiosity_mast_pitch'; headYaw.add(headPitch);
  const head = mesh('head', 'curiosity_head'); headPitch.add(head);
  const armAz = new THREE.Group(); armAz.name = 'curiosity_arm_azimuth'; armAz.position.copy(S); group.add(armAz);
  const armUp = new THREE.Group(); armUp.name = 'curiosity_arm_shoulder'; armAz.add(armUp);
  const armFo = new THREE.Group(); armFo.name = 'curiosity_arm_elbow'; armFo.position.set(OFF, 0, L1); armUp.add(armFo);
  const armTu = new THREE.Group(); armTu.name = 'curiosity_arm_wrist'; armTu.position.set(0, 0, L2); armFo.add(armTu);
  const upper = mesh('upper', 'curiosity_arm_upper'); armUp.add(upper);
  const fore = mesh('fore', 'curiosity_arm_forearm'); armFo.add(fore);
  const turret = mesh('turret', 'curiosity_arm_turret'); armTu.add(turret);
  const rigid = [body, head, upper, fore, turret];

  // wheels + forks: sky-only baked colours (rotation-invariant); sun comes in per instance
  const wheelGeo = merge(L.wheel), forkGeo = merge(L.fork);
  [wheelGeo, forkGeo].forEach(g => {
    const N = g.attributes.normal.array, P = g.attributes.position.array, A = g.attributes.alb.array, K = g.attributes.k.array, Cc = g.attributes.color.array;
    for (let i = 0; i < Cc.length; i += 3) {
      const nx = N[i], d = Math.min(0.9, 0.33 * K[i]), inner = P[i] < -0.1 ? 0.72 : 1;
      const lvl = (0.4 + 0.16 * Math.max(0, nx)) * K[i + 1] * inner;
      for (let c = 0; c < 3; c++) Cc[i + c] = (A[i + c] + (C.dust[c] - A[i + c]) * d) * lvl * C.sky[c];
    }
  });
  const wheels = new THREE.InstancedMesh(wheelGeo, _mats.main, 6); wheels.name = 'curiosity_wheels';
  const corners = WH.map((w, i) => w.corner ? i : -1).filter(i => i >= 0);
  const forks = new THREE.InstancedMesh(forkGeo, _mats.main, corners.length); forks.name = 'curiosity_steering_forks';
  [wheels, forks].forEach(m => { m.frustumCulled = false; m.setColorAt(0, new THREE.Color(1, 1, 1)); group.add(m); });
  WH.forEach(w => {
    w.steerFull = w.corner ? Math.atan(-w.z / w.x) : 0;                                   // axles point at the rover centre
    w.kTurn = (w.z * Math.sin(w.steerFull) - w.x * Math.cos(w.steerFull)) / WR;          // wheel roll per radian of in-place yaw
  });

  // ---------- ground shadow (fixed soft disc, recoloured by relight) ----------
  const SH_N = 20, SH_HALF = 3.0;
  const shadow = (() => {
    const pos = [], idx = [];
    for (let j = 0; j <= SH_N; j++) for (let i = 0; i <= SH_N; i++) pos.push((i / SH_N * 2 - 1) * SH_HALF, 0.015, (j / SH_N * 2 - 1) * SH_HALF);
    for (let j = 0; j < SH_N; j++) for (let i = 0; i < SH_N; i++) { const a = j * (SH_N + 1) + i, b = a + 1, c = a + SH_N + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(pos.length), 3));
    g.setIndex(idx); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, _mats.shadow); m.name = 'curiosity_ground_shadow'; m.renderOrder = -1; return m;
  })();
  group.add(shadow);

  // ---------- setPose ----------
  const _m = new THREE.Matrix4(), _r = new THREE.Matrix4(), _mir = new THREE.Matrix4().makeScale(-1, 1, 1);
  const pose = { wheelAngle: 0, steer: 0, mastYaw: 0, mastPitch: 0, arm: 0, turnYaw: 0 };
  function setPose(p = {}) {
    for (const k in pose) if (p[k] !== undefined) pose[k] = p[k];
    headYaw.rotation.y = pose.mastYaw;
    headPitch.rotation.x = -pose.mastPitch;
    const q = armAngles(pose.arm);
    armAz.rotation.y = q[0]; armUp.rotation.x = -q[1]; armFo.rotation.x = -(q[2] - q[1]); armTu.rotation.x = -(q[3] - q[2]);
    let f = 0;
    for (let i = 0; i < 6; i++) {
      const w = WH[i], st = pose.steer * w.steerFull;
      _m.makeRotationX(pose.wheelAngle + pose.turnYaw * w.kTurn);
      if (w.sg < 0) _m.premultiply(_mir);
      _m.premultiply(_r.makeRotationY(st)); _m.elements[12] = w.x; _m.elements[13] = WY; _m.elements[14] = w.z;
      wheels.setMatrixAt(i, _m);
      if (w.corner) {
        _m.makeRotationY(st); if (w.sg < 0) _m.multiply(_mir);
        _m.elements[12] = w.x; _m.elements[13] = WY; _m.elements[14] = w.z; forks.setMatrixAt(f++, _m);
      }
    }
    wheels.instanceMatrix.needsUpdate = true; forks.instanceMatrix.needsUpdate = true;
  }

  // ---------- relight (colour-only; uses the current pose of mast and arm) ----------
  const s = V3(0, 1, 0), BMIN = [-0.62, 0.6, -0.96], BMAX = [0.62, 1.13, 0.8], SV = [0, 0, 0], O = [0, 0, 0];
  function blocked(ox, oy, oz) {                    // ray from point toward the sun hits the body box?
    O[0] = ox; O[1] = oy; O[2] = oz;
    if (ox > BMIN[0] && ox < BMAX[0] && oy > BMIN[1] && oy < BMAX[1] && oz > BMIN[2] && oz < BMAX[2]) return false;
    let t0 = 0, t1 = 1e9;
    for (let k = 0; k < 3; k++) {
      if (Math.abs(SV[k]) < 1e-6) { if (O[k] < BMIN[k] || O[k] > BMAX[k]) return false; continue; }
      let a = (BMIN[k] - O[k]) / SV[k], b = (BMAX[k] - O[k]) / SV[k]; if (a > b) { const t = a; a = b; b = t; }
      if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) return false;
    }
    return t1 > 0;
  }
  const invG = new THREE.Matrix4(), rel = new THREE.Matrix4(), col = new THREE.Color();
  const sky = C.sky, sun = C.sun, bnc = C.bounce, dust = C.dust;
  function relight(dir) {
    s.copy(dir).normalize(); SV[0] = s.x; SV[1] = s.y; SV[2] = s.z;
    const sx = s.x, sy = s.y, sz = s.z;
    group.updateMatrixWorld(true); invG.copy(group.matrixWorld).invert();
    for (const m of rigid) {
      const g = m.geometry, P = g.attributes.position.array, N = g.attributes.normal.array, A = g.attributes.alb.array, K = g.attributes.k.array, Cc = g.attributes.color.array;
      const e = rel.multiplyMatrices(invG, m.matrixWorld).elements;
      for (let i = 0; i < P.length; i += 3) {
        const x = P[i], y = P[i + 1], z = P[i + 2], a = N[i], b = N[i + 1], c = N[i + 2];
        const px = e[0] * x + e[4] * y + e[8] * z + e[12], py = e[1] * x + e[5] * y + e[9] * z + e[13], pz = e[2] * x + e[6] * y + e[10] * z + e[14];
        const nx = e[0] * a + e[4] * b + e[8] * c, ny = e[1] * a + e[5] * b + e[9] * c, nz = e[2] * a + e[6] * b + e[10] * c;
        const ndl = Math.max(0, nx * sx + ny * sy + nz * sz);
        const vis = ndl > 0 && K[i + 2] > 0 && blocked(px + nx * 0.03, py + ny * 0.03, pz + nz * 0.03) ? 0.12 : 1;
        let ao = K[i + 1];
        if (py < 0.62 && px > -0.95 && px < 0.95 && pz > -1.0 && pz < 0.85) ao *= 0.55;
        const ax = px < 0 ? -px : px; if (ax > 0.85 && ax < 1.05 && py < 0.5) ao *= 0.72;
        if (ny < -0.4) ao *= 0.8;
        ao *= 0.7 + 0.3 * sm(-0.05, 1.1, py);
        const amb = (0.34 + 0.1 * (ny * 0.5 + 0.5)) * ao, bo = 0.1 * Math.max(0, -ny) * ao, sn = 0.64 * ndl * vis;
        const up = Math.max(0, ny), d = K[i] > 0 ? Math.min(0.92, (0.1 + 0.68 * Math.pow(up, 1.4) + 0.2 * ndl * (1 - up)) * K[i]) : 0;
        for (let q = 0; q < 3; q++) { const al = A[i + q] + (dust[q] - A[i + q]) * d; Cc[i + q] = al * (amb * sky[q] + bo * bnc[q] + sn * sun[q]); }
      }
      g.attributes.color.needsUpdate = true;
    }
    let f = 0;
    for (let i = 0; i < 6; i++) {
      const w = WH[i], vis = blocked(w.x, 0.42, w.z) ? 0.15 : 1;
      const k = 1 + vis * (0.9 * Math.max(0, sy) + 0.7 * Math.max(0, w.sg * sx));
      col.setRGB(k, k, k); wheels.setColorAt(i, col); if (w.corner) forks.setColorAt(f++, col);
    }
    wheels.instanceColor.needsUpdate = true; forks.instanceColor.needsUpdate = true;
    // ground shadow: body footprint + sun-offset silhouette + wheel contact pools
    const syc = Math.max(0.15, sy); let ox = -sx / syc * 0.85, oz = -sz / syc * 0.85; const ol = Math.hypot(ox, oz); if (ol > 1.3) { ox *= 1.3 / ol; oz *= 1.3 / ol; }
    const P = shadow.geometry.attributes.position.array, Cc = shadow.geometry.attributes.color.array;
    const rect = (x, z, cx, cz, hx, hz, fz) => { const dx = Math.max(0, Math.abs(x - cx) - hx), dz = Math.max(0, Math.abs(z - cz) - hz); return 1 - sm(0, fz, Math.hypot(dx, dz)); };
    for (let i = 0; i < P.length; i += 3) {
      const x = P[i], z = P[i + 2];
      let d = rect(x, z, 0, -0.1, 0.72, 0.95, 0.9) * 0.75;
      d = Math.max(d, rect(x, z, ox, oz - 0.1, 0.62, 0.9, 0.7) * 0.85);
      for (const w of WH) d = Math.max(d, (1 - sm(0.18, 0.55, Math.hypot(x - w.x, z - w.z))) * 0.8);
      d *= 1 - sm(0.7, 1.0, Math.max(Math.abs(x), Math.abs(z)) / SH_HALF);
      const k = 1 - 0.6 * d; Cc[i] = ground[0] * k; Cc[i + 1] = ground[1] * k; Cc[i + 2] = ground[2] * k;
    }
    shadow.geometry.attributes.color.needsUpdate = true;
  }

  setPose();
  relight(sunDir);
  const info = { wheelRadius: WR, armTarget: TGT.clone(), wheels: WH.map(w => ({ x: w.x, z: w.z, corner: w.corner })) };
  return { group, setPose, relight, info };
}
