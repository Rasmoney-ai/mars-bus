// The bus: a white pressurised cabin with big windows, ten seats, an
// instrument panel with "AUTOPILOT" and a map, on a gold chassis with many
// wheels (inspired by NASA's SEV rover, but no real logos).
//
// Bus-local coordinates: origin on the ground under the cabin centre,
// x = right, y = up, -z = forward. The cabin interior is merged into one
// geometry with baked lighting, so it costs a single draw call.

import * as THREE from 'three';
import { BUS, SEATS } from './config.js';
import { MeshBuilder, makeLight, compose, bakedMaterial, mergeParts } from './util/mesh.js';

// --- Seat layout (defined once, used everywhere) -----------------------------

export const LAYOUT = (() => {
  const pitch = SEATS.rowPitch;
  const length = BUS.frontSpace + (SEATS.rows - 1) * pitch + BUS.rearSpace;
  const front = -length / 2;
  const rear = length / 2;
  const firstRowZ = front + BUS.frontSpace;
  const seatX = SEATS.aisleWidth / 2 + SEATS.seatWidth / 2;
  return { pitch, length, front, rear, firstRowZ, seatX, halfWidth: BUS.interiorWidth / 2 };
})();

// Seat 1 and 2 are in front; odd seats on the left, even seats on the right.
export function seatInfo(seat) {
  const n = Math.min(Math.max(seat | 0, 1), SEATS.count);
  const row = Math.floor((n - 1) / 2);
  const side = (n - 1) % 2 === 0 ? -1 : 1;
  const x = side * LAYOUT.seatX;
  const z = LAYOUT.firstRowZ + row * LAYOUT.pitch;
  return { seat: n, row, side, x, z, color: SEATS.colors[n - 1] };
}

// Where the passenger's rig (the real floor under their head) goes.
export function seatOrigin(seat, out = new THREE.Vector3()) {
  const s = seatInfo(seat);
  return out.set(s.x, BUS.floorY, s.z + SEATS.headOffsetZ);
}

// Pose of the small personal screen in front of a seat (bus-local).
export function seatPanelMatrix(seat) {
  const s = seatInfo(seat);
  return compose(s.x, BUS.floorY + 0.68, s.z - 0.41, [-0.55, 0, 0]);
}

// Map screen tilt from horizontal (radians): it faces up and back at the front row.
const SCREEN_TILT = 0.85;

// Where the screens sit in the cabin (bus-local matrices, sizes in metres).
export function screenPlacements() {
  const F = BUS.floorY, H = BUS.interiorHeight;
  const { front } = LAYOUT;
  const tilt = SCREEN_TILT;
  const n = new THREE.Vector3(0, Math.cos(tilt), Math.sin(tilt));
  const dashCenter = new THREE.Vector3(0, F + BUS.windshieldBottom + 0.1, front + 0.3).addScaledVector(n, 0.031);
  const headerY = F + (BUS.windshieldTop + H) / 2;
  return {
    info: { matrix: compose(0, headerY, front + 0.006), width: 1.3, height: 0.3 },
    dash: { matrix: compose(dashCenter.x, dashCenter.y, dashCenter.z, [-(Math.PI / 2 - tilt), 0, 0]), width: 0.76, height: 0.38 },
    badges: [
      { matrix: compose(-0.9, headerY, front + 0.006), size: 0.28 },
      { matrix: compose(0.9, headerY, front + 0.006), size: 0.28 },
      { matrix: compose(0, BUS.floorY + 1.75, LAYOUT.rear - 0.03, [0, Math.PI, 0]), size: 0.34 },
    ],
  };
}

const COL = {
  panel: '#dedbd5',
  pillar: '#c3c7cb',
  trim: '#2e3237',
  floor: '#3b4149',
  aisle: '#e0772f',
  ceiling: '#ebe9e4',
  light: '#fff4dc',
  dash: '#2b3036',
  dashTop: '#353b42',
  fabric: '#3b4c63',
  frame: '#5a6068',
  rail: '#b8bec4',
  hull: '#f0eeea',
  gold: '#caa24a',
};

