// Landmarks along the route: the lander at the start (lander.js), a group of buttes
// with the rover Curiosity (curiosity.js),
// the base at the end and small numbered signs at the stops.
// All low-poly, built in code, with baked lighting (see terrain.js).

import * as THREE from 'three';
import { WORLD } from './config.js';
import { hash2, valueNoise } from './util/noise.js';
import { MeshBuilder, compose, bakedMaterial } from './util/mesh.js';
import { worldLight, headingVectors, sunDirection } from './terrain.js';
import { buildLander } from './lander.js';
import { buildMarsBaseSite } from './marsBaseSite.js';
import { buildCuriosity } from './curiosity.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// A butte like the Murray Buttes in Gale crater (Curiosity drove between
// them): a broad cone of scree reaching about two thirds up, with thin rock
// ledges sticking out of it, and a narrower, jagged, stepped crag of layered
// rock on top. Greyish tan-brown; the dark comes from shadows under the
// ledges (baked from the face direction). Flat slabs lie on the slopes.
const BUTTE_PROFILE = [
  // [radius factor, height factor, part]
  [2.3, 0, 'talus'], [2.02, 0.08, 'talus'], [1.74, 0.17, 'talus'], [1.5, 0.26, 'talus'],
  [1.56, 0.275, 'ledge'], [1.43, 0.3, 'talus'], [1.22, 0.38, 'talus'],
  [1.27, 0.395, 'ledge'], [1.14, 0.42, 'talus'], [0.96, 0.5, 'talus'], [0.8, 0.58, 'talus'],
  [0.76, 0.62, 'crag'], [0.8, 0.7, 'crag'], [0.68, 0.715, 'ledge'], [0.66, 0.8, 'crag'],
  [0.68, 0.855, 'crag'], [0.55, 0.87, 'ledge'], [0.52, 0.95, 'crag'], [0.44, 1.0, 'ledge'],
];
const BUTTE_COLORS = {
  talusA: new THREE.Color('#96603f'), talusB: new THREE.Color('#a8704c'),
  ledge: new THREE.Color('#c08966'), crag: new THREE.Color('#aa7452'), cragBand: new THREE.Color('#c5916b'),
  slab: new THREE.Color('#b8825f'), top: new THREE.Color('#b07b58'),
};

