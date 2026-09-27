// Draws the other passengers from a plain data list: helmet with visor and
// two gloves per passenger. The list comes from the simulation now
// (simulated.js) and from the network later. Rendering never decides
// anything itself.
//
// Passenger data (all poses in *seat space*: origin on the floor under the
// passenger's head, -z forward, the same as that passenger's XR space):
// {
//   seat: 1..10,
//   head: { position: [x, y, z], quaternion: [x, y, z, w] },
//   hands: [left, right]  // each { position, quaternion, pose: 'rest' | 'point' } or null
// }

import * as THREE from 'three';
import { SEATS } from './config.js';
import { seatOrigin } from './bus.js';
import { compose, mergeParts } from './util/mesh.js';

const MAX = SEATS.count;

// --- Geometry ------------------------------------------------------------------

// Head space: origin between the eyes, -z forward.
function helmetShellGeometry() {
  return mergeParts([
    { geo: new THREE.SphereGeometry(0.155, 14, 10), matrix: compose(0, 0.03, 0.045, null, [1, 1.02, 1.05]), color: '#ffffff' },
  ]);
}

function helmetDetailGeometry() {
  // Visor: the front part of a slightly larger sphere, dark gold.
  const visor = new THREE.SphereGeometry(0.162, 14, 8, Math.PI * 1.5 - 1.05, 2.1, 1.05, 1.1);
  const pos = visor.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const top = new THREE.Color('#a8864a'), bottom = new THREE.Color('#1c1712'), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 0.162;
    c.copy(bottom).lerp(top, Math.min(Math.max((y + 0.2) / 0.9, 0), 1) ** 1.5);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  const parts = [
    { geo: new THREE.CylinderGeometry(0.115, 0.125, 0.05, 14), matrix: compose(0, -0.125, 0.05), color: '#8f959b' },
    { geo: new THREE.BoxGeometry(0.035, 0.04, 0.06), matrix: compose(0.155, 0.07, 0.02), color: '#d7dade' },
    { geo: new THREE.BoxGeometry(0.035, 0.04, 0.06), matrix: compose(-0.155, 0.07, 0.02), color: '#d7dade' },
  ];
  const merged = mergeParts(parts);
  // Append the visor with its gradient colours.
  const v = visor.toNonIndexed();
  const vc = new Float32Array(v.attributes.position.count * 3);
  const src = visor.index;
  for (let i = 0; i < src.count; i++) vc.set(colors.subarray(src.getX(i) * 3, src.getX(i) * 3 + 3), i * 3);
  v.setAttribute('color', new THREE.BufferAttribute(vc, 3));
  v.translate(0, 0.03, 0.045);
  return concat(merged, v);
}

function concat(a, b) {
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'color']) {
    const x = a.attributes[name].array, y = b.attributes[name].array;
    const arr = new Float32Array(x.length + y.length);
    arr.set(x); arr.set(y, x.length);
    out.setAttribute(name, new THREE.BufferAttribute(arr, 3));
  }
  out.computeBoundingSphere();
  return out;
}

// Glove space: origin at the wrist, -z along the fingers, +y = back of hand.
// side = -1 for left, +1 for right. pose = 'rest' or 'point'.
export function gloveGeometry(side, pose) {
  const s = side;
  const white = '#ffffff';
  const parts = [
    { geo: new THREE.CylinderGeometry(0.045, 0.05, 0.08, 10), matrix: compose(0, 0, 0.045, [Math.PI / 2, 0, 0]), color: '#cfd3d8' },
    { geo: new THREE.BoxGeometry(0.088, 0.034, 0.095), matrix: compose(0, 0, -0.045), color: white },
    // Thumb along the side.
    { geo: new THREE.BoxGeometry(0.024, 0.024, 0.06), matrix: compose(-s * 0.05, -0.008, -0.05, [0, -s * 0.5, 0]), color: white },
  ];
  const xs = [-s * 0.031, -s * 0.0105, s * 0.0105, s * 0.031];
  xs.forEach((x, i) => {
    const straight = pose === 'point' && i === 0;
    const len = straight ? 0.085 : (pose === 'point' ? 0.045 : 0.07);
    const bend = straight ? 0 : (pose === 'point' ? 1.35 : 0.45);
    // Rotate about the knuckle so the finger curls down (towards the palm).
    const knuckle = new THREE.Matrix4().makeTranslation(x, 0, -0.092);
    const rot = new THREE.Matrix4().makeRotationX(-bend);
    const offset = new THREE.Matrix4().makeTranslation(0, 0, -len / 2);
    const m = knuckle.multiply(rot).multiply(offset);
    parts.push({ geo: new THREE.BoxGeometry(0.019, 0.02, len), matrix: m, color: white });
  });
  return mergeParts(parts);
}

