// The Mars landscape: terrain, road, rocks, sky and haze.
// Built once at load time from a fixed seed. Lighting is baked into vertex
// colours, so the whole landscape costs only a handful of draw calls.

import * as THREE from 'three';
import { WORLD } from './config.js';
import { fbm, valueNoise, mulberry32, hash2, smoothstep, lerp } from './util/noise.js';
import { MeshBuilder, makeLight, shadeFactor, bakedMaterial } from './util/mesh.js';
import { buildLandmarks } from './landmarks.js';

const DEG = Math.PI / 180;

// Direction towards the sun (world space).
export function sunDirection() {
  const az = WORLD.sunAzimuthDeg * DEG, el = WORLD.sunElevationDeg * DEG;
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
}

export function worldLight() {
  return makeLight({ dir: sunDirection(), diffuse: 0.75, sky: 0.5, ground: 0.28 });
}

// Forward / left unit vectors (x, z) for a heading.
export function headingVectors(h) {
  return {
    fx: -Math.sin(h), fz: -Math.cos(h),
    lx: -Math.cos(h), lz: Math.sin(h),
  };
}

// Where the landmarks go, placed relative to the stops.
export function computeLayout(path) {
  const stop = {};
  for (const s of path.stops) {
    const p = path.sample(s.s);
    stop[s.id] = { x: p.x, z: p.z, heading: p.heading };
  }
  const at = (id, forward, left) => {
    const p = stop[id];
    const v = headingVectors(p.heading);
    return { x: p.x + v.fx * forward + v.lx * left, z: p.z + v.fz * forward + v.lz * left, heading: p.heading };
  };

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < path.count; i++) {
    minX = Math.min(minX, path.x[i]); maxX = Math.max(maxX, path.x[i]);
    minZ = Math.min(minZ, path.z[i]); maxZ = Math.max(maxZ, path.z[i]);
  }
  const center = { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 };
  const halfX = (maxX - minX) / 2, halfZ = (maxZ - minZ) / 2;

  const crater = { ...at('crater', 4, -58), radius: 55, depth: 16, rim: 2.5 };
  const dunes = { ...at('dunes', 10, 110), radius: 95, wavelength: 34, amp: 3.2, windDir: stop.dunes.heading + 1.1 };
  const mesa = { ...at('cliff', 12, 78), radius: 36, height: 44 };
  const buttes = [
    { ...at('cliff', 75, 95), radius: 16, height: 26 },
    { ...at('cliff', -45, 115), radius: 12, height: 19 },
  ];
  const lander = { ...at('landing', -4, -24) };
  const base = { ...at('base', 42, -4) };
  // A big hazy mountain on the horizon, north-west of the route.
  const mountain = { x: center.x - 900, z: center.z - 1250, radius: 520, height: 330 };

  return { stop, center, halfX, halfZ, crater, dunes, mesa, buttes, lander, base, mountain };
}

// Natural terrain height (before the road is graded in).
export function makeNaturalHeight(layout) {
  const seed = WORLD.seed;
  const { center, crater, dunes, lander, base, mountain, mesa } = layout;
  const flats = [
    { x: lander.x, z: lander.z, r0: 18, r1: 45 },
    { x: base.x, z: base.z, r0: 55, r1: 95 },
    { x: mesa.x, z: mesa.z, r0: mesa.radius * 0.8, r1: mesa.radius * 1.6 },
  ];
  const hills = (x, z) => {
    let h = fbm(x / 170, z / 170, 4, seed) * 6.5;
    h += fbm(x / 45, z / 45, 2, seed + 7) * 0.9;
    const dc = Math.hypot((x - center.x) / 1.1, z - center.z);
    const far = smoothstep(430, 1500, dc);
    h += far * (30 + 70 * Math.abs(fbm(x / 380, z / 380, 3, seed + 3)));
    const dm = Math.hypot(x - mountain.x, z - mountain.z) / mountain.radius;
    h += mountain.height * Math.exp(-dm * dm * 1.6) * (0.85 + 0.15 * fbm(x / 120, z / 120, 2, seed + 5));
    return h;
  };
  for (const f of flats) f.level = hills(f.x, f.z);

  return function naturalHeight(x, z) {
    let h = hills(x, z);
    for (const f of flats) {
      const d = Math.hypot(x - f.x, z - f.z);
      if (d < f.r1) h = lerp(f.level, h, smoothstep(f.r0, f.r1, d));
    }
    // Crater: flat floor, sloping walls, low rim.
    const rc = Math.hypot(x - crater.x, z - crater.z) / crater.radius;
    if (rc < 2.2) {
      h += -crater.depth * (1 - smoothstep(0.45, 1.0, rc));
      h += crater.rim * Math.exp(-(((rc - 1.02) / 0.16) ** 2));
    }
    // Dunes: asymmetric ridges across the wind.
    const dd = Math.hypot(x - dunes.x, z - dunes.z) / dunes.radius;
    if (dd < 1) {
      const mask = 1 - smoothstep(0.55, 1.0, dd);
      const wx = Math.cos(dunes.windDir), wz = Math.sin(dunes.windDir);
      const u = ((x - dunes.x) * wx + (z - dunes.z) * wz) / dunes.wavelength
        + 0.35 * valueNoise(x / 60, z / 60, seed + 21);
      const f = u - Math.floor(u);
      const ridge = f < 0.72 ? smoothstep(0, 0.72, f) : 1 - smoothstep(0.72, 1, f);
      h += mask * dunes.amp * ridge;
    }
    return h;
  };
}

