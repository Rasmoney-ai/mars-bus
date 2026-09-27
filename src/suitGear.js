// Mars-bus R-10 — passenger suit gear for WebXR (Meta Quest 3).
//   buildHelmet(THREE, { number, stripe })  → { group, mesh }      (avatar-only helmet)
//   buildGlove(THREE, 'left' | 'right')     → { group, mesh, bones, jointNames, setCurl, updateFromXR }
// 1 unit = 1 m, y-up, -Z forward (same as three.js cameras and WebXR joint spaces).
// Gloves are SkinnedMeshes with 25 bones named exactly like the WebXR hand joints.
// Bones are FLAT (all direct children of glove.group), so a joint pose from
// XRFrame.getJointPose() can be copied straight onto its bone.
// Needs a DOM for the canvas textures.
//
// Made with Claude Design (handoff "Mars-sightseeing-bus R-10"). Change for the
// Mars-bussen app, marked "APP:": buildGlove(..., { detail }) and
// buildHelmet(..., { detail }) build lighter versions for the other passengers
// (detail 1 = full, 0.5 = near passengers, 0.3 = passengers further away).

export const JOINTS = [
  'wrist',
  'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip',
  'index-finger-metacarpal', 'index-finger-phalanx-proximal', 'index-finger-phalanx-intermediate', 'index-finger-phalanx-distal', 'index-finger-tip',
  'middle-finger-metacarpal', 'middle-finger-phalanx-proximal', 'middle-finger-phalanx-intermediate', 'middle-finger-phalanx-distal', 'middle-finger-tip',
  'ring-finger-metacarpal', 'ring-finger-phalanx-proximal', 'ring-finger-phalanx-intermediate', 'ring-finger-phalanx-distal', 'ring-finger-tip',
  'pinky-finger-metacarpal', 'pinky-finger-phalanx-proximal', 'pinky-finger-phalanx-intermediate', 'pinky-finger-phalanx-distal', 'pinky-finger-tip',
];
const FINGERS = ['thumb', 'index-finger', 'middle-finger', 'ring-finger', 'pinky-finger'];

