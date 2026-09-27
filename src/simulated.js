// Simulated passengers for trying the ride alone. They look around a bit
// and now and then point out of the window, especially at the stops.
//
// Everything is a pure function of the ride time t and the seat number:
// no randomness during the ride, so the same t always looks the same.
// Output uses the passenger data format described in passengers.js.

import * as THREE from 'three';
import { SEATS } from './config.js';
import { seatOrigin, seatInfo } from './bus.js';
import { hash2, smoothstep } from './util/noise.js';

const DEG = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);
const SLOT = 18; // seconds per "maybe point out of the window" slot while driving

export class PassengerSimulation {
  constructor(timeline, layout) {
    this.timeline = timeline;
    // Point of interest for each stop, in bus-local coordinates at that stop.
    const targets = {
      landing: { ...layout.lander, y: 7 },
      cliff: { ...layout.rover, y: 1 },
      crater: { ...layout.crater, y: -layout.crater.depth * 0.6 },
      dunes: { ...layout.dunes, y: 1 },
      base: { ...layout.base, y: 5 },
    };
    this.stopTargets = timeline.stops.map((stop) => {
      const target = targets[stop.id];
      if (!target) return null;
      const pose = timeline.poseAtS(stop.s);
      const v = new THREE.Vector3(target.x - pose.x, target.y, target.z - pose.z);
      v.applyAxisAngle(UP, -pose.heading);
      return v;
    });

    this.list = [];
    for (let n = 1; n <= SEATS.count; n++) {
      this.list.push({
        seat: n,
        head: { position: [0, 0, 0], quaternion: [0, 0, 0, 1] },
        hands: [
          { position: [0, 0, 0], quaternion: [0, 0, 0, 1], pose: 'rest' },
          { position: [0, 0, 0], quaternion: [0, 0, 0, 1], pose: 'rest' },
        ],
      });
    }
    this._origin = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._head = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._qa = new THREE.Quaternion();
    this._qb = new THREE.Quaternion();
    this._e = new THREE.Euler(0, 0, 0, 'YXZ');
    this._m = new THREE.Matrix4();
    this._x = new THREE.Vector3();
    this._y = new THREE.Vector3();
    this._z = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this._rest = new THREE.Vector3();
  }

  // Returns the passenger list for time t (all seats; the view skips your own).
  // eyeHeight: the user's own eye height, so classmates sit at the same
  // height as you (defaults to SEATS.eyeHeight).
  update(t, eyeHeight = SEATS.eyeHeight) {
    this.eyeHeight = eyeHeight;
    const phase = this.timeline.phaseAt(Math.max(t, 0));
    for (const p of this.list) this._simulate(p, t, phase);
    return this.list;
  }

  // How strongly passenger `n` is pointing at time t, and at what.
  // Returns weight 0..1 and sets this._dir (seat space, not normalised).
  _pointing(n, t, phase, head) {
    let w = 0;
    const info = seatInfo(n);
    if (phase.type === 'stop' || phase.type === 'start') {
      const k = phase.stop;
      const target = this.stopTargets[k];
      if (target && hash2(k, n, 11) < 0.55) {
        const len = phase.t1 - phase.t0;
        const start = phase.t0 + 2 + hash2(k, n, 12) * Math.max(1, len - 9);
        const dur = 3.5 + hash2(k, n, 13) * 2.5;
        w = envelope(t, start, dur);
        if (w > 0) {
          seatOrigin(n, this._origin);
          this._dir.copy(target).sub(this._origin).sub(head);
        }
      }
    } else if (phase.type === 'drive') {
      for (const j of [Math.floor(t / SLOT), Math.floor(t / SLOT) - 1]) {
        if (hash2(j, n, 21) > 0.16) continue;
        const start = j * SLOT + hash2(j, n, 22) * 10;
        if (start < phase.t0 + 3 || start + 6 > phase.t1) continue;
        const ww = envelope(t, start, 3 + hash2(j, n, 23) * 2);
        if (ww > w) {
          w = ww;
          this._dir.set(info.side, -0.2, -0.5 + hash2(j, n, 24) * 0.6);
        }
      }
    }
    return w;
  }

