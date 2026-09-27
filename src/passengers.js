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

export class PassengerView {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'passengers';
    const helmet = helmetParts();
    const plain = new THREE.MeshLambertMaterial({ vertexColors: true });
    const tinted = new THREE.MeshLambertMaterial({ color: '#ffffff' });
    const visor = new THREE.MeshBasicMaterial({ map: helmet.visorMap });
    this.signMaterial = new THREE.MeshBasicMaterial({ map: helmet.signMap, toneMapped: false });

    // Helmet: body, visor and neck stripe (seat colour) for all passengers.
    this.body = new THREE.InstancedMesh(helmet.body, plain, MAX);
    this.visor = new THREE.InstancedMesh(helmet.visor, visor, MAX);
    this.stripes = new THREE.InstancedMesh(helmet.stripe, tinted, MAX);
    for (let i = 0; i < MAX; i++) this.stripes.setColorAt(i, new THREE.Color('#ffffff'));
    // Seat number decals: one small mesh per seat number.
    this.signs = helmet.signs.map((geo) => {
      const m = new THREE.Mesh(geo, this.signMaterial);
      m.matrixAutoUpdate = false;
      m.visible = false;
      m.frustumCulled = false;
      this.group.add(m);
      return m;
    });
    // Gloves in two still poses per hand.
    this.gloves = {};
    for (const pose of ['rest', 'point']) {
      for (const side of [-1, 1]) this.gloves[pose + side] = new THREE.InstancedMesh(bakedGlove(side, pose), plain, MAX);
    }
    this.meshes = [this.body, this.visor, this.stripes, ...Object.values(this.gloves)];
    for (const m of this.meshes) {
      m.count = 0;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(m);
    }
    this.seatColors = SEATS.colors.map((c) => new THREE.Color(c));
    this._origin = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3(1, 1, 1);
    this._m = new THREE.Matrix4();
    this._counts = { rest: { '-1': 0, 1: 0 }, point: { '-1': 0, 1: 0 } };
  }

  // passengers: array of passenger data (see top of file).
  // ownSeat: this user's seat, never drawn.
  update(passengers, ownSeat) {
    const counts = this._counts;
    counts.rest[-1] = counts.rest[1] = counts.point[-1] = counts.point[1] = 0;
    for (const sign of this.signs) sign.visible = false;
    let n = 0;
    for (const p of passengers) {
      if (!p || p.seat === ownSeat || p.seat < 1 || p.seat > MAX) continue;
      seatOrigin(p.seat, this._origin);
      const head = p.head;
      if (head) {
        this._place(head.position, head.quaternion);
        this.body.setMatrixAt(n, this._m);
        this.visor.setMatrixAt(n, this._m);
        this.stripes.setMatrixAt(n, this._m);
        this.stripes.setColorAt(n, this.seatColors[p.seat - 1]);
        const sign = this.signs[p.seat - 1];
        sign.matrix.copy(this._m);
        sign.visible = true;
        n++;
      }
      const hands = p.hands || [];
      for (let i = 0; i < 2; i++) {
        const h = hands[i];
        if (!h) continue;
        const side = i === 0 ? -1 : 1;
        const pose = h.pose === 'point' ? 'point' : 'rest';
        const k = counts[pose][side]++;
        this._place(h.position, h.quaternion);
        this.gloves[pose + side].setMatrixAt(k, this._m);
      }
    }
    this.body.count = this.visor.count = this.stripes.count = n;
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