function addButte(b, terrain, m, seed) {
  const K = 48;
  const rows = BUTTE_PROFILE.length;
  // Outline: smooth wobble plus gullies, for the whole butte.
  const outline = [];
  for (let k = 0; k < K; k++) {
    const t = (k / K) * Math.PI * 2;
    let r = 1 + 0.14 * valueNoise(Math.cos(t) * 1.3 + seed, Math.sin(t) * 1.3, seed) + 0.06 * valueNoise(Math.cos(t) * 4, Math.sin(t) * 4 + seed, seed + 1);
    r -= 0.12 * Math.pow(Math.max(0, Math.cos(t * 5 + seed)), 14);
    outline.push(r * (m.stretch ? 1 + m.stretch * Math.cos(2 * (t - m.angle)) : 1));
  }
  // The crag is blocky: its outline changes in steps of a few segments,
  // differently for every tier, and leans a little to one side.
  const block = (k, i) => hash2(Math.floor((k + i * 3) / 4), i, seed + 9);
  const lean = { x: Math.cos(seed) * 0.18 * m.radius, z: Math.sin(seed) * 0.18 * m.radius };
  const base = terrain.heightAt(m.x, m.z) - 0.5;
  const grid = [];
  for (let i = 0; i < rows; i++) {
    const [rf, hf, part] = BUTTE_PROFILE[i];
    const high = hf > 0.6;
    const ring = [];
    for (let k = 0; k < K; k++) {
      const t = (k / K) * Math.PI * 2;
      let f = outline[k] * (1 + (hash2(k, i, seed) - 0.5) * (part === 'talus' ? 0.08 : 0.04));
      if (high) f *= 0.82 + 0.36 * block(k, i);
      if (part === 'ledge' && !high) f *= 0.97 + 0.08 * hash2(Math.floor(k / 3), i, seed + 2); // broken ledges
      const r = m.radius * rf * f;
      const ox = high ? lean.x * (hf - 0.6) * 2.5 : 0, oz = high ? lean.z * (hf - 0.6) * 2.5 : 0;
      const x = m.x + ox + Math.cos(t) * r, z = m.z + oz + Math.sin(t) * r;
      let y = base + hf * m.height + (hash2(k, i + 50, seed) - 0.5) * (part === 'talus' ? 0.6 : 0.2);
      if (i === 0) y = terrain.heightAt(x, z) - 0.25;
      ring.push(V(x, y, z));
    }
    grid.push(ring);
  }
  const center = V(m.x, 0, m.z);
  const c = new THREE.Color();
  for (let i = 0; i < rows - 1; i++) {
    const part = BUTTE_PROFILE[i + 1][2];
    for (let k = 0; k < K; k++) {
      const k2 = (k + 1) % K;
      const p0 = grid[i][k], p1 = grid[i][k2], p2 = grid[i + 1][k2], p3 = grid[i + 1][k];
      const y = (p0.y + p2.y) / 2 - base;
      if (part === 'talus') {
        c.copy(BUTTE_COLORS.talusA).lerp(BUTTE_COLORS.talusB, 0.5 * hash2(k, i, seed + 3) + 0.3 * (y / m.height));
      } else if (part === 'ledge') {
        c.copy(BUTTE_COLORS.ledge);
      } else {
        c.copy(BUTTE_COLORS.crag).lerp(BUTTE_COLORS.cragBand, Math.sin(y * 5.3 + seed) * 0.5 + 0.5);
      }
      c.multiplyScalar(0.94 + 0.12 * hash2(k, i, seed + 4));
      wallQuad(b, p0, p1, p2, p3, c, center);
    }
  }
  const top = grid[rows - 1];
  const mid = V(m.x + lean.x, base + m.height + 0.2, m.z + lean.z);
  for (let k = 0; k < K; k++) flatTri(b, top[k], top[(k + 1) % K], mid, BUTTE_COLORS.top);

  // Flat slabs that have broken off and lie on the scree.
  const slabs = Math.round(m.radius * 3);
  for (let n = 0; n < slabs; n++) {
    const k = Math.floor(hash2(n, 1, seed + 6) * K);
    const i = 1 + Math.floor(hash2(n, 2, seed + 6) * 8);
    const u = hash2(n, 3, seed + 6);
    const p = grid[i][k].clone().lerp(grid[i + 1][k], u);
    const size = m.radius * (0.05 + 0.1 * Math.pow(hash2(n, 4, seed + 6), 2));
    b.box(size * 1.6, size * 0.45, size, p.x, p.y + size * 0.1, p.z, BUTTE_COLORS.slab,
      [(hash2(n, 5, seed) - 0.5) * 0.5, hash2(n, 6, seed) * 6.28, (hash2(n, 7, seed) - 0.5) * 0.5]);
  }
}

// A wall quad facing outwards from `center` (in the xz plane).
function wallQuad(b, p0, p1, p2, p3, color, center) {
  const n = new THREE.Vector3().subVectors(p1, p0).cross(new THREE.Vector3().subVectors(p3, p0));
  const out = V((p0.x + p1.x) / 2 - center.x, 0, (p0.z + p1.z) / 2 - center.z);
  if (n.dot(out) >= 0) b.quad(p0, p1, p2, p3, color);
  else b.quad(p0, p3, p2, p1, color);
}

// Horizontal triangle facing up.
function flatTri(b, p0, p1, p2, color) {
  const n = new THREE.Vector3().subVectors(p1, p0).cross(new THREE.Vector3().subVectors(p2, p0));
  if (n.y >= 0) b.triangle(p0, p1, p2, color);
  else b.triangle(p0, p2, p1, color);
}

// Helper to add a primitive in a local frame (matrix `frame`).
function addLocal(b, frame, geo, x, y, z, color, rot = null, scale = null, shade = true) {
  const m = new THREE.Matrix4().multiplyMatrices(frame, compose(x, y, z, rot, scale));
  b.geometry(geo, m, color, shade);
  geo.dispose();
}

// The lander the pupils arrived in (LM-03, made with Claude Design), with
// its hatch and stairs turned towards the bus at the start.
function buildLanderGroup(terrain) {
  const L = terrain.layout;
  const p = L.lander, bus = L.stop.landing;
  const yaw = Math.atan2(bus.x - p.x, bus.z - p.z);
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  const sunDir = sunDirection().applyQuaternion(q.clone().invert());
  let r = 0, g = 0, b = 0;
  const c = new THREE.Color();
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    c.set(terrain.surfaceColor(p.x + Math.cos(a) * 11.5, p.z + Math.sin(a) * 11.5));
    r += c.r / 8; g += c.g / 8; b += c.b / 8;
  }
  const { group } = buildLander(THREE, { sunDir, groundColor: `#${c.setRGB(r, g, b).getHexString()}` });
  group.position.set(p.x, terrain.heightAt(p.x, p.z), p.z);
  group.quaternion.copy(q);
  return group;
}