// Fast lookup of the nearest road point, using a coarse grid of path samples.
class RoadIndex {
  constructor(path, cell = 24) {
    this.path = path;
    this.cell = cell;
    this.map = new Map();
    for (let s = 0; s <= path.length; s += 1) {
      const p = path.sample(s);
      const key = this.key(Math.floor(p.x / cell), Math.floor(p.z / cell));
      let list = this.map.get(key);
      if (!list) this.map.set(key, (list = []));
      list.push(p.x, p.z, s);
    }
  }
  key(i, j) { return i * 100003 + j; }
  // Returns { d, s } for the nearest sample within one cell, else d = Infinity.
  nearest(x, z, out = {}) {
    const ci = Math.floor(x / this.cell), cj = Math.floor(z / this.cell);
    let best = Infinity, bestS = 0;
    for (let i = ci - 1; i <= ci + 1; i++) {
      for (let j = cj - 1; j <= cj + 1; j++) {
        const list = this.map.get(this.key(i, j));
        if (!list) continue;
        for (let k = 0; k < list.length; k += 3) {
          const dx = list[k] - x, dz = list[k + 1] - z;
          const d2 = dx * dx + dz * dz;
          if (d2 < best) { best = d2; bestS = list[k + 2]; }
        }
      }
    }
    out.d = Math.sqrt(best);
    out.s = bestS;
    return out;
  }
}

// Non-uniform grid axis: fine spacing in the middle, growing towards the edge.
function makeAxis(center, innerHalf, outerHalf, spacing) {
  const f = 0.8;
  const inner = Math.ceil((2 * innerHalf) / spacing / 2) * 2;
  const segments = Math.ceil(inner / f / 2) * 2;
  const a = (innerHalf * (1 - f)) / f;
  const b = Math.max(0, outerHalf - innerHalf - a);
  const coords = new Float64Array(segments + 1);
  for (let i = 0; i <= segments; i++) {
    const u = (i / segments) * 2 - 1;
    const au = Math.abs(u);
    let d;
    if (au <= f) d = (au / f) * innerHalf;
    else {
      const v = (au - f) / (1 - f);
      d = innerHalf + a * v + b * v * v;
    }
    coords[i] = center + Math.sign(u) * d;
  }
  return coords;
}

function findCell(coords, v) {
  let lo = 0, hi = coords.length - 2;
  if (v <= coords[0]) return 0;
  if (v >= coords[hi + 1]) return hi;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (coords[mid] <= v) lo = mid; else hi = mid - 1;
  }
  return lo;
}