// Fills the corners of a window opening (x0..x1, y0..y1) so it gets round
// corners of radius r. The frame lies between z = zFace - depth and zFace.
function roundedCorners(b, x0, x1, y0, y1, r, zFace, depth) {
  const n = 8;
  const corners = [[x0, y0, -1, -1], [x1, y0, 1, -1], [x1, y1, 1, 1], [x0, y1, -1, 1]];
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  for (const [cx, cy, sx, sy] of corners) {
    const ox = cx - sx * r, oy = cy - sy * r;
    const arc = [];
    for (let k = 0; k <= n; k++) {
      const phi = (k / n) * Math.PI / 2;
      arc.push([ox + sx * r * Math.sin(phi), oy + sy * r * Math.cos(phi)]);
    }
    for (const [z, dir] of [[zFace, 1], [zFace - depth, -1]]) {
      for (let k = 0; k < n; k++) {
        const a = V(cx, cy, z), p = V(arc[k][0], arc[k][1], z), q = V(arc[k + 1][0], arc[k + 1][1], z);
        const nz = (p.x - a.x) * (q.y - a.y) - (p.y - a.y) * (q.x - a.x);
        if (nz * dir > 0) b.triangle(a, p, q, COL.panel);
        else b.triangle(a, q, p, COL.panel);
      }
    }
    // Dark rubber trim along the curve.
    for (let k = 0; k < n; k++) {
      const [px, py] = arc[k], [qx, qy] = arc[k + 1];
      const len = Math.hypot(qx - px, qy - py);
      b.box(len + 0.01, 0.035, depth + 0.02, (px + qx) / 2, (py + qy) / 2, zFace - depth / 2, COL.trim, [0, 0, Math.atan2(qy - py, qx - px)]);
    }
  }
}