// The rover Curiosity (made with Claude Design) at the Murray Buttes. It is
// moved and posed by rover.js.
function buildRoverGroup(terrain) {
  const p = terrain.layout.rover;
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.yaw);
  const sunDir = sunDirection().applyQuaternion(q.clone().invert());
  let r = 0, g = 0, b = 0;
  const c = new THREE.Color();
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    c.set(terrain.surfaceColor(p.x + Math.cos(a) * 3, p.z + Math.sin(a) * 3));
    r += c.r / 8; g += c.g / 8; b += c.b / 8;
  }
  const rover = buildCuriosity(THREE, { sunDir, groundColor: `#${c.setRGB(r, g, b).getHexString()}` });
  rover.group.position.set(p.x, terrain.heightAt(p.x, p.z), p.z);
  rover.group.quaternion.copy(q);
  return rover;
}

// Marsbasen as a building site (made with Claude Design): the problems of
// living on Mars are left unsolved for the pupils. Entrance towards the bus,
// light baked from the scene's sun, ground fading into the terrain.
function buildBaseGroup(terrain) {
  const p = terrain.layout.base;
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.heading);
  const sunDir = sunDirection().applyQuaternion(q.clone().invert());
  let r = 0, g = 0, bl = 0;
  const c = new THREE.Color();
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    c.set(terrain.surfaceColor(p.x + Math.cos(a) * 62, p.z + Math.sin(a) * 62));
    r += c.r / 12; g += c.g / 12; bl += c.b / 12;
  }
  const { group } = buildMarsBaseSite(THREE, { sunDir, groundColor: `#${c.setRGB(r, g, bl).getHexString()}` });
  group.position.set(p.x, terrain.heightAt(p.x, p.z), p.z);
  group.quaternion.copy(q);
  return group;
}

// Numbered signs just after each stop, on the right of the road.
function buildStopSigns(terrain) {
  const path = terrain.path;
  const stops = path.stops.slice(1).filter((s) => !s.final);
  const canvas = document.createElement('canvas');
  canvas.width = 256 * stops.length;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  stops.forEach((s, i) => {
    const cx = i * 256 + 128;
    ctx.fillStyle = '#f2efe9';
    ctx.beginPath(); ctx.arc(cx, 128, 120, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e0772f';
    ctx.beginPath(); ctx.arc(cx, 128, 104, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 150px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(i + 1), cx, 138);
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;

  const pos = [], uv = [], idx = [];
  const poles = new MeshBuilder(worldLight());
  stops.forEach((s, i) => {
    const p = path.sample(s.s + 9);
    const v = headingVectors(p.heading);
    const x = p.x - v.lx * 4.2, z = p.z - v.lz * 4.2;
    const y = terrain.heightAt(x, z);
    const frame = compose(x, y, z, [0, p.heading, 0]);
    addLocal(poles, frame, new THREE.CylinderGeometry(0.05, 0.06, 2.4, 6), 0, 1.2, 0, '#9aa0a6');
    // Sign facing the arriving bus (+z in the local frame), both sides.
    const size = 0.9, cy = 2.5;
    const corners = [V(-size / 2, cy - size / 2, 0.06), V(size / 2, cy - size / 2, 0.06), V(size / 2, cy + size / 2, 0.06), V(-size / 2, cy + size / 2, 0.06)];
    const base = pos.length / 3;
    for (const c of corners) {
      c.applyMatrix4(frame);
      pos.push(c.x, c.y, c.z);
    }
    const u0 = i / stops.length, u1 = (i + 1) / stops.length;
    uv.push(u0, 0, u1, 0, u1, 1, u0, 1);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  const signs = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide }));
  return { signs, poles };
}

export function buildLandmarks(terrain) {
  const L = terrain.layout;
  const group = new THREE.Group();
  group.name = 'landmarks';
  const b = new MeshBuilder(worldLight());
  L.buttes.forEach((m, i) => addButte(b, terrain, m, WORLD.seed + 10 + i));
  const { signs, poles } = buildStopSigns(terrain);
  const mesh = new THREE.Mesh(b.build(), bakedMaterial());
  mesh.matrixAutoUpdate = false;
  group.add(mesh);
  const poleMesh = new THREE.Mesh(poles.build(), bakedMaterial());
  poleMesh.matrixAutoUpdate = false;
  group.add(poleMesh, signs);
  group.add(buildBaseGroup(terrain));
  group.add(buildLanderGroup(terrain));
  const rover = buildRoverGroup(terrain);
  group.add(rover.group);
  group.userData.rover = rover;
  return group;
}