let _mats = null;
function canvasTex(THREE, w, h, paint, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  paint(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function drawBadge(g, x, y, s) {
  const cx = x + s / 2, cy = y + s / 2, R = s * 0.49;
  g.beginPath(); g.arc(cx, cy, R, 0, 7); g.fillStyle = '#16324a'; g.fill();
  g.lineWidth = s * 0.03; g.strokeStyle = '#e8c35a'; g.stroke();
  g.beginPath(); g.arc(cx, cy + s * 0.01, s * 0.2, 0, 7); g.fillStyle = '#c4552f'; g.fill();
  g.save(); g.translate(cx, cy); g.rotate(-0.32); g.beginPath(); g.ellipse(0, 0, s * 0.33, s * 0.1, 0, 0, 7);
  g.lineWidth = s * 0.014; g.strokeStyle = '#e8c35a'; g.stroke(); g.restore();
  g.font = `800 ${s * 0.1}px system-ui, sans-serif`; g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const w = 'MARSTUR', span = 1.25;
  [...w].forEach((ch, i) => { const a = -Math.PI / 2 - span / 2 + span * i / (w.length - 1); g.save(); g.translate(cx + Math.cos(a) * s * 0.38, cy + Math.sin(a) * s * 0.38); g.rotate(a + Math.PI / 2); g.fillText(ch, 0, 0); g.restore(); });
  g.font = `800 ${s * 0.11}px system-ui, sans-serif`; g.fillText('R-10', cx, cy + s * 0.38);
}
function materials(THREE) {
  if (_mats) return _mats;
  const weave = canvasTex(THREE, 128, 128, (g, w) => {
    g.fillStyle = '#fff'; g.fillRect(0, 0, w, w);
    for (let i = 0; i < w; i += 4) { g.fillStyle = i % 8 ? '#e4e4e4' : '#f7f7f7'; g.fillRect(0, i, w, 2); g.fillStyle = 'rgba(0,0,0,0.05)'; g.fillRect(i, 0, 1, w); }
  }, true);
  weave.repeat.set(3, 3);
  const visorTex = canvasTex(THREE, 64, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#3a4a58'); gr.addColorStop(0.35, '#121a22'); gr.addColorStop(0.62, '#06090d'); gr.addColorStop(1, '#1a2530');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    const hl = g.createLinearGradient(0, h * 0.18, 0, h * 0.3);
    hl.addColorStop(0, 'rgba(255,255,255,0)'); hl.addColorStop(0.5, 'rgba(210,230,255,0.35)'); hl.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = hl; g.fillRect(0, h * 0.18, w, h * 0.12);
  });
  const atlas = canvasTex(THREE, 1024, 512, (g) => {
    g.fillStyle = '#f1efea'; g.fillRect(0, 0, 1024, 512);
    drawBadge(g, 0, 0, 512);
    for (let i = 0; i < 10; i++) {
      const x = 512 + (i % 5) * 102, y = (i / 5 | 0) * 102;
      g.fillStyle = '#1c2830'; g.beginPath(); g.roundRect(x + 4, y + 4, 94, 94, 16); g.fill();
      g.lineWidth = 5; g.strokeStyle = '#e8c35a'; g.stroke();
      g.font = '800 62px system-ui, sans-serif'; g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(i + 1), x + 51, y + 55);
    }
  });
  _mats = {
    shell: new THREE.MeshStandardMaterial({ name: 'helmet_shell', color: '#f1efea', roughness: 0.42, metalness: 0 }),
    visor: new THREE.MeshStandardMaterial({ name: 'visor_dark', color: '#ffffff', map: visorTex, roughness: 0.12, metalness: 0.3 }),
    fabric: new THREE.MeshStandardMaterial({ name: 'suit_fabric', color: '#ecebe6', map: weave, roughness: 0.95, metalness: 0 }),
    rubber: new THREE.MeshStandardMaterial({ name: 'rubber_dark', color: '#2b2f34', roughness: 0.75, metalness: 0 }),
    gold: new THREE.MeshStandardMaterial({ name: 'suit_gold', color: '#d9ad4c', roughness: 0.38, metalness: 0.35 }),
    metal: new THREE.MeshStandardMaterial({ name: 'suit_metal', color: '#bcc0c4', roughness: 0.35, metalness: 0.3 }),
    light: new THREE.MeshBasicMaterial({ name: 'suit_light', color: '#fff4dd', toneMapped: false }),
    sign: new THREE.MeshBasicMaterial({ name: 'suit_signage', map: atlas, toneMapped: false }),
  };
  return _mats;
}
function atlasPlane(THREE, w, h, [x0, y0, rw, rh], round = false) {
  const g = round ? new THREE.CircleGeometry(w / 2, 32) : new THREE.PlaneGeometry(w, h), uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (x0 + uv.getX(i) * rw) / 1024, 1 - (y0 + (1 - uv.getY(i)) * rh) / 512);
  return g;
}
const numRect = n => [512 + ((n - 1) % 5) * 102, ((n - 1) / 5 | 0) * 102, 102, 102];

// merge geometries per material into one BufferGeometry with groups (+ optional skin attributes)
function mergeGroups(THREE, buckets, order, skinned) {
  const pos = [], nor = [], uv = [], si = [], sw = [];
  const geo = new THREE.BufferGeometry(); let start = 0;
  order.forEach((key, mi) => {
    let count = 0;
    for (const { g: g0, bone } of buckets[key] || []) {
      const g = g0.index ? g0.toNonIndexed() : g0;
      const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
      for (let i = 0; i < P.count; i++) {
        pos.push(P.getX(i), P.getY(i), P.getZ(i)); nor.push(N.getX(i), N.getY(i), N.getZ(i));
        uv.push(U ? U.getX(i) : 0, U ? U.getY(i) : 0);
        if (skinned) { si.push(bone, 0, 0, 0); sw.push(1, 0, 0, 0); }
      }
      count += P.count;
    }
    if (count) { geo.addGroup(start, count, mi); start += count; }
  });
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (skinned) {
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  }
  geo.computeBoundingSphere();
  return geo;
}

/* ------------------------------------------------------------------ HELMET
   Origin = the wearer's eye point (attach to the avatar head / XR camera pose).
   -Z forward. Opaque dark visor, no interior. */
