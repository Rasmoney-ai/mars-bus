// The route: a fixed path made of straights and smooth turns, plus a
// precomputed speed plan for each drive between two stops.
//
// Everything here is computed once at load time from fixed data, so the
// same time t always gives the same position (see timeline.js).
//
// Coordinates: x = east, z = south, y = up. Heading 0 means driving
// north (-z); a positive heading change is a left turn.

import { COMFORT, TIMELINE } from './config.js';

const DEG = Math.PI / 180;

// --- Route data -----------------------------------------------------------
// straight: length in metres
// turn: angle in degrees (+ = left, - = right), radius = tightest radius.
//       Curvature rises and falls smoothly, so the turn rate never jumps.
// stop: a place where the bus stops. `look` says which side the view is.
export const ROUTE = [
  { stop: { id: 'landing', name: 'Landingspladsen', look: 'right' } },
  { straight: 30 },
  { turn: -35, radius: 40 },
  { straight: 35 },
  { turn: 55, radius: 32 },
  { straight: 38 },
  {
    stop: {
      id: 'cliff', name: 'Klippetårnene', look: 'left',
      text: 'Se de lagdelte klipper til venstre',
    },
  },
  { straight: 25 },
  { turn: -80, radius: 30 },
  { straight: 45 },
  { turn: 40, radius: 18 },
  { straight: 22 },
  {
    stop: {
      id: 'crater', name: 'Krateret', look: 'right',
      text: 'Kig ned i krateret til højre',
    },
  },
  { straight: 25 },
  { turn: -60, radius: 30 },
  { straight: 50 },
  { turn: 45, radius: 35 },
  { straight: 25 },
  {
    stop: {
      id: 'dunes', name: 'Sandklitterne', look: 'left',
      text: 'Mørke sandklitter til venstre',
    },
  },
  { straight: 25 },
  { turn: 50, radius: 30 },
  { straight: 30 },
  { turn: -45, radius: 40 },
  { straight: 75 },
  {
    stop: {
      id: 'base', name: 'Marsbasen', look: 'front',
      text: 'Velkommen til Marsbasen!', final: true,
    },
  },
];

// --- Path geometry ---------------------------------------------------------

const PATH_STEP = 0.25;   // stored sample spacing (m)
const SUB_STEPS = 5;      // integration sub-steps per stored sample

export class Path {
  constructor(pieces) {
    // Expand pieces into a curvature function over arc length.
    const segments = [];
    const stops = [];
    let length = 0;
    for (const piece of pieces) {
      if (piece.stop) {
        stops.push({ ...piece.stop, s: length });
      } else if (piece.straight) {
        segments.push({ s0: length, len: piece.straight, peak: 0 });
        length += piece.straight;
      } else if (piece.turn) {
        const angle = piece.turn * DEG;
        const len = 2 * Math.abs(angle) * piece.radius;
        segments.push({ s0: length, len, peak: Math.sign(angle) / piece.radius });
        length += len;
      }
    }
    this.length = length;
    this.stops = stops;
    this.segments = segments;

    const n = Math.ceil(length / PATH_STEP) + 1;
    this.count = n;
    this.x = new Float64Array(n);
    this.z = new Float64Array(n);
    this.heading = new Float64Array(n);
    this.curvature = new Float64Array(n);

    // Integrate heading and position with small midpoint steps.
    let x = 0, z = 0, h = 0;
    const d = PATH_STEP / SUB_STEPS;
    for (let i = 0; i < n; i++) {
      const s = i * PATH_STEP;
      this.x[i] = x; this.z[i] = z; this.heading[i] = h;
      this.curvature[i] = this.curvatureAt(s);
      for (let k = 0; k < SUB_STEPS; k++) {
        const sm = s + (k + 0.5) * d;
        const hm = h + this.curvatureAt(sm) * d / 2;
        x += -Math.sin(hm) * d;
        z += -Math.cos(hm) * d;
        h += this.curvatureAt(sm) * d;
      }
    }
  }

  // Exact curvature (1/m) at arc length s.
  curvatureAt(s) {
    for (const seg of this.segments) {
      if (s >= seg.s0 && s < seg.s0 + seg.len) {
        if (seg.peak === 0) return 0;
        const u = Math.sin(Math.PI * (s - seg.s0) / seg.len);
        return seg.peak * u * u;
      }
    }
    return 0;
  }

  // Position and heading at arc length s (linear interpolation).
  sample(s, out = {}) {
    const f = Math.min(Math.max(s, 0), this.length) / PATH_STEP;
    const i = Math.min(Math.floor(f), this.count - 2);
    const a = f - i;
    out.x = this.x[i] + (this.x[i + 1] - this.x[i]) * a;
    out.z = this.z[i] + (this.z[i + 1] - this.z[i]) * a;
    out.heading = this.heading[i] + (this.heading[i + 1] - this.heading[i]) * a;
    out.curvature = this.curvature[i] + (this.curvature[i + 1] - this.curvature[i]) * a;
    return out;
  }