function buildCabin() {
  const light = makeLight({ dir: new THREE.Vector3(0.3, 1, 0.45), diffuse: 0.32, sky: 0.82, ground: 0.52 });
  const b = new MeshBuilder(light);
  const F = BUS.floorY, H = BUS.interiorHeight, T = 0.08;
  const { front, rear, pitch, firstRowZ, halfWidth: hw } = LAYOUT;
  const W = BUS.interiorWidth;
  const L = rear - front;
  const zc = (front + rear) / 2;
  const sill = BUS.windowSill, top = BUS.windowTop;

  // Floor, aisle stripe, ceiling with two light strips.
  b.box(W + 2 * T, T, L + 2 * T, 0, F - T / 2, zc, COL.floor);
  b.box(0.1, 0.006, L - 0.2, 0, F + 0.003, zc, COL.aisle);
  b.box(W + 2 * T, T, L + 2 * T, 0, F + H + T / 2, zc, COL.ceiling);
  for (const s of [-1, 1]) b.box(0.14, 0.012, L - 0.6, s * 0.62, F + H - 0.006, zc, COL.light, null, false);

  // Side walls: solid below the sill and above the windows, pillars between.
  const rearPanelStart = firstRowZ + (SEATS.rows - 1) * pitch + pitch / 2 - 0.05;
  const pillars = [front + 0.07];
  for (let r = 0; r < SEATS.rows; r++) pillars.push(firstRowZ + r * pitch - pitch / 2);
  for (const s of [-1, 1]) {
    const x = s * (hw + T / 2);
    b.box(T, sill, L + 2 * T, x, F + sill / 2, zc, COL.panel);
    b.box(T, H - top, L + 2 * T, x, F + (top + H) / 2, zc, COL.panel);
    b.box(T + 0.03, top - sill, rear - rearPanelStart, x - s * 0.015, F + (sill + top) / 2, (rearPanelStart + rear) / 2, COL.panel);
    pillars.forEach((pz, i) => {
      const w = i === 0 ? 0.14 : 0.1;
      b.box(T + 0.04, top - sill, w, x - s * 0.02, F + (sill + top) / 2, pz, COL.pillar);
    });
    // Window ledge and top trim along the whole side.
    b.box(0.1, 0.035, rearPanelStart - front, s * (hw - 0.04), F + sill + 0.017, (front + rearPanelStart) / 2, COL.trim);
    b.box(0.05, 0.05, rearPanelStart - front, s * (hw - 0.02), F + top - 0.02, (front + rearPanelStart) / 2, COL.trim);
    // Exterior: white skirt and gold chassis rail.
    b.box(0.06, 0.35, L + 0.3, s * (hw + T + 0.03), F - 0.12, zc, COL.hull);
    b.box(0.28, 0.22, L + 0.5, s * (hw + 0.1), F - 0.4, zc, COL.gold);
  }

  // Front: panoramic windshield with two slim mullions and a header panel.
  const wsB = BUS.windshieldBottom, wsT = BUS.windshieldTop;
  b.box(W + 2 * T, H - wsT, T, 0, F + (wsT + H) / 2, front - T / 2, COL.panel);
  b.box(W + 2 * T, wsB, T, 0, F + wsB / 2, front - T / 2, COL.panel);
  // One centre post splits the panoramic window into two big windows with
  // round corners, like the bubble windows on the rover.
  b.box(0.08, wsT - wsB, T + 0.02, 0, F + (wsB + wsT) / 2, front - T / 2, COL.trim);
  roundedCorners(b, -hw, -0.04, F + wsB, F + wsT, 0.34, front, T);
  roundedCorners(b, 0.04, hw, F + wsB, F + wsT, 0.34, front, T);
  b.box(W, 0.05, 0.05, 0, F + wsT - 0.02, front + 0.02, COL.trim);
  // Dashboard: low body, sloping top, and small lit buttons.
  const dashD = 0.42;
  b.box(W, wsB - 0.03, dashD, 0, F + (wsB - 0.03) / 2, front + dashD / 2, COL.dash);
  b.box(W - 0.02, 0.04, dashD - 0.02, 0, F + wsB - 0.045, front + dashD / 2 + 0.01, COL.dashTop, [0.32, 0, 0]);
  // Housing for the map screen, tilted towards the front row.
  b.box(0.84, 0.44, 0.06, 0, F + wsB + 0.1, front + 0.3, COL.dashTop, [-(Math.PI / 2 - SCREEN_TILT), 0, 0]);
  const buttons = ['#4caf50', '#ffb300', '#29b6f6', '#e53935', '#ffb300', '#4caf50'];
  buttons.forEach((c, i) => {
    const x = (i < 3 ? -0.95 : 0.67) + (i % 3) * 0.14;
    b.box(0.07, 0.02, 0.05, x, F + wsB - 0.035, front + 0.24, c, [0.32, 0, 0], false);
  });
  // Slim stands in front of seats 1 and 2 (hold their personal screens).
  for (const s of [-1, 1]) {
    b.box(0.05, 0.62, 0.05, s * LAYOUT.seatX, F + 0.31, firstRowZ - 0.52, COL.frame);
    b.box(0.26, 0.03, 0.2, s * LAYOUT.seatX, F + 0.015, firstRowZ - 0.52, COL.frame);
  }

  // Rear wall with a small porthole.
  const pw = 0.42, py = 1.3;
  b.box(W + 2 * T, py - pw / 2, T, 0, F + (py - pw / 2) / 2, rear + T / 2, COL.panel);
  b.box(W + 2 * T, H - py - pw / 2, T, 0, F + (H + py + pw / 2) / 2, rear + T / 2, COL.panel);
  for (const s of [-1, 1]) b.box((W + 2 * T - pw) / 2, pw, T, s * (pw / 2 + (W + 2 * T - pw) / 4), F + py, rear + T / 2, COL.panel);
  b.box(0.95, 1.85, 0.02, 0, F + 0.95, rear - 0.01, COL.pillar);
  b.box(pw + 0.08, pw + 0.08, 0.03, 0, F + py, rear - 0.02, COL.trim);

  // Seats.
  for (let n = 1; n <= SEATS.count; n++) {
    const s = seatInfo(n);
    const sh = SEATS.seatHeight, sw = SEATS.seatWidth;
    b.box(0.26, sh - 0.1, 0.28, s.x, F + (sh - 0.1) / 2, s.z, COL.frame);
    b.box(sw, 0.1, 0.46, s.x, F + sh - 0.05, s.z, COL.fabric);
    const backZ = s.z + 0.27;
    const bh = SEATS.backHeight;
    b.box(sw, bh, 0.08, s.x, F + sh + bh / 2 - 0.02, backZ + 0.03, COL.fabric, [0.14, 0, 0]);
    b.box(sw * 0.94, 0.07, 0.1, s.x, F + sh + bh - 0.02, backZ + 0.07, s.color, [0.14, 0, 0]);
    // Armrest on the aisle side.
    b.box(0.05, 0.05, 0.36, s.x - s.side * (sw / 2 - 0.02), F + sh + 0.2, s.z + 0.02, COL.frame);
  }

  // Overhead handrails with supports: fixed structure in view.
  for (const s of [-1, 1]) {
    const x = s * 0.32;
    const z0 = firstRowZ - 0.2, z1 = rear - 0.3;
    b.box(0.035, 0.035, z1 - z0, x, F + 2.02, (z0 + z1) / 2, COL.rail);
    for (let z = z0 + 0.3; z < z1; z += 1.4) b.box(0.03, H - 2.02, 0.03, x, F + (2.02 + H) / 2, z, COL.rail);
  }

  // Exterior nose below the windshield, visible when looking down ahead.
  b.box(W + 0.2, 0.36, 0.75, 0, F + wsB - 0.26, front - T - 0.375, COL.hull);
  b.box(W + 0.24, 0.1, 0.8, 0, F + wsB - 0.47, front - T - 0.38, COL.gold);
  for (const s of [-1, 1]) b.box(0.3, 0.12, 0.04, s * 0.8, F + wsB - 0.26, front - T - 0.76, '#fff7d6', null, false);

  return b.build();
}