export function buildHelmet(THREE, { number = 1, stripe = '#d9ad4c', detail = 1 } = {}) { // APP: detail
  const q = (n) => (detail < 1 ? Math.max(6, Math.round(n * detail)) : n); // APP: fewer segments
  const M = materials(THREE);
  const stripeMat = stripe === '#d9ad4c' ? M.gold : new THREE.MeshStandardMaterial({ name: 'helmet_stripe', color: stripe, roughness: 0.4, metalness: 0.2 });
  const C = new THREE.Vector3(0, 0.03, 0.07), R = 0.165;             // shell centre relative to eyes
  const B = { shell: [], visor: [], rubber: [], stripe: [], metal: [], light: [], sign: [] };
  const put = (k, g) => B[k].push({ g });
  const at = (g, x, y, z) => g.translate(C.x + x, C.y + y, C.z + z);
  const FWD = 1.5 * Math.PI;                                         // SphereGeometry phi that faces -Z

  const sph = (r, w, h, ...p) => at(new THREE.SphereGeometry(r, q(w), q(h), ...p), 0, 0, 0); // APP: q()
  const hArc = (th, p1, p2, r, tube, seg = 40) => new THREE.TorusGeometry(r * Math.sin(th), tube, q(8), q(seg), p2 - p1)
    .rotateX(Math.PI / 2).rotateY(-(Math.PI - p2)).translate(C.x, C.y + r * Math.cos(th), C.z);
  const vArc = (ph, t1, t2, r, tube, seg = 24) => new THREE.TorusGeometry(r, tube, q(8), q(seg), t2 - t1)
    .rotateZ(Math.PI / 2 - t2).rotateY(ph + Math.PI).translate(C.x, C.y, C.z);
  const VW = 1.08, HW = 1.13, TOP = 0.98, HB = 2.05, CHIN = 2.3, RH = R + 0.012;

  // pressure bubble + NASA-style visor assembly (hood over top, sides and back; opaque dark visor in front)
  put('shell', sph(R, 44, 26, 0, Math.PI * 2, 0, 2.35));
  put('shell', sph(RH, 44, 10, 0, Math.PI * 2, 0, TOP));
  put('shell', sph(RH, 36, 14, FWD + HW, Math.PI * 2 - 2 * HW, TOP, HB - TOP));
  put('rubber', sph(R + 0.003, 40, 16, FWD - HW, 2 * HW, TOP, CHIN + 0.04 - TOP));
  put('visor', sph(R + 0.007, 44, 18, FWD - VW, 2 * VW, TOP + 0.03, CHIN - TOP - 0.03));
  put('shell', hArc(TOP, FWD - HW - 0.02, FWD + HW + 0.02, RH - 0.002, 0.013));          // brow lip
  [-1, 1].forEach(s => put('shell', vArc(FWD + s * HW, TOP, HB, RH - 0.002, 0.012)));     // visor side rails
  put('shell', hArc(HB, FWD + HW, FWD + Math.PI * 2 - HW, RH - 0.004, 0.011, 36));        // hood lower edge
  put('rubber', hArc(CHIN, FWD - VW, FWD + VW, R + 0.006, 0.007, 30));                     // chin seal

  // neck bearing
  const yN = -Math.cos(2.35) * R, neckR = Math.sin(2.35) * R;
  put('metal', at(new THREE.TorusGeometry(neckR + 0.006, 0.015, q(10), q(40)).rotateX(Math.PI / 2), 0, -yN - 0.006, 0));
  put('stripe', at(new THREE.CylinderGeometry(neckR + 0.016, neckR + 0.016, 0.024, q(40), 1, true), 0, -yN - 0.03, 0));
  put('metal', at(new THREE.TorusGeometry(neckR + 0.012, 0.009, q(8), q(40)).rotateX(Math.PI / 2), 0, -yN - 0.046, 0));
  put('rubber', at(new THREE.CylinderGeometry(neckR - 0.004, neckR - 0.004, 0.06, q(32)), 0, -yN - 0.035, 0));

  [-1, 1].forEach(s => {
    // visor pivot boss
    put('shell', at(new THREE.CylinderGeometry(0.03, 0.034, 0.018, q(24)).rotateZ(Math.PI / 2), s * (RH + 0.004), -0.005, 0.005));
    put('metal', at(new THREE.CylinderGeometry(0.011, 0.011, 0.006, q(16)).rotateZ(Math.PI / 2), s * (RH + 0.015), -0.005, 0.005));
    // helmet light + camera module on a short arm
    const d = new THREE.Vector3(s * 0.78, 0.55, -0.3).normalize();
    const p = C.clone().addScaledVector(d, RH + 0.03);
    const arm = new THREE.CylinderGeometry(0.006, 0.006, 0.035, 8);
    arm.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d));
    put('metal', arm.translate(...C.clone().addScaledVector(d, RH + 0.012).toArray()));
    put('shell', new THREE.BoxGeometry(0.044, 0.03, 0.085).translate(p.x, p.y, p.z));
    put('rubber', new THREE.BoxGeometry(0.046, 0.032, 0.006).translate(p.x, p.y, p.z - 0.04));
    [-0.011, 0.011].forEach(dx => put('light', new THREE.CircleGeometry(0.0085, 16).rotateY(Math.PI).translate(p.x + dx, p.y, p.z - 0.0435)));
    put('rubber', new THREE.CylinderGeometry(0.007, 0.007, 0.022, q(12)).rotateX(Math.PI / 2).translate(p.x, p.y - 0.022, p.z - 0.03));
    put('metal', new THREE.CircleGeometry(0.0045, 12).rotateY(Math.PI).translate(p.x, p.y - 0.022, p.z - 0.0412));
  });
  // decals: badge on the right side, seat number on back and forehead
  const surf = (g, dir, off = 0.018) => { const n = dir.clone().normalize(); g.lookAt(n); g.translate(...C.clone().addScaledVector(n, R + off).toArray()); return g; };
  put('sign', surf(atlasPlane(THREE, 0.07, 0.07, [0, 0, 512, 512], true), new THREE.Vector3(0.85, 0.1, 0.5)));
  put('sign', surf(atlasPlane(THREE, 0.06, 0.06, numRect(number)), new THREE.Vector3(0, 0.25, 1)));
  put('sign', surf(atlasPlane(THREE, 0.034, 0.034, numRect(number)), new THREE.Vector3(0, 1.0, -0.62)));

  const order = ['shell', 'visor', 'rubber', 'stripe', 'metal', 'light', 'sign'];
  const mats = [M.shell, M.visor, M.rubber, stripeMat, M.metal, M.light, M.sign];
  const geo = mergeGroups(THREE, B, order, false);
  const mesh = new THREE.Mesh(geo, mats); mesh.name = `helmet_${number}`;
  const group = new THREE.Group(); group.name = `Helmet_${number}`; group.add(mesh);
  return { group, mesh };
}