export class Terrain {
  constructor(path) {
    this.path = path;
    this.layout = computeLayout(path);
    this.natural = makeNaturalHeight(this.layout);
    path.buildHeightProfile(this.natural);
    this.road = new RoadIndex(path);
    this.flatRadius = 5.5;
    this.blendRadius = 16;

    const L = this.layout;
    const margin = 260;
    this.xs = makeAxis(L.center.x, L.halfX + margin, WORLD.terrainOuterHalf, WORLD.terrainSpacing);
    this.zs = makeAxis(L.center.z, L.halfZ + margin, WORLD.terrainOuterHalf, WORLD.terrainSpacing);
    const nx = this.xs.length, nz = this.zs.length;
    this.heights = new Float32Array(nx * nz);
    const tmp = {};
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        this.heights[j * nx + i] = this.gradedHeight(this.xs[i], this.zs[j], tmp);
      }
    }
  }

  // Natural terrain blended into the smoothed road near the route.
  gradedHeight(x, z, tmp = {}) {
    const h = this.natural(x, z);
    const r = this.road.nearest(x, z, tmp);
    if (r.d >= this.blendRadius) return h;
    const roadY = this.path.heightAt(r.s) - 0.06;
    return lerp(roadY, h, smoothstep(this.flatRadius, this.blendRadius, r.d));
  }

  // Height of the actual terrain mesh at (x, z).
  heightAt(x, z) {
    const xs = this.xs, zs = this.zs, nx = xs.length;
    const i = findCell(xs, x), j = findCell(zs, z);
    const fx = Math.min(Math.max((x - xs[i]) / (xs[i + 1] - xs[i]), 0), 1);
    const fz = Math.min(Math.max((z - zs[j]) / (zs[j + 1] - zs[j]), 0), 1);
    const H = this.heights;
    const h00 = H[j * nx + i], h10 = H[j * nx + i + 1];
    const h01 = H[(j + 1) * nx + i], h11 = H[(j + 1) * nx + i + 1];
    if (((i + j) & 1) === 0) {
      if (fz >= fx) return h00 + (h11 - h01) * fx + (h01 - h00) * fz;
      return h00 + (h10 - h00) * fx + (h11 - h10) * fz;
    }
    if (fx + fz <= 1) return h00 + (h10 - h00) * fx + (h01 - h00) * fz;
    return h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
  }

  distanceToRoad(x, z) {
    return this.road.nearest(x, z).d;
  }

  // Ground colour (sRGB-ish linear THREE.Color) for a triangle.
  groundColor(x, z, y, ny, out) {
    const L = this.layout;
    const seed = WORLD.seed;
    const n1 = fbm(x / 55, z / 55, 3, seed + 11) * 0.5 + 0.5;
    const n2 = fbm(x / 9, z / 9, 2, seed + 13) * 0.5 + 0.5;
    out.copy(COLORS.groundDark).lerp(COLORS.groundLight, n1 * 0.8 + n2 * 0.2);
    // Exposed rock on steep slopes.
    const slope = 1 - ny;
    out.lerp(COLORS.slope, smoothstep(0.12, 0.45, slope) * 0.8);
    // Dark basalt sand in the dunes.
    const dd = Math.hypot(x - L.dunes.x, z - L.dunes.z) / L.dunes.radius;
    if (dd < 1.05) out.lerp(COLORS.dune, (1 - smoothstep(0.5, 1.0, dd)) * 0.9);
    // Lighter dust on the crater floor.
    const rc = Math.hypot(x - L.crater.x, z - L.crater.z) / L.crater.radius;
    if (rc < 0.8) out.lerp(COLORS.craterFloor, (1 - smoothstep(0.35, 0.75, rc)) * 0.6);
    // Scorched ground around the lander.
    const dl = Math.hypot(x - L.lander.x, z - L.lander.z);
    if (dl < 20) out.lerp(COLORS.scorch, (1 - smoothstep(4, 18, dl)) * 0.75);
    // Tiny per-triangle variation for the low-poly look.
    out.multiplyScalar(0.94 + 0.12 * hash2(Math.floor(x * 3.1), Math.floor(z * 3.7), seed + 5));
    return out;
  }

  // Builds the terrain meshes (split into tiles for frustum culling).
  buildMeshes(detailTexture) {
    const xs = this.xs, zs = this.zs, nx = xs.length, nz = zs.length, H = this.heights;
    const light = worldLight();
    const material = bakedMaterial({ map: detailTexture });
    const group = new THREE.Group();
    group.name = 'terrain';
    const tiles = 5;
    const col = new THREE.Color();
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), n = new THREE.Vector3();
    const uvScale = 1 / 6;

    for (let ty = 0; ty < tiles; ty++) {
      for (let tx = 0; tx < tiles; tx++) {
        const i0 = Math.floor(((nx - 1) * tx) / tiles), i1 = Math.floor(((nx - 1) * (tx + 1)) / tiles);
        const j0 = Math.floor(((nz - 1) * ty) / tiles), j1 = Math.floor(((nz - 1) * (ty + 1)) / tiles);
        const cells = (i1 - i0) * (j1 - j0);
        const pos = new Float32Array(cells * 18);
        const cols = new Float32Array(cells * 18);
        const uvs = new Float32Array(cells * 12);
        let p = 0, q = 0;
        const put = (v) => {
          pos[p] = v.x; pos[p + 1] = v.y; pos[p + 2] = v.z;
          cols[p] = col.r; cols[p + 1] = col.g; cols[p + 2] = col.b;
          uvs[q] = v.x * uvScale; uvs[q + 1] = v.z * uvScale;
          p += 3; q += 2;
        };
        const tri = (ia, ja, ib, jb, ic, jc) => {
          a.set(xs[ia], H[ja * nx + ia], zs[ja]);
          b.set(xs[ib], H[jb * nx + ib], zs[jb]);
          c.set(xs[ic], H[jc * nx + ic], zs[jc]);
          e1.subVectors(b, a); e2.subVectors(c, a);
          n.crossVectors(e1, e2).normalize();
          const cx = (a.x + b.x + c.x) / 3, cz = (a.z + b.z + c.z) / 3, cy = (a.y + b.y + c.y) / 3;
          this.groundColor(cx, cz, cy, n.y, col);
          col.multiplyScalar(shadeFactor(n, light) * 1.1);
          put(a); put(b); put(c);
        };
        for (let j = j0; j < j1; j++) {
          for (let i = i0; i < i1; i++) {
            if (((i + j) & 1) === 0) {
              tri(i, j, i, j + 1, i + 1, j + 1);
              tri(i, j, i + 1, j + 1, i + 1, j);
            } else {
              tri(i, j, i, j + 1, i + 1, j);
              tri(i + 1, j, i, j + 1, i + 1, j + 1);
            }
          }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
        geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
        geo.computeBoundingSphere();
        const mesh = new THREE.Mesh(geo, material);
        mesh.matrixAutoUpdate = false;
        group.add(mesh);
      }
    }
    return group;
  }
}