  // Road height along the path. `heightFn(x, z)` is the natural terrain.
  // The profile is heavily smoothed so height changes stay small and soft.
  buildHeightProfile(heightFn, { smoothing = 35, maxSlope = 0.025 } = {}) {
    const n = this.count;
    const raw = new Float64Array(n);
    for (let i = 0; i < n; i++) raw[i] = heightFn(this.x[i], this.z[i]);

    // Gaussian smoothing along the path (clamped at the ends).
    const sigma = smoothing / PATH_STEP;
    const radius = Math.ceil(sigma * 3);
    const kernel = new Float64Array(2 * radius + 1);
    let sum = 0;
    for (let k = -radius; k <= radius; k++) {
      const w = Math.exp(-0.5 * (k / sigma) ** 2);
      kernel[k + radius] = w; sum += w;
    }
    const smooth = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        const j = Math.min(Math.max(i + k, 0), n - 1);
        acc += raw[j] * kernel[k + radius];
      }
      smooth[i] = acc / sum;
    }

    // Limit the slope in both directions, then smooth once more.
    const dmax = maxSlope * PATH_STEP;
    for (let i = 1; i < n; i++) smooth[i] = Math.min(Math.max(smooth[i], smooth[i - 1] - dmax), smooth[i - 1] + dmax);
    for (let i = n - 2; i >= 0; i--) smooth[i] = Math.min(Math.max(smooth[i], smooth[i + 1] - dmax), smooth[i + 1] + dmax);
    this.y = boxSmooth(boxSmooth(smooth, Math.round(8 / PATH_STEP)), Math.round(8 / PATH_STEP));
  }

  heightAt(s) {
    if (!this.y) return 0;
    const f = Math.min(Math.max(s, 0), this.length) / PATH_STEP;
    const i = Math.min(Math.floor(f), this.count - 2);
    const a = f - i;
    return this.y[i] + (this.y[i + 1] - this.y[i]) * a;
  }
}

function boxSmooth(src, r) {
  const n = src.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let acc = 0, c = 0;
    for (let k = -r; k <= r; k++) {
      const j = Math.min(Math.max(i + k, 0), n - 1);
      acc += src[j]; c++;
    }
    out[i] = acc / c;
  }
  return out;
}

// --- Speed plan -------------------------------------------------------------
// Plans a drive from s0 to s1 (standing still at both ends).
// 1. speed limit along the path (top speed, turn rate, sideways push),
// 2. forward/backward passes for gentle acceleration and braking,
// 3. convert to a time table and smooth it so acceleration changes softly.
// Returns a table of s and v at fixed time steps.
export function planDrive(path, s0, s1) {
  const c = COMFORT;
  const margin = c.planningMargin;
  const omega = c.maxTurnRateDeg * DEG * margin;
  const alat = c.maxLateralAccel * margin;

  const ds = 0.1;
  const n = Math.max(2, Math.ceil((s1 - s0) / ds));
  const step = (s1 - s0) / n;

  const v = new Float64Array(n + 1);
  for (let i = 0; i <= n; i++) {
    const k = Math.abs(path.curvatureAt(s0 + i * step));
    let lim = c.maxSpeed;
    if (k > 1e-6) lim = Math.min(lim, omega / k, Math.sqrt(alat / k));
    v[i] = lim;
  }
  v[0] = 0; v[n] = 0;
  const acc = c.maxAccel * margin, dec = c.maxDecel * margin;
  for (let i = 1; i <= n; i++) v[i] = Math.min(v[i], Math.sqrt(v[i - 1] ** 2 + 2 * acc * step));
  for (let i = n - 1; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt(v[i + 1] ** 2 + 2 * dec * step));

  // Time at each distance sample.
  const tAt = new Float64Array(n + 1);
  for (let i = 1; i <= n; i++) tAt[i] = tAt[i - 1] + (2 * step) / Math.max(v[i - 1] + v[i], 1e-6);

  // Speed on a uniform time grid.
  const dt = TIMELINE.tableStep;
  const m = Math.ceil(tAt[n] / dt) + 1;
  const vt = new Float64Array(m);
  let p = 0;
  for (let j = 0; j < m; j++) {
    const t = j * dt;
    while (p < n - 1 && tAt[p + 1] < t) p++;
    const a = Math.min(Math.max((t - tAt[p]) / Math.max(tAt[p + 1] - tAt[p], 1e-9), 0), 1);
    vt[j] = v[p] + (v[p + 1] - v[p]) * a;
  }

  // Smooth with a raised-cosine kernel: acceleration becomes continuous.
  const half = Math.max(1, Math.round(c.smoothingSeconds / 2 / dt));
  const kernel = new Float64Array(2 * half + 1);
  let ksum = 0;
  for (let k = -half; k <= half; k++) {
    const w = 0.5 * (1 + Math.cos(Math.PI * k / (half + 1)));
    kernel[k + half] = w; ksum += w;
  }
  const total = m + 2 * half;
  const vs = new Float64Array(total);
  for (let j = 0; j < total; j++) {
    let a = 0;
    for (let k = -half; k <= half; k++) {
      const src = j - half + k;
      if (src >= 0 && src < m) a += vt[src] * kernel[k + half];
    }
    vs[j] = a / ksum;
  }
  vs[0] = 0; vs[total - 1] = 0;

  // Integrate to distance, then scale so the drive ends exactly at s1.
  const s = new Float64Array(total);
  for (let j = 1; j < total; j++) s[j] = s[j - 1] + (vs[j - 1] + vs[j]) * 0.5 * dt;
  const scale = (s1 - s0) / s[total - 1];
  for (let j = 0; j < total; j++) { s[j] = s0 + s[j] * scale; vs[j] *= scale; }
  s[total - 1] = s1;

  return { s0, s1, dt, duration: (total - 1) * dt, s, v: vs };
}

// Distance and speed at time tau (seconds since the drive started).
export function sampleDrive(plan, tau, out = {}) {
  const f = Math.min(Math.max(tau / plan.dt, 0), plan.s.length - 1);
  const j = Math.min(Math.floor(f), plan.s.length - 2);
  const a = f - j;
  out.s = plan.s[j] + (plan.s[j + 1] - plan.s[j]) * a;
  out.v = plan.v[j] + (plan.v[j + 1] - plan.v[j]) * a;
  return out;
}