/* ------------------------------------------------------------------ GLOVES
   Rest pose (bind pose): hand flat, palm down (-Y), fingers toward -Z, wrist at origin.
   Sized for 10–12 year olds; real joint poses from the headset override the rest lengths. */
const REST_R = {                         // right hand, metres
  wrist: [0, 0, 0],
  'thumb-metacarpal': [-0.02, -0.008, -0.018], 'thumb-phalanx-proximal': [-0.043, -0.01, -0.043],
  'thumb-phalanx-distal': [-0.056, -0.009, -0.066], 'thumb-tip': [-0.065, -0.008, -0.086],
  'index-finger-metacarpal': [-0.012, 0, -0.012], 'index-finger-phalanx-proximal': [-0.022, 0, -0.074],
  'index-finger-phalanx-intermediate': [-0.026, 0, -0.108], 'index-finger-phalanx-distal': [-0.028, 0, -0.128], 'index-finger-tip': [-0.029, 0, -0.146],
  'middle-finger-metacarpal': [-0.002, 0, -0.012], 'middle-finger-phalanx-proximal': [-0.004, 0, -0.077],
  'middle-finger-phalanx-intermediate': [-0.005, 0, -0.115], 'middle-finger-phalanx-distal': [-0.005, 0, -0.139], 'middle-finger-tip': [-0.005, 0, -0.158],
  'ring-finger-metacarpal': [0.008, 0, -0.012], 'ring-finger-phalanx-proximal': [0.013, -0.001, -0.072],
  'ring-finger-phalanx-intermediate': [0.016, -0.001, -0.107], 'ring-finger-phalanx-distal': [0.018, -0.001, -0.129], 'ring-finger-tip': [0.019, -0.001, -0.147],
  'pinky-finger-metacarpal': [0.017, -0.002, -0.012], 'pinky-finger-phalanx-proximal': [0.029, -0.004, -0.063],
  'pinky-finger-phalanx-intermediate': [0.034, -0.005, -0.09], 'pinky-finger-phalanx-distal': [0.037, -0.005, -0.106], 'pinky-finger-tip': [0.039, -0.005, -0.122],
};
const RADIUS = { thumb: [0.0135, 0.0115, 0.0105], 'index-finger': [0.0125, 0.0098, 0.009, 0.0085], 'middle-finger': [0.0125, 0.01, 0.0092, 0.0087], 'ring-finger': [0.0125, 0.0095, 0.0088, 0.0083], 'pinky-finger': [0.0115, 0.0086, 0.008, 0.0076] };

