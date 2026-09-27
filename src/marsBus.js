// Mars-sightseeing-bus R-10 — three.js model builder.
// 1 unit = 1 m. Cabin floor y = 0, aisle x = 0, drives toward -Z.
// Usage:
//   import * as THREE from 'three';
//   import { buildMarsBus } from './marsBus.js';
//   const { group, seats, wheels, wheelRadius, groundY } = buildMarsBus(THREE);
//   scene.add(group);
// Requires a DOM (document.createElement('canvas')) for the procedural textures.
//
// Made with Claude Design (handoff "Mars-sightseeing-bus R-10"). Changes for
// the Mars-bussen app, all marked "APP:":
// - opts.seatBackScale: lower seat backs, so pupils can see out ahead.
// - opts.liveScreens: leave out the static route map and status strip; the
//   app draws a live map on the sloping dashboard face (returned as dashFace).

export function buildMarsBus(THREE, opts = {}) {
  const { seatBackScale = 1, liveScreens = false } = opts; // APP
  const V2 = (x, y) => new THREE.Vector2(x, y);
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const S = 2048; // atlas size

  // ---------- canvas textures ----------
  const R = {
    map: [0, 0, 1024, 576], status: [0, 576, 1024, 128], badge: [1024, 0, 512, 512],
    lock: [1536, 0, 448, 168], hazard: [1984, 256, 64, 1792], num: i => [i * 192, 720, 192, 192],
  };
  function drawAtlas() {
    const c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d');
    g.fillStyle = '#1c2830'; g.fillRect(0, 0, S, S);
    const F = (w, s) => `${w} ${s}px system-ui, "Segoe UI", sans-serif`;

    // route map
    g.save(); g.beginPath(); g.rect(0, 0, 1024, 576); g.clip();
    g.fillStyle = '#10202a'; g.fillRect(0, 0, 1024, 576);
    g.strokeStyle = 'rgba(255,255,255,0.05)'; g.lineWidth = 1;
    for (let x = 0; x < 1024; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 576); g.stroke(); }
    for (let y = 0; y < 576; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(1024, y); g.stroke(); }
    const blobs = [[250, 170, 120], [700, 430, 150], [880, 200, 90], [120, 480, 80], [520, 110, 70]];
    blobs.forEach(([cx, cy, r0], bi) => {
      for (let k = 1; k <= 5; k++) {
        const r = r0 * k / 5;
        g.beginPath();
        for (let a = 0; a <= 64; a++) {
          const t = a / 64 * Math.PI * 2;
          const rr = r * (1 + 0.12 * Math.sin(t * 3 + bi) + 0.07 * Math.sin(t * 5 + k));
          const px = cx + Math.cos(t) * rr, py = cy + Math.sin(t) * rr * 0.8;
          a ? g.lineTo(px, py) : g.moveTo(px, py);
        }
        g.strokeStyle = `rgba(226,140,92,${0.12 + k * 0.04})`; g.lineWidth = 2; g.stroke();
      }
    });
    const P = [[90, 480], [230, 410], [340, 300], [480, 262], [610, 330], [770, 262], [930, 130]];
    const busT = 0.45, bx = P[2][0] + (P[3][0] - P[2][0]) * busT, by = P[2][1] + (P[3][1] - P[2][1]) * busT;
    g.lineCap = g.lineJoin = 'round';
    g.setLineDash([14, 12]); g.strokeStyle = '#f3efe8'; g.lineWidth = 6;
    g.beginPath(); g.moveTo(bx, by); for (let i = 3; i < P.length; i++) g.lineTo(...P[i]); g.stroke();
    g.setLineDash([]); g.strokeStyle = '#f08a4b'; g.lineWidth = 10;
    g.beginPath(); g.moveTo(...P[0]); g.lineTo(...P[1]); g.lineTo(...P[2]); g.lineTo(bx, by); g.stroke();
    const stops = [[0, 'Basen', 1], [2, 'Kraterkanten', 1], [4, 'Støvklitterne', 0], [6, 'Olympus-udsigten', 0]];
    stops.forEach(([i, name, done]) => {
      const [x, y] = P[i];
      g.beginPath(); g.arc(x, y, 14, 0, Math.PI * 2);
      g.fillStyle = done ? '#f08a4b' : '#10202a'; g.fill();
      g.lineWidth = 5; g.strokeStyle = i === 4 ? '#e8c35a' : '#f3efe8'; g.stroke();
      g.font = F(600, 24); g.fillStyle = i === 4 ? '#e8c35a' : '#f3efe8';
      g.textAlign = 'center'; g.fillText(name, x, y + (i === 6 ? 44 : 46));
    });
    g.beginPath(); g.arc(bx, by, 24, 0, Math.PI * 2); g.fillStyle = '#ffffff'; g.fill();
    g.lineWidth = 6; g.strokeStyle = '#f08a4b'; g.stroke();
    const ang = Math.atan2(P[3][1] - P[2][1], P[3][0] - P[2][0]);
    g.save(); g.translate(bx, by); g.rotate(ang); g.beginPath();
    g.moveTo(13, 0); g.lineTo(-9, -10); g.lineTo(-4, 0); g.lineTo(-9, 10); g.closePath();
    g.fillStyle = '#10202a'; g.fill(); g.restore();
    g.font = F(800, 22); g.fillStyle = '#ffffff'; g.fillText('DU ER HER', bx, by - 38);
    g.textAlign = 'left';
    g.fillStyle = 'rgba(8,16,22,0.88)'; g.beginPath(); g.roundRect(24, 24, 360, 150, 14); g.fill();
    g.font = F(600, 22); g.fillStyle = '#9fb0ba'; g.fillText('NÆSTE STOP', 46, 62);
    g.font = F(800, 46); g.fillStyle = '#ffffff'; g.fillText('Støvklitterne', 46, 114);
    g.font = F(700, 32); g.fillStyle = '#e8c35a'; g.fillText('2,4 km · ca. 12 min', 46, 156);
    g.textAlign = 'center'; g.font = F(800, 26); g.fillStyle = '#f3efe8';
    g.beginPath(); g.moveTo(976, 40); g.lineTo(964, 72); g.lineTo(988, 72); g.closePath(); g.fill();
    g.fillText('N', 976, 100);
    g.fillRect(830, 538, 128, 5); g.font = F(600, 20); g.fillText('1 km', 894, 528);
    g.restore();

    // status strip: AUTOPILOT
    g.fillStyle = '#0b151b'; g.fillRect(0, 576, 1024, 128);
    g.beginPath(); g.arc(56, 640, 18, 0, Math.PI * 2); g.fillStyle = '#39d98a'; g.fill();
    g.textAlign = 'left'; g.textBaseline = 'middle';
    g.font = F(800, 66); g.fillStyle = '#ffffff'; g.fillText('AUTOPILOT', 96, 642);
    g.font = F(700, 40); g.fillStyle = '#39d98a'; g.fillText('AKTIV', 486, 644);
    g.textAlign = 'right'; g.font = F(700, 48); g.fillStyle = '#f3efe8'; g.fillText('12 km/t', 996, 644);

    // mission badge (invented)
    const [bx0, by0] = R.badge, cx = bx0 + 256, cy = by0 + 256;
    g.clearRect(bx0, by0, 512, 512); g.fillStyle = '#f1efea'; g.fillRect(bx0, by0, 512, 512);
    g.beginPath(); g.arc(cx, cy, 250, 0, Math.PI * 2); g.fillStyle = '#16324a'; g.fill();
    g.lineWidth = 14; g.strokeStyle = '#e8c35a'; g.stroke();
    g.beginPath(); g.arc(cx, cy + 6, 104, 0, Math.PI * 2); g.fillStyle = '#c4552f'; g.fill();
    g.fillStyle = '#a2401f';
    [[-30, -20, 30], [40, 30, 22], [-10, 50, 16], [50, -40, 12]].forEach(([dx, dy, r]) => { g.beginPath(); g.arc(cx + dx, cy + 6 + dy, r, 0, 7); g.fill(); });
    g.save(); g.translate(cx, cy + 6); g.rotate(-0.32);
    g.beginPath(); g.ellipse(0, 0, 168, 50, 0, 0, Math.PI * 2); g.lineWidth = 7; g.strokeStyle = '#e8c35a'; g.stroke();
    g.beginPath(); g.arc(150, 22, 13, 0, 7); g.fillStyle = '#ffffff'; g.fill(); g.restore();
    g.font = F(800, 50); g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const word = 'MARSTUR', span = 1.25;
    [...word].forEach((ch, i) => {
      const a = -Math.PI / 2 - span / 2 + span * (i / (word.length - 1));
      g.save(); g.translate(cx + Math.cos(a) * 196, cy + Math.sin(a) * 196); g.rotate(a + Math.PI / 2); g.fillText(ch, 0, 0); g.restore();
    });
    g.font = F(800, 58); g.fillText('R-10', cx, cy + 196);

    // airlock sign
    const [lx, ly, lw, lh] = R.lock;
    g.fillStyle = '#f2c230'; g.fillRect(lx, ly, lw, lh);
    g.lineWidth = 10; g.strokeStyle = '#141414'; g.strokeRect(lx + 8, ly + 8, lw - 16, lh - 16);
    g.font = F(900, 86); g.fillStyle = '#141414'; g.fillText('LUFTSLUSE', lx + lw / 2, ly + lh / 2 + 4);

    // hazard stripes (vertical strip)
    const [hx, hy, hw, hh] = R.hazard;
    g.save(); g.beginPath(); g.rect(hx, hy, hw, hh); g.clip();
    g.fillStyle = '#f2c230'; g.fillRect(hx, hy, hw, hh); g.fillStyle = '#141414';
    for (let y = hy - 64; y < hy + hh; y += 64) { g.beginPath(); g.moveTo(hx, y); g.lineTo(hx + hw, y - 32); g.lineTo(hx + hw, y); g.lineTo(hx, y + 32); g.closePath(); g.fill(); }
    g.restore();

    // seat numbers
    for (let i = 0; i < 10; i++) {
      const [x, y, w] = R.num(i);
      g.fillStyle = '#1c2830'; g.beginPath(); g.roundRect(x + 8, y + 8, w - 16, w - 16, 26); g.fill();
      g.lineWidth = 8; g.strokeStyle = '#e8c35a'; g.stroke();
      g.font = F(800, 116); g.fillStyle = '#ffffff'; g.fillText(String(i + 1), x + w / 2, y + w / 2 + 6);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.name = 'signage_atlas';
    return t;
  }
  function tileTex(name, size, paint) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, size, size); paint(g, size);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.name = name;
    return t;
  }
  const noise = (g, s, n, a) => { for (let i = 0; i < n; i++) { const v = 200 + Math.random() * 55 | 0; g.fillStyle = `rgba(${v},${v},${v},${a})`; g.fillRect(Math.random() * s, Math.random() * s, 2, 2); } };
  const liningTex = tileTex('lining_tile', 256, (g, s) => {
    noise(g, s, 3000, 0.5); g.fillStyle = '#b9b9b4'; g.fillRect(0, 0, s, 3); g.fillRect(0, 0, 3, s);
    g.fillStyle = '#c8c8c3'; [[16, 16], [s - 16, 16], [16, s - 16], [s - 16, s - 16]].forEach(([x, y]) => { g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill(); });
  });
  const hullTex = tileTex('hull_tile', 256, (g, s) => { noise(g, s, 1500, 0.35); g.fillStyle = '#d9d7d1'; g.fillRect(0, 0, s, 2); g.fillRect(0, 0, 2, s); });
  const floorTex = tileTex('floor_tile', 128, (g, s) => { g.fillStyle = '#b4b4b4'; for (let x = 8; x < s; x += 16) for (let y = 8; y < s; y += 16) { g.beginPath(); g.arc(x, y, 3.2, 0, 7); g.fill(); } });
  const fabricTex = tileTex('fabric_weave', 128, (g, s) => { for (let i = 0; i < s; i += 4) { g.fillStyle = i % 8 ? '#e6e6e6' : '#f6f6f6'; g.fillRect(0, i, s, 2); g.fillStyle = 'rgba(0,0,0,0.05)'; g.fillRect(i, 0, 1, s); } noise(g, s, 600, 0.4); });

  // ---------- materials (10) ----------
  const std = (name, color, rough, metal, extra = {}) => new THREE.MeshStandardMaterial({ name, color, roughness: rough, metalness: metal, vertexColors: true, ...extra });
  const M = {
    hull: std('hull_white', '#f1efea', 0.55, 0, { map: hullTex }),
    lining: std('interior_lining', '#dcdcd5', 0.85, 0, { map: liningTex }),
    floor: std('floor_rubber', '#474b4f', 0.92, 0, { map: floorTex }),
    fabric: std('seat_fabric', '#2c5a86', 0.95, 0, { map: fabricTex }),
    trim: std('trim_dark', '#2b2f34', 0.6, 0),
    gold: std('chassis_gold', '#d9ad4c', 0.38, 0.35),
    metal: std('metal_alu', '#bcc0c4', 0.35, 0.3),
    glass: new THREE.MeshStandardMaterial({ name: 'glass_tinted', color: '#a9d2dc', roughness: 0.08, metalness: 0, transparent: true, opacity: 0.17, depthWrite: false, side: THREE.DoubleSide }),
    light: new THREE.MeshBasicMaterial({ name: 'light_emissive', color: '#ffffff', vertexColors: true, toneMapped: false }),
    sign: new THREE.MeshBasicMaterial({ name: 'signage_atlas', map: drawAtlas(), toneMapped: false }),
  };
  const planarScale = { hull: 1 / 1.6, lining: 1, floor: 2, fabric: 5 };

  // ---------- geometry helpers ----------
  const parts = {}; Object.keys(M).forEach(k => parts[k] = []);
  const add = (mat, geo, tint = [1, 1, 1]) => { parts[mat].push({ geo, tint }); return geo; };
  const xf = (g, p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1]) => g.applyMatrix4(new THREE.Matrix4().compose(V3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), V3(...s)));
  const BB = (x0, y0, z0, x1, y1, z1) => xf(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2]);
  const basisM = (ex, ey, o) => { const ez = ex.clone().cross(ey); return new THREE.Matrix4().makeBasis(ex, ey, ez).setPosition(o); };
  const SIDE = [V3(0, 0, 1), V3(0, 1, 0)];                // local x→z, y→y, extrude → -x
  const XY = [V3(1, 0, 0), V3(0, 1, 0)];                  // extrude → +z
  const slC = 0.9606, slS = 0.2781;                       // front slant: 1.9 up, 0.55 back
  const FRONT = [V3(1, 0, 0), V3(0, slC, slS)];           // extrude → inward (+z/-y)
  const FRONT_N = V3(0, -slS, slC);
  const FRONT_O = V3(0, 0.35, -3.9);

  const ccw = pts => THREE.ShapeUtils.isClockWise(pts) ? pts.slice().reverse() : pts;
  function rr(x0, y0, x1, y1, r, seg = 5) {
    const p = [], c = [[x1 - r, y0 + r, -Math.PI / 2], [x1 - r, y1 - r, 0], [x0 + r, y1 - r, Math.PI / 2], [x0 + r, y0 + r, Math.PI]];
    c.forEach(([cx, cy, a0]) => { for (let i = 0; i <= seg; i++) { const a = a0 + (Math.PI / 2) * (i / seg); p.push(V2(cx + Math.cos(a) * r, cy + Math.sin(a) * r)); } });
    return p;
  }
  const circ = (cx, cy, r, n = 40) => Array.from({ length: n }, (_, i) => V2(cx + Math.cos(i / n * Math.PI * 2) * r, cy + Math.sin(i / n * Math.PI * 2) * r));
  const poly = a => a.map(([x, y]) => V2(x, y));
  function offset(pts, d) {
    pts = ccw(pts); const n = pts.length, out = [];
    for (let i = 0; i < n; i++) {
      const a = pts[(i - 1 + n) % n], b = pts[i], c = pts[(i + 1) % n];
      const n1 = V2(b.y - a.y, a.x - b.x).normalize(), n2 = V2(c.y - b.y, b.x - c.x).normalize();
      const m = n1.clone().add(n2).normalize();
      out.push(b.clone().add(m.multiplyScalar(d / Math.max(0.3, m.dot(n1)))));
    }
    return out;
  }
  const shapeOf = (outer, holes = []) => { const s = new THREE.Shape(outer); holes.forEach(h => s.holes.push(new THREE.Path(h))); return s; };
  const extr = (shape, depth, opt = {}) => new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 1, ...opt });
  const inBasis = (g, [ex, ey], o) => g.applyMatrix4(basisM(ex, ey, o));

  function atlasPlane(w, h, rect) {
    const g = new THREE.PlaneGeometry(w, h), uv = g.attributes.uv, [x0, y0, rw, rh] = rect;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (x0 + uv.getX(i) * rw) / S, 1 - (y0 + (1 - uv.getY(i)) * rh) / S);
    return g;
  }
  // window: shell hole + frame ring + glass, in a wall's local 2D space
  function windowSet(pts, basis, frameO, frameDepth, glassO, fo = 0.04, fi = 0.025) {
    add('trim', inBasis(extr(shapeOf(offset(pts, fo), [offset(pts, -fi)]), frameDepth), basis, frameO));
    add('glass', inBasis(new THREE.ShapeGeometry(shapeOf(offset(pts, -0.005))), basis, glassO));
  }

  const shellY = x => 2.25 + 0.2 * (1 - (x / 1.3) ** 2);
  const linY = x => 2.2 + 0.16 * (1 - (x / 1.2) ** 2);
  const arc = (hw, f, dy = 0, n = 24, rev = false) => { const a = []; for (let i = 0; i <= n; i++) { const x = -hw + 2 * hw * i / n; a.push(V2(x, f(x) + dy)); } return rev ? a.reverse() : a; };
  const fullProfile = (hw, y0, f) => [V2(-hw, y0), V2(hw, y0), ...arc(hw, f, 0, 24, true)];
  const capProfile = (hw, f) => arc(hw, f, 0, 24, true);
  const roofBand = (hw, f, up, down) => [...arc(hw, f, up), ...arc(hw, f, -down, 24, true)];

  // ---------- layout ----------
  const ROWS = [-2.2, -1.3, -0.4, 0.5, 1.4], SEAT_X = 0.75;
  const seats = [];
  ROWS.forEach((z, r) => [-1, 1].forEach((s, k) => {
    const n = r * 2 + k + 1, x = s * SEAT_X;
    seats.push({ number: n, row: r + 1, side: s < 0 ? 'venstre' : 'højre', position: V3(x, 0, z), eye: V3(x, 1.05, z + 0.02) });
  }));

  // ---------- shell & lining ----------
  const sideShell = poly([[-3.9, -0.15], [4.5, -0.15], [4.5, 2.25], [-3.35, 2.25], [-3.9, 0.35]]);
  const sideLining = poly([[-3.81, 0], [4.42, 0], [4.42, 2.2], [-3.274, 2.2], [-3.81, 0.35]]);
  const sideWins = [poly([[-3.60, 0.82], [-3.02, 0.82], [-3.02, 1.8], [-3.31, 1.8]]),
    rr(-2.9, 0.8, -1.8, 1.8, 0.09), rr(-1.7, 0.8, -0.9, 1.8, 0.09), rr(-0.8, 0.8, 0.0, 1.8, 0.09),
    rr(0.1, 0.8, 0.9, 1.8, 0.09), rr(1.0, 0.8, 2.0, 1.8, 0.09)];
  [1, -1].forEach(s => {
    add('hull', inBasis(extr(shapeOf(sideShell, sideWins), 0.04), SIDE, V3(s > 0 ? 1.30 : -1.26, 0, 0)));
    add('lining', inBasis(extr(shapeOf(sideLining, sideWins), 0.03), SIDE, V3(s > 0 ? 1.23 : -1.20, 0, 0)));
    sideWins.forEach(w => windowSet(w, SIDE, V3(s > 0 ? 1.315 : -1.175, 0, 0), 0.14, V3(s * 1.28, 0, 0)));
  });
  const vOf = y => (y - 0.35) / slC;
  const frontWins = [rr(-1.16, vOf(1.5), 1.16, vOf(2.14), 0.1), rr(-0.6, vOf(0.72), 0.6, vOf(1.42), 0.08)];
  const bubbles = [-0.92, 0.92].map(u => ({ u, v: vOf(1.02), r: 0.24 }));
  const frontHoles = [...frontWins, ...bubbles.map(b => circ(b.u, b.v, b.r))];
  const fAt = (u, v, n) => FRONT_O.clone().addScaledVector(V3(1, 0, 0), u).addScaledVector(FRONT[1], v).addScaledVector(FRONT_N, n);
  add('hull', inBasis(extr(shapeOf(poly([[-1.3, 0], [1.3, 0], [1.3, 1.978], [-1.3, 1.978]]), frontHoles), 0.04), FRONT, FRONT_O));
  add('lining', inBasis(extr(shapeOf(poly([[-1.2, 0], [1.2, 0], [1.2, 1.952], [-1.2, 1.952]]), frontHoles), 0.03), FRONT, fAt(0, 0, 0.09)));
  frontWins.forEach(w => windowSet(w, FRONT, fAt(0, 0, -0.015), 0.15, fAt(0, 0, 0.02)));
  bubbles.forEach(b => {
    add('trim', inBasis(extr(shapeOf(offset(circ(b.u, b.v, b.r), 0.05), [offset(circ(b.u, b.v, b.r), -0.02)]), 0.15), FRONT, fAt(0, 0, -0.015)));
    const R0 = 0.3, th = Math.asin(b.r / R0);
    const dome = new THREE.SphereGeometry(R0, 28, 8, 0, Math.PI * 2, 0, th);
    dome.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), FRONT_N.clone().negate()));
    dome.translate(...fAt(b.u, b.v, R0 * Math.cos(th)).toArray());
    add('glass', dome);
    const ring = new THREE.TorusGeometry(b.r + 0.02, 0.028, 8, 36);
    ring.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V3(0, 0, 1), FRONT_N));
    ring.translate(...fAt(b.u, b.v, -0.02).toArray());
    add('trim', ring);
  });
  // nose, belly, floor, roof, end walls
  add('hull', BB(-1.3, -0.15, -3.9, 1.3, 0.35, -3.86));
  add('lining', BB(-1.2, 0, -3.81, 1.2, 0.35, -3.78));
  add('hull', BB(-1.3, -0.17, -3.9, 1.3, -0.13, 4.5));
  add('floor', BB(-1.2, -0.06, -3.81, 1.2, 0, 4.42));
  add('hull', inBasis(extr(shapeOf(roofBand(1.3, shellY, 0, 0.04)), 7.85), XY, V3(0, 0, -3.35)));
  add('hull', inBasis(extr(shapeOf(capProfile(1.3, x => shellY(x))), 0.04), XY, V3(0, 0, -3.35)));
  add('hull', inBasis(extr(shapeOf(fullProfile(1.3, -0.15, shellY)), 0.04), XY, V3(0, 0, 4.46)));
  add('lining', inBasis(extr(shapeOf(roofBand(1.2, linY, 0.03, 0)), 7.69), XY, V3(0, 0, -3.27)));
  add('lining', inBasis(extr(shapeOf(capProfile(1.2, linY)), 0.03), XY, V3(0, 0, -3.27)));
  add('lining', inBasis(extr(shapeOf(fullProfile(1.2, 0, linY)), 0.03), XY, V3(0, 0, 4.39)));

  // ---------- airlock partition (z = 3.5) ----------
  const doorHole = rr(-0.42, 0.06, 0.42, 1.95, 0.12);
  add('lining', inBasis(extr(shapeOf(fullProfile(1.2, 0, linY), [doorHole]), 0.08), XY, V3(0, 0, 3.5)));
  add('trim', inBasis(extr(shapeOf(offset(doorHole, 0.05), [offset(doorHole, -0.01)]), 0.12), XY, V3(0, 0, 3.48)));
  const port = circ(0, 1.45, 0.14, 32);
  add('hull', inBasis(extr(shapeOf(rr(-0.41, 0.07, 0.41, 1.94, 0.11), [port]), 0.05), XY, V3(0, 0, 3.515)));
  add('trim', inBasis(extr(shapeOf(offset(port, 0.035), [offset(port, -0.01)]), 0.09), XY, V3(0, 0, 3.495)));
  add('glass', xf(new THREE.CircleGeometry(0.14, 32), [0, 1.45, 3.54]));
  add('metal', BB(0.2, 0.98, 3.47, 0.34, 1.02, 3.5));
  add('metal', BB(0.3, 0.94, 3.49, 0.34, 1.06, 3.515));
  add('trim', BB(-0.25, 1.62, 3.505, 0.25, 1.64, 3.515)); // inspection seam
  [-0.5, 0.5].forEach(x => add('sign', xf(atlasPlane(0.07, 1.89, R.hazard), [x, 1.005, 3.496], [0, Math.PI, 0])));
  add('sign', xf(atlasPlane(0.48, 0.18, R.lock), [0, 2.1, 3.496], [0, Math.PI, 0]));

  // ---------- interior furnishing ----------
  [1, -1].forEach(s => {
    const X = (a, b) => s > 0 ? [a, b] : [-b, -a];
    const [a, b] = X(1.06, 1.2); add('lining', BB(a, 0.76, -3.6, b, 0.8, 2.05));
    const [c, d] = X(1.055, 1.07); add('trim', BB(c, 0.755, -3.6, d, 0.805, 2.05));
    const [e, f] = X(1.17, 1.2); add('trim', BB(e, 0, -3.0, f, 0.1, 3.5));
    // rear lockers
    const [l0, l1] = X(0.72, 1.2); add('lining', BB(l0, 0, 2.25, l1, 2.05, 3.48));
    const fx = s > 0 ? 0.715 : -0.715, fw = 0.012;
    add('trim', BB(fx - fw, 0.02, 2.855, fx + fw, 2.03, 2.875));
    add('trim', BB(fx - fw, 0.02, 2.27, fx + fw, 0.1, 3.46));
    add('trim', BB(fx - fw, 1.3, 2.27, fx + fw, 1.315, 3.46));
    [2.78, 2.95].forEach(z => add('metal', BB(fx - 0.03 * s - 0.01, 1.0, z - 0.015, fx - 0.03 * s + 0.01, 1.2, z + 0.015)));
    add('trim', BB(s > 0 ? 0.72 : -1.2, 2.05, 2.25, s > 0 ? 1.2 : -0.72, 2.08, 3.48));
    // ceiling light strip + reading lights + wall seat plates
    add('light', BB(s * 0.55 - 0.04, 2.305, -2.9, s * 0.55 + 0.04, 2.32, 3.3), [1, 0.95, 0.84]);
    add('light', BB(s * 0.42 - 0.012, 0.001, -2.95, s * 0.42 + 0.012, 0.006, 3.4), [1, 0.62, 0.25]);
    ROWS.forEach((z, r) => {
      const lamp = xf(new THREE.CylinderGeometry(0.05, 0.05, 0.02, 20), [s * SEAT_X, linY(SEAT_X) - 0.012, z - 0.05]);
      add('light', lamp, [1, 0.93, 0.78]);
      add('trim', xf(new THREE.TorusGeometry(0.055, 0.01, 6, 20), [s * SEAT_X, linY(SEAT_X) - 0.02, z - 0.05], [Math.PI / 2, 0, 0]));
      const num = r * 2 + (s < 0 ? 1 : 2);
      add('sign', xf(atlasPlane(0.16, 0.16, R.num(num - 1)), [s * 1.19, 1.95, z], [0, s < 0 ? Math.PI / 2 : -Math.PI / 2, 0]));
    });
  });
  add('trim', BB(-0.16, 2.325, -2.9, 0.16, 2.36, 3.4));
  for (let z = -2.6; z < 3.3; z += 0.9) add('metal', BB(-0.1, 2.318, z, 0.1, 2.326, z + 0.3));

  // ---------- seats ----------
  const cushionG = extr(new THREE.Shape(rr(-0.21, -0.2, 0.21, 0.2, 0.06, 4)), 0.06, { bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2 });
  const padG = extr(new THREE.Shape(rr(-0.2, 0.02, 0.2, 0.44, 0.06, 4)), 0.04, { bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2 });
  const shellG = extr(new THREE.Shape(rr(-0.24, -0.02, 0.24, 0.5, 0.07, 4)), 0.03);
  seats.forEach(({ position: p, number }) => {
    const sx = p.x, sz = p.z, aisle = -Math.sign(sx);
    add('fabric', xf(cushionG.clone(), [sx, 0.34, sz], [-Math.PI / 2, 0, 0]));
    add('trim', BB(sx - 0.22, 0.28, sz - 0.19, sx + 0.22, 0.32, sz + 0.19));
    const back = new THREE.Matrix4().compose(V3(sx, 0.45, sz + 0.2), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, 0, 0)), V3(1, seatBackScale, 1)); // APP: scale
    add('fabric', padG.clone().applyMatrix4(back));
    add('trim', shellG.clone().translate(0, 0, 0.065).applyMatrix4(back));
    const bar = new THREE.CylinderGeometry(0.016, 0.016, 0.38, 12).rotateZ(Math.PI / 2).translate(0, 0.55, 0.1).applyMatrix4(back);
    add('metal', bar);
    [-0.17, 0.17].forEach(x => add('metal', new THREE.CylinderGeometry(0.014, 0.014, 0.07, 8).translate(x, 0.515, 0.1).applyMatrix4(back)));
    add('metal', BB(sx - 0.04, 0.02, sz - 0.06, sx + 0.04, 0.29, sz + 0.06));
    add('metal', BB(sx - 0.16, 0, sz - 0.16, sx + 0.16, 0.02, sz + 0.16));
    const ax = sx + aisle * 0.25;
    add('trim', BB(ax - 0.028, 0.6, sz - 0.16, ax + 0.028, 0.645, sz + 0.22));
    add('trim', BB(ax - 0.02, 0.42, sz + 0.16, ax + 0.02, 0.6, sz + 0.21));
    add('sign', xf(atlasPlane(0.1, 0.1, R.num(number - 1)), [sx + aisle * 0.243, 0.78, sz + 0.27], [0, aisle > 0 ? Math.PI / 2 : -Math.PI / 2, 0]));
  });

  // ---------- dashboard ----------
  const dashProfile = poly([[-3.79, 0], [-3.0, 0], [-3.0, 0.4], [-3.1, 0.7], [-3.66, 0.76], [-3.79, 0.4]]);
  add('trim', inBasis(extr(new THREE.Shape(dashProfile), 2.38), SIDE, V3(1.19, 0, 0)));
  add('light', BB(-1.1, 0.702, -3.12, 1.1, 0.712, -3.1), [0.35, 0.85, 1.0]);
  add('sign', xf(atlasPlane(0.22, 0.22, R.badge), [0, 0.22, -2.996]));
  const pod = new THREE.Matrix4().compose(V3(0, 0.93, -3.28), new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.26, 0, 0)), V3(1, 1, 1));
  if (!liveScreens) { // APP: the app puts a live map on the dashboard face instead (keeps the windshield clear)
    add('trim', new THREE.BoxGeometry(0.8, 0.56, 0.05).applyMatrix4(pod));
    add('sign', atlasPlane(0.72, 0.405, R.map).translate(0, 0.05, 0.026).applyMatrix4(pod));
    add('sign', atlasPlane(0.72, 0.09, R.status).translate(0, -0.215, 0.026).applyMatrix4(pod));
    add('trim', BB(-0.1, 0.6, -3.36, 0.1, 0.8, -3.24));
  }
  // APP: the sloping face of the dashboard (z -3.0, y 0.4 up to z -3.1, y 0.7), facing the passengers.
  const dashFace = new THREE.Matrix4().compose(V3(0, 0.55, -3.05).addScaledVector(V3(0, 0.316, 0.949), 0.006),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.322, 0, 0)), V3(1, 1, 1));

  // ---------- exterior ----------
  [1, -1].forEach(s => {
    add('gold', BB(s > 0 ? 1.3 : -1.315, 0.52, -3.8, s > 0 ? 1.315 : -1.3, 0.58, 4.45));
    add('sign', xf(atlasPlane(0.8, 0.8, R.badge), [s * 1.302, 1.25, 3.3], [0, s > 0 ? Math.PI / 2 : -Math.PI / 2, 0]));
    add('trim', BB(s * 0.95 - 0.17, 0.0, -3.915, s * 0.95 + 0.17, 0.16, -3.899));
    add('light', BB(s * 0.95 - 0.14, 0.025, -3.925, s * 0.95 + 0.14, 0.135, -3.912), [1, 0.97, 0.9]);
    add('metal', xf(new THREE.CylinderGeometry(0.018, 0.018, 4.8, 8), [s * 1.05, 2.42, -0.2], [Math.PI / 2, 0, 0]));
    for (let z = -2.5; z <= 2.2; z += 1.2) add('metal', xf(new THREE.CylinderGeometry(0.014, 0.014, 0.1, 6), [s * 1.05, 2.37, z]));
  });
  add('trim', BB(-0.8, 2.4, -3.26, 0.8, 2.48, -3.14));
  [-0.6, -0.2, 0.2, 0.6].forEach(x => add('light', BB(x - 0.11, 2.415, -3.272, x + 0.11, 2.465, -3.26), [1, 0.98, 0.92]));
  add('metal', xf(new THREE.CylinderGeometry(0.012, 0.012, 0.8, 6), [0.9, 2.75, 1.8]));
  add('metal', xf(new THREE.CylinderGeometry(0.012, 0.012, 0.55, 6), [-0.9, 2.62, 1.2]));
  add('metal', xf(new THREE.SphereGeometry(0.03, 8, 6), [-0.9, 2.9, 1.2]));
  add('hull', BB(-0.6, 2.4, 2.6, 0.6, 2.62, 4.2));
  add('gold', BB(-0.55, 2.62, 2.7, 0.55, 2.635, 4.1));
  add('metal', xf(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 8), [-0.3, 2.78, 3.9]));
  const dishPts = []; for (let i = 0; i <= 10; i++) { const r = 0.28 * i / 10; dishPts.push(V2(r, r * r * 1.4)); }
  for (let i = 10; i >= 0; i--) { const r = 0.28 * i / 10; dishPts.push(V2(r, r * r * 1.4 - 0.015)); }
  add('hull', xf(new THREE.LatheGeometry(dishPts, 28), [-0.3, 2.93, 3.9], [-0.5, 0, 0.3]));
  add('metal', xf(new THREE.CylinderGeometry(0.008, 0.008, 0.2, 6), [-0.3, 3.0, 3.86], [-0.5, 0, 0.3]));
  // rear hatch + ladder
  const hatch = rr(-0.45, 0.02, 0.45, 1.9, 0.14);
  add('trim', inBasis(extr(shapeOf(offset(hatch, 0.05), [hatch]), 0.02), XY, V3(0, 0, 4.5)));
  add('metal', BB(0.25, 0.95, 4.52, 0.38, 1.0, 4.56));
  add('trim', BB(-0.3, 1.45, 4.5, 0.3, 1.47, 4.515));
  [-0.3, 0.3].forEach(x => add('metal', BB(x - 0.02, -1.0, 4.6, x + 0.02, -0.15, 4.64)));
  [-0.9, -0.62, -0.34].forEach(y => add('metal', BB(-0.3, y, 4.6, 0.3, y + 0.03, 4.64)));

  // ---------- gold chassis ----------
  const AXLES = [-3.1, -1.75, -0.4, 0.95, 2.3, 3.65], WR = 0.48, WY = -0.66, WX = 1.18;
  add('gold', BB(-0.95, -0.32, -3.7, 0.95, -0.17, 4.3));
  [1, -1].forEach(s => add('gold', BB(s > 0 ? 0.55 : -0.8, -0.46, -3.8, s > 0 ? 0.8 : -0.55, -0.32, 4.4)));
  add('gold', BB(-1.2, -0.32, -4.06, 1.2, -0.17, -3.88));
  add('gold', BB(-1.2, -0.32, 4.48, 1.2, -0.17, 4.7));
  AXLES.forEach(z => {
    add('gold', BB(-0.8, -0.45, z - 0.08, 0.8, -0.35, z + 0.08));
    [1, -1].forEach(s => {
      add('gold', BB(s > 0 ? 0.68 : -1.0, WY - 0.06, z - 0.07, s > 0 ? 1.0 : -0.68, WY + 0.06, z + 0.07));
      add('gold', BB(s * 0.76 - 0.05, WY + 0.06, z - 0.05, s * 0.76 + 0.05, -0.33, z + 0.05));
      add('metal', xf(new THREE.CylinderGeometry(0.035, 0.035, 0.3, 8), [s * 0.9, -0.48, z + 0.12], [0.5 * s, 0, 0.55 * s]));
    });
  });

  // ---------- merge + bake ----------
  const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  function bake(x, y, z, nx, ny, nz) {
    let a;
    const inside = Math.abs(x) < 1.215 && y > -0.01 && y < 2.4 && z > -3.83 && z < 4.43;
    if (inside) {
      a = 0.64 + 0.36 * sm(0, 1.6, y);
      if (y < 0.33) for (const s of seats) if (Math.abs(x - s.position.x) < 0.3 && Math.abs(z - s.position.z) < 0.28) { a *= 0.68; break; }
      if (Math.abs(x) > 1.08 && y < 0.25) a *= 0.85;
      if (z < -3.0 && y < 0.8) a *= 0.85;
    } else a = 0.7 + 0.3 * sm(-1.0, 2.4, y);
    a *= ny < -0.5 ? 0.62 : 0.93 + 0.07 * Math.max(0, ny);
    return a;
  }
  function merge(list, key) {
    let n = 0; const G = list.map(({ geo, tint }) => { const g = geo.index ? geo.toNonIndexed() : geo; if (!g.attributes.normal) g.computeVertexNormals(); n += g.attributes.position.count; return { g, tint }; });
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2), col = new Float32Array(n * 3);
    let o = 0;
    const doBake = !['glass', 'light', 'sign'].includes(key), ps = planarScale[key];
    for (const { g, tint } of G) {
      const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
      for (let i = 0; i < P.count; i++, o++) {
        const x = P.getX(i), y = P.getY(i), z = P.getZ(i), nx = N.getX(i), ny = N.getY(i), nz = N.getZ(i);
        pos.set([x, y, z], o * 3); nor.set([nx, ny, nz], o * 3);
        if (ps) {
          const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
          uv.set(ax >= ay && ax >= az ? [z * ps, y * ps] : ay >= az ? [x * ps, z * ps] : [x * ps, y * ps], o * 2);
        } else if (U) uv.set([U.getX(i), U.getY(i)], o * 2);
        const a = doBake ? bake(x, y, z, nx, ny, nz) : 1;
        col.set([tint[0] * a, tint[1] * a, tint[2] * a], o * 3);
      }
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    out.setAttribute('color', new THREE.BufferAttribute(col, 3));
    out.computeBoundingSphere();
    return out;
  }

  const group = new THREE.Group(); group.name = 'MarsBus_R10';
  const body = new THREE.Group(); body.name = 'body'; group.add(body);
  for (const key of Object.keys(parts)) {
    if (!parts[key].length) continue;
    const mesh = new THREE.Mesh(merge(parts[key], key), M[key]);
    mesh.name = 'bus_' + M[key].name;
    if (key === 'glass') mesh.renderOrder = 2;
    body.add(mesh);
  }

  // ---------- wheels (separate, rotate about local X) ----------
  const wheelParts = { tire: [], hub: [] };
  wheelParts.tire.push({ geo: new THREE.CylinderGeometry(WR, WR, 0.34, 36).rotateZ(Math.PI / 2), tint: [1, 1, 1] });
  for (let i = 0; i < 20; i++) {
    const a = i / 20 * Math.PI * 2, lug = new THREE.BoxGeometry(0.3, 0.035, 0.08);
    lug.rotateX(0.25 * (i % 2 ? 1 : -1)).translate(0, WR + 0.012, 0).rotateX(a);
    wheelParts.tire.push({ geo: lug, tint: [1, 1, 1] });
  }
  wheelParts.hub.push({ geo: new THREE.CylinderGeometry(0.27, 0.27, 0.355, 28).rotateZ(Math.PI / 2), tint: [0.95, 0.95, 0.95] });
  wheelParts.hub.push({ geo: new THREE.CylinderGeometry(0.1, 0.1, 0.39, 16).rotateZ(Math.PI / 2), tint: [0.8, 0.8, 0.8] });
  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; wheelParts.hub.push({ geo: new THREE.CylinderGeometry(0.018, 0.018, 0.37, 6).rotateZ(Math.PI / 2).translate(0, Math.cos(a) * 0.18, Math.sin(a) * 0.18), tint: [0.7, 0.7, 0.7] }); }
  const tireG = merge(wheelParts.tire, 'tire'), hubG = merge(wheelParts.hub, 'hub');
  const wheelG = new THREE.BufferGeometry();
  ['position', 'normal', 'uv', 'color'].forEach(k => {
    const a = tireG.attributes[k], b = hubG.attributes[k], arr = new Float32Array(a.array.length + b.array.length);
    arr.set(a.array); arr.set(b.array, a.array.length); wheelG.setAttribute(k, new THREE.BufferAttribute(arr, a.itemSize));
  });
  wheelG.addGroup(0, tireG.attributes.position.count, 0);
  wheelG.addGroup(tireG.attributes.position.count, hubG.attributes.position.count, 1);
  wheelG.computeBoundingSphere();
  const wheelsGroup = new THREE.Group(); wheelsGroup.name = 'wheels'; group.add(wheelsGroup);
  const wheels = [];
  AXLES.forEach((z, i) => [-1, 1].forEach(s => {
    const w = new THREE.Mesh(wheelG, [M.trim, M.metal]);
    w.name = `wheel_${s < 0 ? 'L' : 'R'}${i + 1}`; w.position.set(s * WX, WY, z);
    wheelsGroup.add(w); wheels.push(w);
  }));

  return { group, seats, wheels, wheelRadius: WR, groundY: WY - WR, dashFace }; // APP: dashFace
}