const COLORS = {
  groundDark: new THREE.Color('#7c3f25'),
  groundLight: new THREE.Color('#b86a42'),
  slope: new THREE.Color('#6e3320'),
  dune: new THREE.Color('#4a3833'),
  craterFloor: new THREE.Color('#c58a62'),
  scorch: new THREE.Color('#3b2620'),
  rockA: new THREE.Color('#5a2f20'),
  rockB: new THREE.Color('#8a4c31'),
};

// --- Textures -----------------------------------------------------------------

// Grainy detail texture multiplied onto the terrain colours.
function makeDetailTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const seed = WORLD.seed + 31;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Tileable noise: wrap coordinates.
      const n = tileNoise(x / size, y / size, 8, seed) * 0.6 + tileNoise(x / size, y / size, 32, seed + 1) * 0.4;
      const speck = hash2(x, y, seed + 2);
      let v = 0.86 + n * 0.12;
      if (speck > 0.985) v -= 0.18;
      else if (speck < 0.012) v += 0.1;
      const k = (y * size + x) * 4;
      const c = Math.max(0, Math.min(255, Math.round(v * 255)));
      img.data[k] = c; img.data[k + 1] = Math.round(c * 0.97); img.data[k + 2] = Math.round(c * 0.95); img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// Periodic value noise on the unit square (period = cells).
function tileNoise(u, v, cells, seed) {
  const x = u * cells, y = v * cells;
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const h = (i, j) => hash2(((i % cells) + cells) % cells, ((j % cells) + cells) % cells, seed);
  const a = h(ix, iy), b = h(ix + 1, iy), c = h(ix, iy + 1), d = h(ix + 1, iy + 1);
  return (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy) * 2 - 1;
}

