// Landmarks along the route: the lander at the start (lander.js), a group of buttes,
// the base at the end and small numbered signs at the stops.
// All low-poly, built in code, with baked lighting (see terrain.js).

import * as THREE from 'three';
import { WORLD } from './config.js';
import { hash2, valueNoise } from './util/noise.js';
import { MeshBuilder, compose, bakedMaterial } from './util/mesh.js';
import { worldLight, headingVectors, sunDirection } from './terrain.js';
import { buildLander } from './lander.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// A butte like the Murray Buttes in Gale crater (Curiosity drove between
// them): a dark, hard caprock that overhangs a little, steep cliffs of thin
// pale layers, and a wide apron of scree around the foot. Irregular outline
// with gullies, so no two buttes look alike.
const BUTTE_PROFILE = [
  // [radius factor, height factor, part]
  [2.05, 0, 'talus'], [1.72, 0.09, 'talus'], [1.45, 0.2, 'talus'], [1.24, 0.31, 'talus'],
  [1.12, 0.37, 'cliff'], [1.07, 0.52, 'cliff'], [1.03, 0.66, 'cliff'], [1.0, 0.8, 'cliff'],
  [1.09, 0.83, 'cap'], [1.09, 0.94, 'cap'], [1.01, 1.0, 'cap'],
];
const BUTTE_COLORS = {
  talusA: new THREE.Color('#8a4b2f'), talusB: new THREE.Color('#a8663f'),
  layerA: new THREE.Color('#b87c56'), layerB: new THREE.Color('#d2a178'), layerDark: new THREE.Color('#99593a'),
  cap: new THREE.Color('#5c3c2e'), capTop: new THREE.Color('#6d4a38'),
};

function addButte(b, terrain, m, seed) {
  const K = 44;
  const rows = BUTTE_PROFILE.length;
  const outline = [];
  for (let k = 0; k < K; k++) {
    const t = (k / K) * Math.PI * 2;
    let r = 1 + 0.16 * valueNoise(Math.cos(t) * 1.3 + seed, Math.sin(t) * 1.3, seed) + 0.07 * valueNoise(Math.cos(t) * 4, Math.sin(t) * 4 + seed, seed + 1);
    r -= 0.17 * Math.pow(Math.max(0, Math.cos(t * 5 + seed)), 14); // gullies
    outline.push(r * (m.stretch ? 1 + m.stretch * Math.cos(2 * (t - m.angle)) : 1));
  }
  const base = terrain.heightAt(m.x, m.z) - 0.5;
  const grid = [];
  for (let i = 0; i < rows; i++) {
    const [rf, hf, part] = BUTTE_PROFILE[i];
    const ring = [];
    for (let k = 0; k < K; k++) {
      const t = (k / K) * Math.PI * 2;
      const jit = part === 'talus' ? 0.1 : 0.03;
      const r = m.radius * rf * outline[k] * (1 + (hash2(k, i, seed) - 0.5) * jit);
      const x = m.x + Math.cos(t) * r, z = m.z + Math.sin(t) * r;
      let y = base + hf * m.height + (hash2(k, i + 50, seed) - 0.5) * (part === 'talus' ? 0.8 : 0.25);
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
        c.copy(BUTTE_COLORS.talusA).lerp(BUTTE_COLORS.talusB, hash2(k, i, seed + 3));
      } else if (part === 'cliff') {
        const band = Math.sin(y * 4.1 + seed) * 0.5 + 0.5;
        c.copy(BUTTE_COLORS.layerA).lerp(BUTTE_COLORS.layerB, band * 0.8);
        if (Math.sin(y * 1.3 + seed * 0.7) > 0.8) c.lerp(BUTTE_COLORS.layerDark, 0.6);
        c.multiplyScalar(0.95 + 0.1 * hash2(k, i, seed + 4));
      } else {
        c.copy(BUTTE_COLORS.cap).multiplyScalar(0.92 + 0.16 * hash2(k, i, seed + 5));
      }
      wallQuad(b, p0, p1, p2, p3, c, center);
    }
  }
  // Flat, slightly uneven top of the caprock.
  const top = grid[rows - 1];
  const mid = V(m.x, base + m.height + 0.3, m.z);
  for (let k = 0; k < K; k++) flatTri(b, top[k], top[(k + 1) % K], mid, BUTTE_COLORS.capTop);
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