// --- Renderer ------------------------------------------------------------------

export class PassengerView {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'passengers';
    // Two materials: one tinted per seat (instance colours), one plain.
    const tinted = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const plain = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

    this.shells = new THREE.InstancedMesh(helmetShellGeometry(), tinted, MAX);
    this.details = new THREE.InstancedMesh(helmetDetailGeometry(), plain, MAX);
    this.gloves = {};
    for (const pose of ['rest', 'point']) {
      for (const side of [-1, 1]) {
        const mesh = new THREE.InstancedMesh(gloveGeometry(side, pose), tinted, MAX);
        this.gloves[pose + side] = mesh;
      }
    }
    // Create the colour buffers up front, so no shader recompiles mid-ride.
    for (const m of [this.shells, ...Object.values(this.gloves)]) {
      for (let i = 0; i < MAX; i++) m.setColorAt(i, new THREE.Color('#ffffff'));
    }
    this.meshes = [this.shells, this.details, ...Object.values(this.gloves)];
    for (const m of this.meshes) {
      m.count = 0;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(m);
    }
    // Per-seat colours: helmet in the seat colour, gloves a lighter shade.
    this.seatColors = SEATS.colors.map((c) => new THREE.Color(c));
    this.gloveColors = SEATS.colors.map((c) => new THREE.Color(c).lerp(new THREE.Color('#f2f2f2'), 0.85));
    this._origin = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3(1, 1, 1);
    this._m = new THREE.Matrix4();
    this._white = new THREE.Color('#ffffff');
  }

  // passengers: array of passenger data (see top of file).
  // ownSeat: this user's seat, never drawn.
  update(passengers, ownSeat) {
    const counts = { shells: 0, rest: {}, point: {} };
    counts.rest[-1] = counts.rest[1] = counts.point[-1] = counts.point[1] = 0;
    let n = 0;
    for (const p of passengers) {
      if (!p || p.seat === ownSeat || p.seat < 1 || p.seat > MAX) continue;
      seatOrigin(p.seat, this._origin);
      const head = p.head;
      if (head) {
        this._place(head.position, head.quaternion);
        this.shells.setMatrixAt(n, this._m);
        this.details.setMatrixAt(n, this._m);
        this.shells.setColorAt(n, this.seatColors[p.seat - 1]);
        n++;
      }
      const hands = p.hands || [];
      for (let i = 0; i < 2; i++) {
        const h = hands[i];
        if (!h) continue;
        const side = i === 0 ? -1 : 1;
        const pose = h.pose === 'point' ? 'point' : 'rest';
        const mesh = this.gloves[pose + side];
        const k = counts[pose][side]++;
        this._place(h.position, h.quaternion);
        mesh.setMatrixAt(k, this._m);
        mesh.setColorAt(k, this.gloveColors[p.seat - 1]);
      }
    }
    this.shells.count = n;
    this.details.count = n;
    for (const pose of ['rest', 'point']) {
      for (const side of [-1, 1]) this.gloves[pose + side].count = counts[pose][side];
    }
    for (const m of this.meshes) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  _place(position, quaternion) {
    this._p.set(position[0], position[1], position[2]).add(this._origin);
    this._q.set(quaternion[0], quaternion[1], quaternion[2], quaternion[3]);
    this._m.compose(this._p, this._q, this._s);
  }
}
