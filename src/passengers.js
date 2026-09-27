// Draws the other passengers from a plain data list: helmet with visor and
// two gloves per passenger (models from Claude Design, see suit.js).
// The list comes from the simulation now (simulated.js) and from the
// network later. Rendering never decides anything itself.
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
import { helmetParts, bakedGlove } from './suit.js';

const MAX = SEATS.count;

// --- Renderer ------------------------------------------------------------------

// Passengers further away than this (metres from your seat) are drawn with
// less detail; you cannot see the difference at that distance.
const FAR = 2.0;
const DETAIL = { near: 0.5, far: 0.3 };

// One set of instanced meshes (helmet parts and gloves) at a detail level.
function makeSet(detail, materials) {
  const helmet = helmetParts(detail);
  const set = {
    body: new THREE.InstancedMesh(helmet.body, materials.plain, MAX),
    visor: new THREE.InstancedMesh(helmet.visor, new THREE.MeshBasicMaterial({ map: helmet.visorMap }), MAX),
    stripes: new THREE.InstancedMesh(helmet.stripe, materials.tinted, MAX),
    signMaterial: new THREE.MeshBasicMaterial({ map: helmet.signMap, toneMapped: false }),
    gloves: {},
    n: 0,
    counts: { rest: { '-1': 0, 1: 0 }, point: { '-1': 0, 1: 0 } },
  };
  for (let i = 0; i < MAX; i++) set.stripes.setColorAt(i, new THREE.Color('#ffffff'));
  // Seat number decals: one small mesh per seat number.
  set.signs = helmet.signs.map((geo) => {
    const m = new THREE.Mesh(geo, set.signMaterial);
    m.matrixAutoUpdate = false;
    m.visible = false;
    m.frustumCulled = false;
    return m;
  });
  for (const pose of ['rest', 'point']) {
    for (const side of [-1, 1]) set.gloves[pose + side] = new THREE.InstancedMesh(bakedGlove(side, pose, detail), materials.plain, MAX);
  }
  set.meshes = [set.body, set.visor, set.stripes, ...Object.values(set.gloves)];
  for (const m of set.meshes) {
    m.count = 0;
    m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }
  return set;
}

export class PassengerView {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'passengers';
    const materials = {
      plain: new THREE.MeshLambertMaterial({ vertexColors: true }),
      tinted: new THREE.MeshLambertMaterial({ color: '#ffffff' }),
    };
    this.sets = { near: makeSet(DETAIL.near, materials), far: makeSet(DETAIL.far, materials) };
    for (const set of Object.values(this.sets)) this.group.add(...set.meshes, ...set.signs);
    this.seatColors = SEATS.colors.map((c) => new THREE.Color(c));
    this._origin = new THREE.Vector3();
    this._own = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3(1, 1, 1);
    this._m = new THREE.Matrix4();
  }

  // passengers: array of passenger data (see top of file).
  // ownSeat: this user's seat, never drawn.
  update(passengers, ownSeat) {
    for (const set of Object.values(this.sets)) {
      set.n = 0;
      set.counts.rest[-1] = set.counts.rest[1] = set.counts.point[-1] = set.counts.point[1] = 0;
      for (const sign of set.signs) sign.visible = false;
    }
    seatOrigin(ownSeat, this._own);
    for (const p of passengers) {
      if (!p || p.seat === ownSeat || p.seat < 1 || p.seat > MAX) continue;
      seatOrigin(p.seat, this._origin);
      const set = this._origin.distanceTo(this._own) > FAR ? this.sets.far : this.sets.near;
      const head = p.head;
      if (head) {
        const n = set.n++;
        this._place(head.position, head.quaternion);
        set.body.setMatrixAt(n, this._m);
        set.visor.setMatrixAt(n, this._m);
        set.stripes.setMatrixAt(n, this._m);
        set.stripes.setColorAt(n, this.seatColors[p.seat - 1]);
        const sign = set.signs[p.seat - 1];
        sign.matrix.copy(this._m);
        sign.visible = true;
      }
      const hands = p.hands || [];
      for (let i = 0; i < 2; i++) {
        const h = hands[i];
        if (!h) continue;
        const side = i === 0 ? -1 : 1;
        const pose = h.pose === 'point' ? 'point' : 'rest';
        const k = set.counts[pose][side]++;
        this._place(h.position, h.quaternion);
        set.gloves[pose + side].setMatrixAt(k, this._m);
      }
    }
    for (const set of Object.values(this.sets)) {
      set.body.count = set.visor.count = set.stripes.count = set.n;
      for (const pose of ['rest', 'point']) {
        for (const side of [-1, 1]) set.gloves[pose + side].count = set.counts[pose][side];
      }
      for (const m of set.meshes) {
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
      }
    }
  }

  _place(position, quaternion) {
    this._p.set(position[0], position[1], position[2]).add(this._origin);
    this._q.set(quaternion[0], quaternion[1], quaternion[2], quaternion[3]);
    this._m.compose(this._p, this._q, this._s);
  }
}