// Road surface: compacted dust with two faint wheel tracks and soft edges.
function makeRoadTexture() {
  const w = 64, h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  const seed = WORLD.seed + 41;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w;
      const n = tileNoise(u, y / h, 16, seed) * 0.5 + tileNoise(u, y / h, 64, seed + 1) * 0.5;
      const edge = smoothstep(0, 0.2, u) * smoothstep(0, 0.2, 1 - u);
      const track = Math.exp(-(((Math.abs(u - 0.5) - 0.26) / 0.05) ** 2));
      let r = 176 + n * 14 - track * 34, g = 118 + n * 10 - track * 26, b = 84 + n * 8 - track * 20;
      const k = (y * w + x) * 4;
      img.data[k] = r; img.data[k + 1] = g; img.data[k + 2] = b;
      img.data[k + 3] = Math.round(edge * 235);
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function buildRoad(path) {
  const half = WORLD.roadWidth / 2;
  const step = 2;
  const n = Math.ceil(path.length / step) + 1;
  const pos = new Float32Array(n * 2 * 3);
  const uv = new Float32Array(n * 2 * 2);
  const index = [];
  const shade = shadeFactor(new THREE.Vector3(0, 1, 0), worldLight()) * 0.95;
  for (let k = 0; k < n; k++) {
    const s = Math.min(k * step, path.length);
    const p = path.sample(s);
    const y = path.heightAt(s) + 0.03;
    const v = headingVectors(p.heading);
    pos.set([p.x + v.lx * half, y, p.z + v.lz * half, p.x - v.lx * half, y, p.z - v.lz * half], k * 6);
    uv.set([0, s / 10, 1, s / 10], k * 4);
    if (k > 0) {
      const a = (k - 1) * 2, b = a + 1, c = a + 2, d = a + 3;
      index.push(a, b, c, b, d, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(index);
  geo.computeBoundingSphere();
  const mat = new THREE.MeshBasicMaterial({
    map: makeRoadTexture(),
    color: new THREE.Color(shade, shade, shade),
    transparent: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 1;
  mesh.matrixAutoUpdate = false;
  return mesh;
}

// --- Rocks ----------------------------------------------------------------------

// A few rock shapes, jittered by position so shared corners stay closed.
// 0-1: tiny (8 faces), 2-5: medium (20 faces), 6-7: big boulders (80 faces).
function rockPrototypes(seed) {
  const protos = [];
  for (let k = 0; k < 8; k++) {
    const geo = k < 2 ? new THREE.OctahedronGeometry(1, 0) : new THREE.IcosahedronGeometry(1, k < 6 ? 0 : 1);
    const pos = geo.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const j = 0.72 + 0.5 * hash2(Math.round(v.x * 1000) + k * 7, Math.round(v.y * 1000) * 31 + Math.round(v.z * 1000), seed);
      v.multiplyScalar(j);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    protos.push(geo);
  }
  return protos;
}

function buildRocks(terrain) {
  const L = terrain.layout;
  const path = terrain.path;
  const rng = mulberry32(WORLD.seed + 77);
  const protos = rockPrototypes(WORLD.seed);
  const builder = new MeshBuilder(worldLight());
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const pv = new THREE.Vector3(), sv = new THREE.Vector3();
  const col = new THREE.Color();

  const blocked = (x, z, r) => {
    if (terrain.distanceToRoad(x, z) < 6.5 + r) return true;
    if (Math.hypot(x - L.base.x, z - L.base.z) < 70) return true;
    if (Math.hypot(x - L.lander.x, z - L.lander.z) < 16) return true;
    if (Math.hypot(x - L.mesa.x, z - L.mesa.z) < L.mesa.radius * 0.85) return true;
    for (const b of L.buttes) if (Math.hypot(x - b.x, z - b.z) < b.radius * 0.85) return true;
    const dd = Math.hypot(x - L.dunes.x, z - L.dunes.z) / L.dunes.radius;
    if (dd < 0.8 && rng() < 0.85) return true;
    return false;
  };

  const place = (x, z, size, flat = 0.6) => {
    if (blocked(x, z, size)) return;
    const pick = rng();
    const proto = size < 0.35 ? protos[Math.floor(pick * 2)] : size < 2.5 ? protos[2 + Math.floor(pick * 4)] : protos[6 + Math.floor(pick * 2)];
    const y = terrain.heightAt(x, z) - size * 0.3;
    e.set((rng() - 0.5) * 0.5, rng() * Math.PI * 2, (rng() - 0.5) * 0.5);
    q.setFromEuler(e);
    sv.set(size * (0.8 + rng() * 0.5), size * flat * (0.7 + rng() * 0.6), size * (0.8 + rng() * 0.5));
    m.compose(pv.set(x, y, z), q, sv);
    col.copy(COLORS.rockA).lerp(COLORS.rockB, rng());
    builder.geometry(proto, m, col);
  };

  // Many small rocks near the route, where they are seen up close.
  for (let i = 0; i < 2300; i++) {
    const s = rng() * path.length;
    const p = path.sample(s);
    const v = headingVectors(p.heading);
    const side = rng() < 0.5 ? -1 : 1;
    const d = 7 + Math.pow(rng(), 1.8) * 125;
    const along = (rng() - 0.5) * 20;
    const x = p.x + v.lx * d * side + v.fx * along;
    const z = p.z + v.lz * d * side + v.fz * along;
    const r = rng();
    const size = r < 0.04 ? 1.4 + rng() * 2.2 : 0.12 + Math.pow(rng(), 2.2) * 0.9;
    place(x, z, size);
  }
  // Scattered boulders further out.
  for (let i = 0; i < 170; i++) {
    const x = L.center.x + (rng() - 0.5) * (L.halfX * 2 + 500);
    const z = L.center.z + (rng() - 0.5) * (L.halfZ * 2 + 500);
    place(x, z, 1 + rng() * 3.5);
  }
  // Rubble around the foot of the mesa and buttes.
  for (const b of [L.mesa, ...L.buttes]) {
    const count = Math.round(b.radius * 5);
    for (let i = 0; i < count; i++) {
      const a = rng() * Math.PI * 2;
      const d = b.radius * (0.9 + rng() * 0.5);
      place(b.x + Math.cos(a) * d, b.z + Math.sin(a) * d, 0.4 + Math.pow(rng(), 2) * 2.8, 0.7);
    }
  }
  // Rocks on the crater rim and floor.
  for (let i = 0; i < 90; i++) {
    const a = rng() * Math.PI * 2;
    const d = L.crater.radius * (rng() < 0.6 ? 0.95 + rng() * 0.3 : rng() * 0.7);
    place(L.crater.x + Math.cos(a) * d, L.crater.z + Math.sin(a) * d, 0.2 + Math.pow(rng(), 2) * 1.6);
  }

  const mesh = new THREE.Mesh(builder.build(), bakedMaterial());
  mesh.matrixAutoUpdate = false;
  mesh.name = 'rocks';
  return mesh;
}

// --- Sky --------------------------------------------------------------------

function buildSky() {
  const group = new THREE.Group();
  group.name = 'sky';
  const radius = 2600;
  const geo = new THREE.SphereGeometry(radius, 32, 16);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const top = new THREE.Color(WORLD.skyTop), horizon = new THREE.Color(WORLD.skyHorizon);
  const glow = new THREE.Color('#f3e2c8');
  const sun = sunDirection();
  const v = new THREE.Vector3(), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    c.copy(horizon).lerp(top, smoothstep(0.02, 0.75, v.y));
    const g = Math.pow(Math.max(0, v.dot(sun)), 6);
    c.lerp(glow, g * 0.55);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false });
  const dome = new THREE.Mesh(geo, mat);
  dome.renderOrder = -2;
  group.add(dome);

  // The sun: small and pale, with a soft halo.
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,253,245,1)');
  grad.addColorStop(0.07, 'rgba(255,250,235,1)');
  grad.addColorStop(0.1, 'rgba(250,235,205,0.55)');
  grad.addColorStop(0.35, 'rgba(240,215,180,0.16)');
  grad.addColorStop(1, 'rgba(240,215,180,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, fog: false, depthWrite: false, transparent: true }));
  const dist = radius * 0.9;
  sprite.position.copy(sun).multiplyScalar(dist);
  sprite.scale.setScalar(dist * 0.12);
  sprite.renderOrder = -1;
  group.add(sprite);
  return group;
}

// --- World ------------------------------------------------------------------

export function createWorld(path) {
  const terrain = new Terrain(path);
  const group = new THREE.Group();
  group.name = 'world';
  group.add(terrain.buildMeshes(makeDetailTexture()));
  group.add(buildRoad(path));
  group.add(buildRocks(terrain));
  group.add(buildLandmarks(terrain));
  const sky = buildSky();

  const fog = new THREE.Fog(new THREE.Color(WORLD.skyHorizon), WORLD.fogNear, WORLD.fogFar);
  const background = new THREE.Color(WORLD.skyHorizon);

  return {
    terrain,
    group,
    sky,
    fog,
    background,
    layout: terrain.layout,
    // Keep the sky centred on the bus (it never rotates).
    update(pose) {
      sky.position.set(pose.x, 0, pose.z);
    },
  };
}
