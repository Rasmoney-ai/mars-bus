// The bus: the "Mars-sightseeing-bus R-10" model made with Claude Design
// (src/marsBus.js), plus what the app adds to it: live screens, stands for
// the personal screens in the front row, fast materials and instanced wheels.
//
// Bus-local coordinates: origin on the ground under the cabin, x = right,
// y = up, -z = forward. The model's cabin floor sits at y = BUS floor height.
// Seat positions come from the model, so they are defined in one place.

import * as THREE from 'three';
import { BUS, SEATS } from './config.js';
import { buildMarsBus } from './marsBus.js';
import { compose } from './util/mesh.js';

let model = null;

// The model is built once, the first time anything needs it.
function getModel() {
  if (!model) model = buildMarsBus(THREE, { seatBackScale: BUS.seatBackScale, liveScreens: true });
  return model;
}

function floorY() {
  return -getModel().groundY;
}

// Seat 1 and 2 are in front; odd seats on the left, even seats on the right.
export function seatInfo(seat) {
  const n = Math.min(Math.max(seat | 0, 1), SEATS.count);
  const s = getModel().seats[n - 1];
  return {
    seat: n,
    row: s.row - 1,
    side: s.position.x < 0 ? -1 : 1,
    x: s.position.x,
    z: s.position.z,
    color: SEATS.colors[n - 1],
  };
}

// Where the passenger's rig (the real floor under their head) goes.
export function seatOrigin(seat, out = new THREE.Vector3()) {
  const s = seatInfo(seat);
  return out.set(s.x, floorY(), s.z + SEATS.headOffsetZ);
}

// The small personal screen in front of a seat (bus-local): on the back of
// the seat in front, or on a stand for the front row.
const PANEL = { y: 0.6, back: 0.525, tilt: -0.3 };
export function seatPanelMatrix(seat) {
  const s = seatInfo(seat);
  return compose(s.x, floorY() + PANEL.y, s.z - PANEL.back, [PANEL.tilt, 0, 0]);
}

// Where the screens sit in the cabin (bus-local matrices, sizes in metres).
export function screenPlacements() {
  const m = getModel();
  const lift = new THREE.Matrix4().makeTranslation(0, floorY(), 0);
  const dash = lift.clone().multiply(m.dashPod).multiply(new THREE.Matrix4().makeTranslation(0, 0.01, 0.027));
  return {
    info: { matrix: compose(0, floorY() + INFO.y, INFO.z), width: INFO.w, height: INFO.h },
    dash: { matrix: dash, width: 0.72, height: 0.36 },
    badges: [], // the model has its own mission badges
  };
}

// Info screen hanging from the ceiling just behind the front windows.
const INFO = { y: 2.1, z: -3.02, w: 0.84, h: 0.2 };

// Things the app adds to the cabin: the info screen housing and stands for
// the front row's personal screens.
function buildExtras() {
  const F = floorY();
  const dark = new THREE.MeshBasicMaterial({ color: '#2b2f34' });
  const metal = new THREE.MeshBasicMaterial({ color: '#9ea3a8' });
  const group = new THREE.Group();
  group.name = 'bus-extras';
  const box = (w, h, d, x, y, z, mat, rot = null) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.matrix.copy(compose(x, y, z, rot));
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  };
  box(INFO.w + 0.06, INFO.h + 0.06, 0.04, 0, F + INFO.y, INFO.z - 0.022, dark);
  for (const x of [-0.3, 0.3]) box(0.02, 0.2, 0.02, x, F + INFO.y + INFO.h / 2 + 0.1, INFO.z - 0.022, metal);
  for (const seat of [1, 2]) {
    const s = seatInfo(seat);
    const z = s.z - PANEL.back - 0.02;
    box(0.04, PANEL.y - 0.06, 0.04, s.x, F + (PANEL.y - 0.06) / 2, z, metal);
    box(0.24, 0.02, 0.2, s.x, F + 0.01, z, metal);
    box(0.36, 0.19, 0.02, s.x, F + PANEL.y, z - 0.003, dark, [PANEL.tilt, 0, 0]);
  }
  return group;
}

// Light is baked into the model's vertex colours, so the cheapest material
// type looks the same and leaves headroom on the Quest.
function toBasic(material, cache) {
  if (!material.isMeshStandardMaterial) return material;
  if (!cache.has(material)) {
    cache.set(material, new THREE.MeshBasicMaterial({
      name: material.name,
      color: material.color,
      map: material.map,
      vertexColors: material.vertexColors,
      transparent: material.transparent,
      opacity: material.opacity,
      depthWrite: material.depthWrite,
      side: material.side,
    }));
  }
  return cache.get(material);
}

export class Bus {
  constructor() {
    const m = getModel();
    this.group = new THREE.Group();
    this.group.name = 'bus';

    const cache = new Map();
    m.group.traverse((o) => {
      if (!o.isMesh) return;
      o.material = Array.isArray(o.material) ? o.material.map((x) => toBasic(x, cache)) : toBasic(o.material, cache);
    });

    // 12 wheels as one instanced mesh (2 draw calls instead of 24).
    const wheelMeshes = m.wheels;
    const wheelGroup = m.group.getObjectByName('wheels');
    this.wheels = new THREE.InstancedMesh(wheelMeshes[0].geometry, wheelMeshes[0].material, wheelMeshes.length);
    this.wheels.frustumCulled = false;
    this.wheelPositions = wheelMeshes.map((w) => w.position.clone());
    this.wheelRadius = m.wheelRadius;
    m.group.remove(wheelGroup);

    m.group.position.y = floorY();
    this.model = m.group;
    this.model.add(this.wheels);
    this.group.add(this.model, buildExtras());

    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._one = new THREE.Vector3(1, 1, 1);
    this._axis = new THREE.Vector3(1, 0, 0);
    this.setPose({ x: 0, y: 0, z: 0, heading: 0, s: 0 });
  }

  // Place the bus in the world. Only heading: the horizon stays level.
  setPose(pose) {
    this.group.position.set(pose.x, pose.y, pose.z);
    this.group.rotation.set(0, pose.heading, 0);
    this._q.setFromAxisAngle(this._axis, -pose.s / this.wheelRadius);
    this.wheelPositions.forEach((p, i) => {
      this._m.compose(p, this._q, this._one);
      this.wheels.setMatrixAt(i, this._m);
    });
    this.wheels.instanceMatrix.needsUpdate = true;
  }
}