export function buildGlove(THREE, handedness = 'right', { detail = 1 } = {}) { // APP: detail
  const lowDetail = detail < 1;
  const q = (n) => (lowDetail ? Math.max(4, Math.round(n * detail)) : n); // APP: fewer segments
  const M = materials(THREE);
  const s = handedness === 'left' ? -1 : 1;
  const V = (a) => new THREE.Vector3(a[0] * s, a[1], a[2]);
  const P = {}; JOINTS.forEach(j => P[j] = V(REST_R[j]));
  const next = {};
  FINGERS.forEach(f => {
    const chain = JOINTS.filter(j => j.startsWith(f + '-'));
    chain.forEach((j, i) => next[j] = chain[i + 1] || null);
  });
  next.wrist = 'middle-finger-phalanx-proximal';
  const Q = {};
  const basisQ = (dir, up) => {
    const z = dir.clone().negate().normalize();
    const x = up.clone().cross(z).normalize();
    const y = z.clone().cross(x);
    return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  };
  const thumbUp = new THREE.Vector3(-0.55 * s, 0.84, 0).normalize(), up = new THREE.Vector3(0, 1, 0);
  JOINTS.forEach(j => {
    const n = next[j];
    const prev = JOINTS[JOINTS.indexOf(j) - 1];
    const dir = n ? P[n].clone().sub(P[j]) : P[j].clone().sub(P[prev]);
    Q[j] = basisQ(dir, j.startsWith('thumb') ? thumbUp : up);
  });
  const LEN = {}; JOINTS.forEach(j => LEN[j] = next[j] && j !== 'wrist' ? P[next[j]].distanceTo(P[j]) : 0);

  // geometry, authored in each bone's local space then moved to its rest pose
  const B = { fabric: [], rubber: [], gold: [], metal: [], sign: [] };
  const idx = j => JOINTS.indexOf(j);
  const local = (k, j, g) => { g.applyMatrix4(new THREE.Matrix4().compose(P[j], Q[j], new THREE.Vector3(1, 1, 1))); B[k].push({ g, bone: idx(j) }); };
  const seg = (len, r, sx = 1, sy = 1) => new THREE.CapsuleGeometry(r, Math.max(0.001, len), Math.max(1, Math.round(4 * detail)), Math.max(4, Math.round(12 * detail))).rotateX(Math.PI / 2).translate(0, 0, -len / 2).scale(sx, sy, 1); // APP: fewer segments

  FINGERS.forEach(f => {
    const chain = JOINTS.filter(j => j.startsWith(f + '-') && !j.endsWith('-tip'));
    chain.forEach((j, i) => {
      const r = RADIUS[f][i], isMeta = j.endsWith('metacarpal') && f !== 'thumb';
      const isDist = j.endsWith('distal');
      const L = isDist ? LEN[j] - r * 0.55 : LEN[j];
      local('fabric', j, isMeta ? seg(L, r, 1.05, 1.1) : seg(L, r));
      if (!isMeta && !isDist && !lowDetail) local('fabric', j, new THREE.TorusGeometry(r * 1.02, r * 0.16, q(6), q(14)).translate(0, 0, -L * 0.98));     // segment seams
      if (isDist) local('rubber', j, new THREE.SphereGeometry(r * 0.95, q(12), q(8)).scale(0.9, 0.45, 1.25).translate(0, -r * 0.62, -L * 0.72)); // grip pad
      if (j.endsWith('phalanx-proximal') && f !== 'thumb') local('gold', j, new THREE.BoxGeometry(r * 1.5, r * 0.5, r * 1.3).translate(0, r * 0.95, -r * 0.35)); // knuckle guard
    });
  });
  // palm heel + cuff on the wrist bone
  local('fabric', 'wrist', seg(0.034, 0.02, 1.55, 0.78).translate(0, -0.001, -0.004));
  const cuff = new THREE.CylinderGeometry(0.034, 0.047, 0.08, q(28), 1, true).rotateX(Math.PI / 2).scale(1.18, 0.9, 1).translate(0, 0, 0.056);
  local('fabric', 'wrist', cuff);
  local('fabric', 'wrist', new THREE.CylinderGeometry(0.047, 0.047, 0.004, q(28)).rotateX(Math.PI / 2).scale(1.18, 0.9, 1).translate(0, 0, 0.097));
  local('metal', 'wrist', new THREE.TorusGeometry(0.036, 0.0065, q(8), q(32)).scale(1.18, 0.9, 1).translate(0, 0, 0.016));
  local('gold', 'wrist', new THREE.TorusGeometry(0.043, 0.004, q(6), q(32)).scale(1.18, 0.9, 1).translate(0, 0, 0.07));
  // palm grip pad + back-of-hand badge on the middle metacarpal
  local('rubber', 'middle-finger-metacarpal', new THREE.CylinderGeometry(0.021, 0.021, 0.004, q(24)).scale(1.05, 1, 1.0).translate(0.002 * s, -0.0138, -0.032));
  local('sign', 'middle-finger-metacarpal', atlasPlane(THREE, 0.03, 0.03, [0, 0, 512, 512], true).rotateX(-Math.PI / 2).translate(0, 0.0142, -0.03));

  const order = ['fabric', 'rubber', 'gold', 'metal', 'sign'];
  const geo = mergeGroups(THREE, B, order, true);
  const group = new THREE.Group(); group.name = `Glove_${handedness}`;
  const bones = {};
  JOINTS.forEach(j => { const b = new THREE.Bone(); b.name = j; b.position.copy(P[j]); b.quaternion.copy(Q[j]); group.add(b); bones[j] = b; });
  const mesh = new THREE.SkinnedMesh(geo, [M.fabric, M.rubber, M.gold, M.metal, M.sign]);
  mesh.name = `glove_${handedness}`; mesh.frustumCulled = false;
  group.add(mesh);
  group.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(JOINTS.map(j => bones[j])));

  // Demo/fallback posing: curl[f] = [c1, c2, c3] radians per joint (thumb uses c0 on the metacarpal too).
  const rx = new THREE.Quaternion(), ax = new THREE.Vector3(1, 0, 0), fwd = new THREE.Vector3();
  function setCurl(curl) {
    bones.wrist.position.copy(P.wrist); bones.wrist.quaternion.copy(Q.wrist);
    FINGERS.forEach(f => {
      const chain = JOINTS.filter(j => j.startsWith(f + '-'));
      const c = curl[f] || [0, 0, 0, 0];
      const p = P[chain[0]].clone(), q = Q[chain[0]].clone();
      if (f === 'thumb') q.multiply(rx.setFromAxisAngle(ax, -(c[3] || 0)));
      bones[chain[0]].position.copy(p); bones[chain[0]].quaternion.copy(q);
      let lenPrev = LEN[chain[0]];
      for (let i = 1; i < chain.length; i++) {
        p.add(fwd.set(0, 0, -1).applyQuaternion(q).multiplyScalar(lenPrev));
        if (i === 1 && f !== 'thumb') q.copy(Q[chain[1]]);
        if (i <= 3 && !chain[i].endsWith('-tip')) q.multiply(rx.setFromAxisAngle(ax, -(c[i - 1] || 0)));
        bones[chain[i]].position.copy(p); bones[chain[i]].quaternion.copy(q);
        lenPrev = LEN[chain[i]];
      }
    });
  }
  // Live hand tracking: copy each joint pose onto its bone. Keep glove.group at the
  // reference-space origin (identity transform, same parent as the XR camera rig).
  function updateFromXR(frame, xrHand, refSpace) {
    if (!xrHand) return false;
    let ok = false;
    for (const j of JOINTS) {
      const space = xrHand.get(j); if (!space) continue;
      const pose = frame.getJointPose(space, refSpace); if (!pose) continue;
      const { position: p, orientation: o } = pose.transform;
      bones[j].position.set(p.x, p.y, p.z); bones[j].quaternion.set(o.x, o.y, o.z, o.w); ok = true;
    }
    group.visible = ok;
    return ok;
  }
  return { group, mesh, bones, jointNames: JOINTS, setCurl, updateFromXR };
}