  _simulate(p, t, phase) {
    const n = p.seat;
    const h = (k) => hash2(n, k, 7);

    // Head: gentle look-around from slow sine waves (per-seat phases).
    const eye = (this.eyeHeight ?? SEATS.eyeHeight) + (h(1) - 0.5) * 0.1;
    let yaw = 22 * DEG * Math.sin((2 * Math.PI * t) / (9 + h(2) * 8) + h(3) * 6.28)
      + 10 * DEG * Math.sin((2 * Math.PI * t) / (5 + h(4) * 3) + h(5) * 6.28);
    let pitch = -4 * DEG + 5 * DEG * Math.sin((2 * Math.PI * t) / (7 + h(6) * 5) + h(7) * 6.28);

    // At stops everyone turns towards the view.
    if (phase.type === 'stop' || phase.type === 'start') {
      const look = this.timeline.stops[phase.stop].look;
      const bias = look === 'left' ? 55 : look === 'right' ? -55 : 0;
      const k = smoothstep(phase.t0, phase.t0 + 3, t) * (1 - smoothstep(phase.t1 - 2, phase.t1, t));
      yaw = yaw * (1 - 0.4 * k) + bias * DEG * k;
    }

    const head = this._head.set(
      0.012 * Math.sin(t * 0.7 + h(8) * 6),
      eye + 0.008 * Math.sin(t * 0.9 + h(9) * 6),
      0.01 * Math.sin(t * 0.5 + h(10) * 6),
    );

    // Pointing overrides the head direction and raises one hand.
    const w = this._pointing(n, t, phase, head);
    let handIndex = -1;
    if (w > 0) {
      const d = this._dir.normalize();
      const tyaw = Math.max(-100 * DEG, Math.min(100 * DEG, Math.atan2(-d.x, -d.z)));
      const tpitch = Math.asin(Math.max(-0.8, Math.min(0.8, d.y)));
      yaw = lerpAngle(yaw, tyaw, w);
      pitch = pitch + (tpitch - pitch) * w;
      handIndex = d.x < 0 ? 0 : 1;
    }

    p.head.position[0] = head.x; p.head.position[1] = head.y; p.head.position[2] = head.z;
    this._q.setFromEuler(this._e.set(pitch, yaw, 0, 'YXZ'));
    this._q.toArray(p.head.quaternion);

    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const hand = p.hands[i];
      // Resting on the lap, turned slightly inwards, with a tiny drift.
      const rest = this._rest.set(
        side * 0.13 + 0.006 * Math.sin(t * 0.6 + h(20 + i) * 6),
        SEATS.seatHeight + 0.17,
        -0.25 + 0.008 * Math.sin(t * 0.4 + h(22 + i) * 6),
      );
      this._qa.setFromEuler(this._e.set(-0.35, side * 0.3, -side * 0.25, 'YXZ'));
      if (i === handIndex) {
        const d = this._dir;
        // Arm from the shoulder, stretched towards the target.
        this._p.set(head.x + side * 0.16, head.y - 0.24, head.z + 0.06).addScaledVector(d, 0.5);
        this._z.copy(d).negate();
        this._x.crossVectors(UP, this._z).normalize();
        this._y.crossVectors(this._z, this._x);
        this._m.makeBasis(this._x, this._y, this._z);
        this._qb.setFromRotationMatrix(this._m);
        const e = smoothstep(0, 1, w);
        rest.lerp(this._p, e);
        this._qa.slerp(this._qb, e);
        hand.pose = w > 0.6 ? 'point' : 'rest';
      } else {
        hand.pose = 'rest';
      }
      hand.position[0] = rest.x; hand.position[1] = rest.y; hand.position[2] = rest.z;
      this._qa.toArray(hand.quaternion);
    }
  }
}

// 0 -> 1 -> 0 over [start, start + dur] with soft edges.
function envelope(t, start, dur) {
  if (t < start || t > start + dur) return 0;
  const edge = Math.min(0.8, dur / 3);
  return smoothstep(start, start + edge, t) * (1 - smoothstep(start + dur - edge, start + dur, t));
}

function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
}
