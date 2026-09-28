// Baked ground shadows: soft shadows under the rocks near the road and the
// long shadows of the Murray Buttes. They are drawn as one mesh that
// multiplies the ground colour (white = no change, darker = shadow), so the
// edges fade out softly without transparency sorting. One draw call.

import * as THREE from 'three';
import { smoothstep } from './util/noise.js';
import { sunDirection } from './terrain.js';

export const SHADOW = {
  strength: 0.45,      // darkest shadow: ground colour x (1 - strength)
  contact: 0.55,       // extra dark right under a rock (share of strength)
  rockRoadDistance: 45, // rocks further from the road get no shadow (m)
  rockMinSize: 0.22,   // smaller rocks get no shadow (m)
  lift: 0.04,          // above the ground (m)
  butteGrid: 2,        // grid spacing for butte shadows (m)
};

const SEG = 12;

export function buildGroundShadows(terrain, rocks) {
  const sun = sunDirection();
  const flat = Math.hypot(sun.x, sun.z);
  const along = flat / sun.y;                   // shadow length per metre of height
  const dir = { x: -sun.x / flat, z: -sun.z / flat }; // away from the sun, on the ground
  const pos = [], col = [];
  const put = (x, z, k) => {
    pos.push(x, terrain.heightAt(x, z) + SHADOW.lift, z);
    col.push(k, k, k);
  };
  const tri = (a, b, c) => { put(...a); put(...b); put(...c); };

  // --- Rocks: a capsule from the rock's foot to where its top's shadow falls.
  for (const r of rocks) {
    if (r.size < SHADOW.rockMinSize || r.roadDistance > SHADOW.rockRoadDistance) continue;
    const r0 = r.radius * 1.05;
    const reach = r.height * along * 0.7;
    const c1 = { x: r.x + dir.x * reach, z: r.z + dir.z * reach }, r1 = r.radius * 0.7;
    const feather = 0.25 + r.radius * 0.5;
    const dark = 1 - SHADOW.strength;
    const center = [r.x, r.z, Math.max(0.35, 1 - SHADOW.strength * (1 + SHADOW.contact))];
    const inner = [], outer = [];
    for (let k = 0; k < SEG; k++) {
      const a = (k / SEG) * Math.PI * 2, ux = Math.cos(a), uz = Math.sin(a);
      // Support distance of the capsule in direction u, measured from the rock.
      const d = Math.max(r0, (c1.x - r.x) * ux + (c1.z - r.z) * uz + r1);
      inner.push([r.x + ux * d, r.z + uz * d, dark]);
      outer.push([r.x + ux * (d + feather), r.z + uz * (d + feather), 1]);
    }
    for (let k = 0; k < SEG; k++) {
      const n = (k + 1) % SEG;
      tri(center, inner[n], inner[k]);
      tri(inner[k], inner[n], outer[n]);
      tri(inner[k], outer[n], outer[k]);
    }
  }

  // --- Buttes: each tier of the butte casts a disc; the shadow is their union.
  for (const b of terrain.layout.buttes) {
    const tiers = [];
    for (const [rf, hf] of [[1.5, 0.26], [1.22, 0.38], [0.96, 0.5], [0.78, 0.62], [0.66, 0.8], [0.52, 0.95], [0.44, 1.0]]) {
      const h = hf * b.height, off = h * along;
      tiers.push({ x: b.x + dir.x * off, z: b.z + dir.z * off, r: rf * b.radius * 0.95, feather: 0.8 + off * 0.08 });
    }
    const darkness = (x, z) => {
      let d = 0;
      for (const t of tiers) d = Math.max(d, 1 - smoothstep(t.r - t.feather, t.r + t.feather, Math.hypot(x - t.x, z - t.z)));
      return d;
    };
    const far = b.height * along + b.radius * 2;
    const x0 = Math.min(b.x, b.x + dir.x * far) - b.radius * 2, x1 = Math.max(b.x, b.x + dir.x * far) + b.radius * 2;
    const z0 = Math.min(b.z, b.z + dir.z * far) - b.radius * 2, z1 = Math.max(b.z, b.z + dir.z * far) + b.radius * 2;
    const g = SHADOW.butteGrid, nx = Math.ceil((x1 - x0) / g), nz = Math.ceil((z1 - z0) / g);
    const D = new Float32Array((nx + 1) * (nz + 1));
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) D[j * (nx + 1) + i] = darkness(x0 + i * g, z0 + j * g);
    const v = (i, j) => [x0 + i * g, z0 + j * g, 1 - SHADOW.strength * D[j * (nx + 1) + i]];
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const a = D[j * (nx + 1) + i], bb = D[j * (nx + 1) + i + 1], c = D[(j + 1) * (nx + 1) + i], d = D[(j + 1) * (nx + 1) + i + 1];
        if (a + bb + c + d < 0.004) continue;
        tri(v(i, j), v(i, j + 1), v(i + 1, j + 1));
        tri(v(i, j), v(i + 1, j + 1), v(i + 1, j));
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeBoundingSphere();
  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    blending: THREE.MultiplyBlending,
    premultipliedAlpha: true,
    transparent: true,
    depthWrite: false,
    fog: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'ground-shadows';
  mesh.renderOrder = 2;
  mesh.matrixAutoUpdate = false;
  return mesh;
}