// Wheels: one instanced mesh, rotated from the distance driven.
function buildWheels() {
  const r = BUS.wheelRadius;
  const turn = compose(0, 0, 0, [0, 0, Math.PI / 2]);
  const geo = mergeParts([
    { geo: new THREE.CylinderGeometry(r, r, 0.3, 10), matrix: turn, color: '#3a3634' },
    { geo: new THREE.CylinderGeometry(r * 0.55, r * 0.55, 0.32, 8), matrix: turn, color: '#c9a24a' },
  ]);
  const axles = [];
  const n = 6;
  const span = LAYOUT.length - 0.6;
  for (let i = 0; i < n; i++) axles.push(-span / 2 + (i * span) / (n - 1));
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), n * 2);
  mesh.userData.axles = axles;
  mesh.frustumCulled = false;
  return mesh;
}

export class Bus {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'bus';
    this.cabin = new THREE.Mesh(buildCabin(), bakedMaterial());
    this.cabin.matrixAutoUpdate = false;
    this.group.add(this.cabin);

    this.wheels = buildWheels();
    this.group.add(this.wheels);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this._one = new THREE.Vector3(1, 1, 1);
    this._axis = new THREE.Vector3(1, 0, 0);
    this.setPose({ x: 0, y: 0, z: 0, heading: 0, s: 0 });
  }

  // Place the bus in the world. Only heading: the horizon stays level.
  setPose(pose) {
    this.group.position.set(pose.x, pose.y, pose.z);
    this.group.rotation.set(0, pose.heading, 0);
    const angle = -pose.s / BUS.wheelRadius;
    this._q.setFromAxisAngle(this._axis, angle);
    const axles = this.wheels.userData.axles;
    let i = 0;
    for (const z of axles) {
      for (const s of [-1, 1]) {
        this._v.set(s * (LAYOUT.halfWidth + 0.3), BUS.wheelRadius, z);
        this._m.compose(this._v, this._q, this._one);
        this.wheels.setMatrixAt(i++, this._m);
      }
    }
    this.wheels.instanceMatrix.needsUpdate = true;
  }
}
