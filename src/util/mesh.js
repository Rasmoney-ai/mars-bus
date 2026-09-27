// MeshBuilder merges many simple shapes into one geometry with baked,
// flat-shaded vertex colours. One geometry = one draw call, and no
// real-time lighting is needed (see "Ydelse" in CLAUDE.md).

import * as THREE from 'three';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _n = new THREE.Vector3();
const _e1 = new THREE.Vector3();
const _e2 = new THREE.Vector3();
const _col = new THREE.Color();

// A light rig used when baking colours.
// dir: direction towards the light. Colours are multiplied by
// ambient (blend of ground/sky by normal.y) + diffuse * max(0, n . dir).
export function makeLight({ dir, diffuse = 0.7, sky = 0.55, ground = 0.3 }) {
  return { dir: dir.clone().normalize(), diffuse, sky, ground };
}

export function shadeFactor(normal, light) {
  const hemi = light.ground + (light.sky - light.ground) * (normal.y * 0.5 + 0.5);
  return hemi + light.diffuse * Math.max(0, normal.dot(light.dir));
}

export class MeshBuilder {
  constructor(light = null) {
    this.light = light;
    this.positions = [];
    this.colors = [];
  }

  get triangleCount() {
    return this.positions.length / 9;
  }

  // Adds one triangle. `color` is a THREE.Color (linear) or hex/string.
  // With shade = false the colour is used as-is (for lights and screens).
  triangle(a, b, c, color, shade = true) {
    _e1.subVectors(b, a);
    _e2.subVectors(c, a);
    _n.crossVectors(_e1, _e2);
    const len = _n.length();
    if (len < 1e-12) return;
    _n.multiplyScalar(1 / len);
    _col.set(color);
    if (shade && this.light) _col.multiplyScalar(shadeFactor(_n, this.light));
    this.positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    for (let i = 0; i < 3; i++) this.colors.push(_col.r, _col.g, _col.b);
  }

  quad(a, b, c, d, color, shade = true) {
    this.triangle(a, b, c, color, shade);
    this.triangle(a, c, d, color, shade);
  }

  // Adds a three.js geometry, transformed by `matrix`.
  // `color` can be a colour or a function (centroid, normal) -> colour.
  geometry(geo, matrix, color, shade = true) {
    const pos = geo.attributes.position;
    const index = geo.index;
    const count = index ? index.count : pos.count;
    const flip = matrix && matrix.determinant() < 0;
    for (let i = 0; i < count; i += 3) {
      const ia = index ? index.getX(i) : i;
      const ib = index ? index.getX(i + 1) : i + 1;
      const ic = index ? index.getX(i + 2) : i + 2;
      _a.fromBufferAttribute(pos, ia);
      _b.fromBufferAttribute(pos, ib);
      _c.fromBufferAttribute(pos, ic);
      if (matrix) {
        _a.applyMatrix4(matrix);
        _b.applyMatrix4(matrix);
        _c.applyMatrix4(matrix);
      }
      let col = color;
      if (typeof color === 'function') {
        _e1.subVectors(_b, _a);
        _e2.subVectors(_c, _a);
        const n = new THREE.Vector3().crossVectors(_e1, _e2).normalize();
        const centroid = new THREE.Vector3().add(_a).add(_b).add(_c).multiplyScalar(1 / 3);
        col = color(centroid, n);
      }
      if (flip) this.triangle(_a, _c, _b, col, shade);
      else this.triangle(_a, _b, _c, col, shade);
    }
  }

  // Convenience: a box of size (w, h, d) centred at (x, y, z), rotated by
  // euler angles (radians) if given.
  box(w, h, d, x, y, z, color, rot = null, shade = true) {
    const geo = new THREE.BoxGeometry(w, h, d);
    this.geometry(geo, compose(x, y, z, rot), color, shade);
    geo.dispose();
  }

  build() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    return geo;
  }
}

const _q = new THREE.Quaternion();
const _eu = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);

// Matrix from position, optional euler rotation [x, y, z] and scale [x, y, z].
export function compose(x, y, z, rot = null, scale = null) {
  _p.set(x, y, z);
  if (rot) _q.setFromEuler(_eu.set(rot[0], rot[1], rot[2]));
  else _q.identity();
  if (scale) _s.set(scale[0], scale[1], scale[2]);
  else _s.set(1, 1, 1);
  return new THREE.Matrix4().compose(_p, _q, _s);
}

export function bakedMaterial(options = {}) {
  return new THREE.MeshBasicMaterial({ vertexColors: true, ...options });
}

// Merges primitives into one non-indexed geometry with normals and vertex
// colours, for moving objects that use a lit material (passengers, gloves).
// parts: [{ geo, matrix, color }]
export function mergeParts(parts) {
  const pos = [], nor = [], col = [];
  const v = new THREE.Vector3(), n = new THREE.Vector3(), c = new THREE.Color();
  const nm = new THREE.Matrix3();
  for (const part of parts) {
    const geo = part.geo.index ? part.geo.toNonIndexed() : part.geo;
    if (!geo.attributes.normal) geo.computeVertexNormals();
    const m = part.matrix || new THREE.Matrix4();
    nm.getNormalMatrix(m);
    const flip = m.determinant() < 0;
    const p = geo.attributes.position, q = geo.attributes.normal;
    c.set(part.color ?? '#ffffff');
    for (let i = 0; i < p.count; i += 3) {
      const order = flip ? [0, 2, 1] : [0, 1, 2];
      for (const k of order) {
        v.fromBufferAttribute(p, i + k).applyMatrix4(m);
        n.fromBufferAttribute(q, i + k).applyMatrix3(nm).normalize();
        pos.push(v.x, v.y, v.z);
        nor.push(n.x, n.y, n.z);
        col.push(c.r, c.g, c.b);
      }
    }
    if (geo !== part.geo) geo.dispose();
    part.geo.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}
