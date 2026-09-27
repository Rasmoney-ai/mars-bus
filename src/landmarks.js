// Landmarks along the route: the lander at the start, a layered mesa,
// the base at the end and small numbered signs at the stops.
// All low-poly, built in code, with baked lighting (see terrain.js).

import * as THREE from 'three';
import { WORLD } from './config.js';
import { hash2, mulberry32 } from './util/noise.js';
import { MeshBuilder, compose, bakedMaterial } from './util/mesh.js';
import { worldLight, headingVectors } from './terrain.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// Layered mesa: stacked, slightly tapered rings in alternating strata colours.
function addMesa(b, terrain, m, seed) {
  const K = 18;
  const rng = mulberry32(seed);
  const radii = [];
  for (let k = 0; k < K; k++) radii.push(m.radius * (0.78 + 0.32 * rng()));
  let minY = Infinity;
  for (let k = 0; k < K; k++) {
    const a = (k / K) * Math.PI * 2;
    minY = Math.min(minY, terrain.heightAt(m.x + Math.cos(a) * radii[k], m.z + Math.sin(a) * radii[k]));
  }
  const strata = ['#9a5235', '#c07d55', '#874630', '#b8744c', '#a45e3d', '#d09068'].map((c) => new THREE.Color(c));
  const ledge = new THREE.Color('#c98d63');
  const layers = 5;
  let y = minY - 3;
  let scale = 1;
  const center = V(m.x, 0, m.z);
  const ring = (sc, yy, jitter) => {
    const pts = [];
    for (let k = 0; k < K; k++) {
      const a = (k / K) * Math.PI * 2;
      const r = radii[k] * sc * (1 + (jitter ? (hash2(k, jitter, seed) - 0.5) * 0.08 : 0));
      pts.push(V(m.x + Math.cos(a) * r, yy, m.z + Math.sin(a) * r));
    }
    return pts;
  };
  let bottom = ring(scale, y, 0);
  for (let l = 0; l < layers; l++) {
    const h = (m.height / layers) * (0.75 + 0.5 * rng()) + (l === 0 ? 3 : 0);
    const topScale = scale * 0.975;
    const top = ring(topScale, y + h, l + 1);
    for (let k = 0; k < K; k++) {
      const k2 = (k + 1) % K;
      wallQuad(b, bottom[k], bottom[k2], top[k2], top[k], strata[(l * 2 + (k % 2)) % strata.length], center);
    }
    y += h;
    scale = topScale;
    if (l < layers - 1) {
      const innerScale = scale * (0.93 + 0.04 * rng());
      const inner = ring(innerScale, y, l + 11);
      for (let k = 0; k < K; k++) {
        const k2 = (k + 1) % K;
        flatQuad(b, top[k], top[k2], inner[k2], inner[k], ledge);
      }
      bottom = inner;
      scale = innerScale;
    } else {
      const c = V(m.x, y, m.z);
      for (let k = 0; k < K; k++) flatTri(b, top[k], top[(k + 1) % K], c, ledge);
    }
  }
}

// A wall quad facing outwards from `center` (in the xz plane).
function wallQuad(b, p0, p1, p2, p3, color, center) {
  const n = new THREE.Vector3().subVectors(p1, p0).cross(new THREE.Vector3().subVectors(p3, p0));
  const out = V((p0.x + p1.x) / 2 - center.x, 0, (p0.z + p1.z) / 2 - center.z);
  if (n.dot(out) >= 0) b.quad(p0, p1, p2, p3, color);
  else b.quad(p0, p3, p2, p1, color);
}

// Horizontal quad/triangle facing up.
function flatQuad(b, p0, p1, p2, p3, color) {
  const n = new THREE.Vector3().subVectors(p1, p0).cross(new THREE.Vector3().subVectors(p3, p0));
  if (n.y >= 0) b.quad(p0, p1, p2, p3, color);
  else b.quad(p0, p3, p2, p1, color);
}

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

// The lander the students arrived in, parked next to the start.
function addLander(b, terrain, p) {
  const y = terrain.heightAt(p.x, p.z);
  const frame = compose(p.x, y, p.z, [0, p.heading + 0.4, 0]);
  const white = '#dfe2e4', gold = '#d2a441', dark = '#4a4d52', grey = '#9aa0a6';
  addLocal(b, frame, new THREE.CylinderGeometry(1.7, 2.1, 2.4, 8), 0, 3.0, 0, white);
  addLocal(b, frame, new THREE.ConeGeometry(1.7, 1.6, 8), 0, 5.0, 0, white);
  addLocal(b, frame, new THREE.CylinderGeometry(2.15, 2.15, 0.55, 8), 0, 2.0, 0, gold);
  addLocal(b, frame, new THREE.ConeGeometry(0.75, 1.0, 8, 1, true), 0, 1.25, 0, dark, [Math.PI, 0, 0]);
  addLocal(b, frame, new THREE.CylinderGeometry(0.08, 0.08, 1.6, 5), 0, 6.4, 0, grey);
  addLocal(b, frame, new THREE.ConeGeometry(0.45, 0.25, 8), 0, 7.2, 0, grey, [Math.PI, 0, 0]);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    const top = V(Math.cos(a) * 1.9, 2.0, Math.sin(a) * 1.9);
    const foot = V(Math.cos(a) * 3.6, 0.15, Math.sin(a) * 3.6);
    const mid = top.clone().add(foot).multiplyScalar(0.5);
    const len = top.distanceTo(foot);
    const leg = new THREE.CylinderGeometry(0.11, 0.11, len, 5);
    const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), top.clone().sub(foot).normalize());
    const m = new THREE.Matrix4().compose(mid, q, V(1, 1, 1));
    b.geometry(leg, new THREE.Matrix4().multiplyMatrices(frame, m), grey);
    leg.dispose();
    addLocal(b, frame, new THREE.CylinderGeometry(0.45, 0.55, 0.16, 8), foot.x, 0.08, foot.z, grey);
  }
  // Two solar wings.
  addLocal(b, frame, new THREE.BoxGeometry(3.2, 0.06, 1.3), 3.4, 3.4, 0, '#27365e', [0, 0, 0.25]);
  addLocal(b, frame, new THREE.BoxGeometry(3.2, 0.06, 1.3), -3.4, 3.4, 0, '#27365e', [0, 0, -0.25]);
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
  addMesa(b, terrain, L.mesa, WORLD.seed + 3);
  L.buttes.forEach((m, i) => addMesa(b, terrain, m, WORLD.seed + 10 + i));
  addLander(b, terrain, L.lander);
  addBase(b, terrain, L.base);
  const { signs, poles } = buildStopSigns(terrain);
  const mesh = new THREE.Mesh(b.build(), bakedMaterial());
  mesh.matrixAutoUpdate = false;
  group.add(mesh);
  const poleMesh = new THREE.Mesh(poles.build(), bakedMaterial());
  poleMesh.matrixAutoUpdate = false;
  group.add(poleMesh, signs);
  group.add(buildBaseSign(terrain, L.base));
  return group;
}