// The base: domes, habitat tubes, a greenhouse, solar panels and an airlock
// facing the arriving bus.
function addBase(b, terrain, p) {
  const y = terrain.heightAt(p.x, p.z);
  // Local frame: +z points back towards the arriving bus.
  const frame = compose(p.x, y, p.z, [0, p.heading, 0]);
  const white = '#e9e6e1', stripe = '#e0772f', grey = '#8d9398', dark = '#34383d';
  const glass = '#bfe0d6', panel = '#22315a', gold = '#c9a13b';
  const dome = (r, x, z, color, seg = 16) =>
    addLocal(b, frame, new THREE.SphereGeometry(r, seg, Math.max(4, seg / 2), 0, Math.PI * 2, 0, Math.PI / 2), x, 0, z, color);

  dome(10, 0, 0, white);
  addLocal(b, frame, new THREE.CylinderGeometry(10.05, 10.05, 0.6, 16), 0, 0.3, 0, stripe);
  // Airlock towards the bus.
  addLocal(b, frame, new THREE.BoxGeometry(5, 3.6, 7), 0, 1.8, 11.5, white);
  addLocal(b, frame, new THREE.BoxGeometry(5.1, 0.35, 7.1), 0, 2.9, 11.5, stripe);
  addLocal(b, frame, new THREE.BoxGeometry(2.4, 2.6, 0.2), 0, 1.3, 15.05, dark);
  addLocal(b, frame, new THREE.BoxGeometry(0.35, 0.35, 0.2), -1.8, 2.3, 15.1, '#ffd36b', null, null, false);
  addLocal(b, frame, new THREE.BoxGeometry(0.35, 0.35, 0.2), 1.8, 2.3, 15.1, '#ffd36b', null, null, false);
  // Habitat tubes left and right.
  for (const side of [-1, 1]) {
    const x = side * 17;
    addLocal(b, frame, new THREE.CylinderGeometry(2.8, 2.8, 14, 12), x, 2.8, side * 1.5, white, [0, 0, Math.PI / 2]);
    addLocal(b, frame, new THREE.CylinderGeometry(2.85, 2.85, 0.5, 12), x - 4, 2.8, side * 1.5, stripe, [0, 0, Math.PI / 2]);
    addLocal(b, frame, new THREE.SphereGeometry(2.8, 12, 6), x + side * 7, 2.8, side * 1.5, white);
    for (let k = -1; k <= 1; k++) {
      addLocal(b, frame, new THREE.BoxGeometry(0.9, 0.5, 0.1), x + k * 3, 3.3, side * 1.5 + 2.78, '#bfe7ff', null, null, false);
    }
  }
  // Greenhouse dome with a green glow.
  dome(7, -31, -8, glass, 12);
  addLocal(b, frame, new THREE.SphereGeometry(5.5, 10, 4, 0, Math.PI * 2, 0, Math.PI / 2), -31, 0.05, -8, '#5c9c4a');
  dome(5, 25, -14, white, 12);
  // Solar field.
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 5; c++) {
      const x = 32 + c * 4.2, z = 8 + r * 4;
      addLocal(b, frame, new THREE.BoxGeometry(0.15, 1.2, 0.15), x, 0.6, z, grey);
      addLocal(b, frame, new THREE.BoxGeometry(3.6, 0.08, 2.2), x, 1.3, z, panel, [-0.45, 0, 0]);
    }
  }
  // Antenna mast with a dish and a red light.
  addLocal(b, frame, new THREE.CylinderGeometry(0.18, 0.25, 14, 6), -9, 7, -15, grey);
  addLocal(b, frame, new THREE.ConeGeometry(2.2, 0.9, 12, 1, true), -9, 12.5, -15, white, [-0.9, 0.5, 0]);
  addLocal(b, frame, new THREE.BoxGeometry(0.4, 0.4, 0.4), -9, 14.2, -15, '#ff4a3a', null, null, false);
  // Rover garage roof and a gold fuel tank.
  addLocal(b, frame, new THREE.BoxGeometry(9, 4, 8), 14, 2, 13, '#d9d4cc');
  addLocal(b, frame, new THREE.BoxGeometry(6.5, 3.2, 0.2), 14, 1.6, 17.05, dark);
  addLocal(b, frame, new THREE.CylinderGeometry(1.4, 1.4, 5, 10), -14, 1.4, 12, gold, [0, 0, Math.PI / 2]);
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

function buildBaseSign(terrain, p) {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 96;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#2f3a4a';
  ctx.fillRect(0, 0, 512, 96);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 64px system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('MARSBASEN', 256, 52);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 0.86), new THREE.MeshBasicMaterial({ map: tex }));
  const y = terrain.heightAt(p.x, p.z);
  mesh.matrix.multiplyMatrices(compose(p.x, y, p.z, [0, p.heading, 0]), compose(0, 3.35, 15.02));
  mesh.matrixAutoUpdate = false;
  return mesh;
}

export function buildLandmarks(terrain) {
  const L = terrain.layout;
  const group = new THREE.Group();
  group.name = 'landmarks';
  const b = new MeshBuilder(worldLight());
  L.buttes.forEach((m, i) => addButte(b, terrain, m, WORLD.seed + 10 + i));
  addBase(b, terrain, L.base);
  const { signs, poles } = buildStopSigns(terrain);
  const mesh = new THREE.Mesh(b.build(), bakedMaterial());
  mesh.matrixAutoUpdate = false;
  group.add(mesh);
  const poleMesh = new THREE.Mesh(poles.build(), bakedMaterial());
  poleMesh.matrixAutoUpdate = false;
  group.add(poleMesh, signs);
  group.add(buildBaseSign(terrain, L.base));
  group.add(buildLanderGroup(terrain));
  return group;
}
