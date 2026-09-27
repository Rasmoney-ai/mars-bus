// Prepares the Claude Design helmet and gloves (src/suitGear.js) for the
// ride, so they stay light on the Quest:
// - helmet split into a few parts that can be drawn instanced for all
//   passengers (the neck stripe gets the seat colour),
// - gloves for the other passengers baked into still poses (rest, point),
// - live gloves for your own hands with simpler, fast materials.

import * as THREE from 'three';
import { buildHelmet, buildGlove, JOINTS } from './suitGear.js';

// Copy the vertices of one geometry group into a new geometry.
function groupGeometry(geo, group) {
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const a = geo.attributes[name];
    if (!a) continue;
    const s = a.itemSize;
    out.setAttribute(name, new THREE.BufferAttribute(a.array.slice(group.start * s, (group.start + group.count) * s), s));
  }
  return out;
}

// Merge geometries into one with a colour attribute per part.
function colourMerge(parts) {
  let n = 0;
  for (const p of parts) n += p.geo.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  for (const { geo, color } of parts) {
    const c = new THREE.Color(color);
    const count = geo.attributes.position.count;
    pos.set(geo.attributes.position.array, o * 3);
    nor.set(geo.attributes.normal.array, o * 3);
    for (let i = 0; i < count; i++) col.set([c.r, c.g, c.b], (o + i) * 3);
    o += count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}

const HELMET_ORDER = ['shell', 'visor', 'rubber', 'stripe', 'metal', 'light', 'sign'];

// Helmet parts: body (one colour-per-part mesh), visor, neck stripe, and
// the decals (badge and seat number) for each seat number.
export function helmetParts(detail = 0.5) {
  const byName = (mesh) => {
    const out = {};
    for (const g of mesh.geometry.groups) out[HELMET_ORDER[g.materialIndex]] = groupGeometry(mesh.geometry, g);
    return out;
  };
  const first = buildHelmet(THREE, { number: 1, stripe: '#ffffff', detail });
  const p = byName(first.mesh);
  const mats = first.mesh.material;
  const body = colourMerge([
    { geo: p.shell, color: mats[0].color },
    { geo: p.rubber, color: mats[2].color },
    { geo: p.metal, color: mats[4].color },
    { geo: p.light, color: '#fff4dd' },
  ]);
  const signs = [];
  for (let n = 1; n <= 10; n++) signs.push(n === 1 ? p.sign : byName(buildHelmet(THREE, { number: n, stripe: '#ffffff', detail }).mesh).sign);
  return {
    body,
    visor: p.visor,
    stripe: p.stripe,
    signs,
    visorMap: mats[1].map,
    signMap: mats[6].map,
  };
}

// Finger poses (radians per joint), from the Claude Design demo page.
const F = (a, b, c) => [a, b, c];
const POSES = {
  rest: { thumb: [0.2, 0.3, 0, 0.15], 'index-finger': F(0.4, 0.5, 0.3), 'middle-finger': F(0.45, 0.55, 0.3), 'ring-finger': F(0.5, 0.6, 0.3), 'pinky-finger': F(0.55, 0.6, 0.3) },
  point: { thumb: [0.5, 0.7, 0, 0.45], 'index-finger': F(0.05, 0.05, 0.05), 'middle-finger': F(1.5, 1.6, 0.9), 'ring-finger': F(1.5, 1.6, 0.9), 'pinky-finger': F(1.5, 1.6, 0.9) },
};

// A glove in a still pose, as plain geometry with part colours.
// side: -1 left, +1 right. Wrist at the origin, fingers along -Z, palm down.
export function bakedGlove(side, pose, detail = 0.5) {
  const glove = buildGlove(THREE, side < 0 ? 'left' : 'right', { detail });
  glove.setCurl(POSES[pose] || POSES.rest);
  glove.group.updateMatrixWorld(true);
  const mesh = glove.mesh;
  mesh.skeleton.update();
  const geo = mesh.geometry;
  const pos = geo.attributes.position, nor = geo.attributes.normal, skin = geo.attributes.skinIndex;
  const out = { position: new Float32Array(pos.count * 3), normal: new Float32Array(pos.count * 3), color: new Float32Array(pos.count * 3) };
  const v = new THREE.Vector3(), n = new THREE.Vector3(), m = new THREE.Matrix4(), nm = new THREE.Matrix3(), c = new THREE.Color();
  const colours = mesh.material.map((mat) => mat.color.clone());
  colours[4] = colours[0]; // the small badge on the back of the hand: fabric colour
  const groupOf = new Uint8Array(pos.count);
  for (const g of geo.groups) groupOf.fill(g.materialIndex, g.start, g.start + g.count);
  for (let i = 0; i < pos.count; i++) {
    const b = skin.getX(i);
    m.multiplyMatrices(mesh.skeleton.bones[b].matrixWorld, mesh.skeleton.boneInverses[b]);
    v.fromBufferAttribute(pos, i).applyMatrix4(m);
    n.fromBufferAttribute(nor, i).applyMatrix3(nm.getNormalMatrix(m)).normalize();
    out.position.set([v.x, v.y, v.z], i * 3);
    out.normal.set([n.x, n.y, n.z], i * 3);
    c.copy(colours[groupOf[i]]);
    out.color.set([c.r, c.g, c.b], i * 3);
  }
  const result = new THREE.BufferGeometry();
  for (const k of Object.keys(out)) result.setAttribute(k, new THREE.BufferAttribute(out[k], 3));
  result.computeBoundingSphere();
  return result;
}

// A live glove for your own hand (full detail), with fast materials.
export function liveGlove(handedness) {
  const glove = buildGlove(THREE, handedness);
  glove.mesh.material = glove.mesh.material.map((mat) => (mat.isMeshStandardMaterial
    ? new THREE.MeshLambertMaterial({ name: mat.name, color: mat.color, map: mat.map })
    : mat));
  return glove;
}

export { JOINTS };
