// The rover Curiosity at work by the Murray Buttes: it drives slowly up to a
// rock, stops to study it, turns and drives on to the next one.
//
// Like everything else, the rover's pose is a pure function of the ride
// time t, so pause, seek and shared rides all show the same thing.
// Times are relative to the bus arriving at the stop.

import * as THREE from 'three';

// Waypoints in the rover's site frame (metres; +z = the site heading, +x
// as in the model's own axes). `t` is when the rover is there, relative to
// the bus arrival. Between two waypoints the rover first waits `wait` s,
// turns on the spot for `turn` s towards the next one, then drives straight
// to it.
export const ROVER_PLAN = [
  { t: -40, x: 0, z: -2.4 },
  { t: -10, x: 0, z: 0.2 },          // at rock 1 when the bus arrives
  { t: 28, x: -2.2, z: 0.6, wait: 16, turn: 6 }, // studies rock 1, then on to rock 2
];
// How far in front of the rover's centre a rock it studies lies.
export const ROCK_AHEAD = 2.0;

// The rocks the rover stops at, in the site frame.
export function roverRocks() {
  const rocks = [];
  for (let i = 1; i < ROVER_PLAN.length; i++) {
    const a = ROVER_PLAN[i - 1], b = ROVER_PLAN[i];
    const yaw = Math.atan2(b.x - a.x, b.z - a.z);
    rocks.push({ x: b.x + Math.sin(yaw) * ROCK_AHEAD, z: b.z + Math.cos(yaw) * ROCK_AHEAD });
  }
  return rocks;
}

// Site frame -> world (a rotation by the site yaw about +y).
export function siteToWorld(site, x, z) {
  const c = Math.cos(site.yaw), s = Math.sin(site.yaw);
  return { x: site.x + x * c + z * s, z: site.z - x * s + z * c };
}

const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

function lerpAngle(a, b, k) {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * k;
}

export class RoverMotion {
  // group: the rover model; site: { x, z, yaw } in world space;
  // arrival: ride time when the bus arrives at the stop.
  constructor(group, site, arrival, terrain) {
    this.group = group;
    this.site = site;
    this.arrival = arrival;
    this.terrain = terrain;
    // Heading of each drive leg (the rover drives forwards along +z).
    this.legs = [];
    for (let i = 1; i < ROVER_PLAN.length; i++) {
      const a = ROVER_PLAN[i - 1], b = ROVER_PLAN[i];
      this.legs.push({ a, b, yaw: Math.atan2(b.x - a.x, b.z - a.z), wait: b.wait ?? 0, turn: b.turn ?? 0 });
    }
    this._q = new THREE.Quaternion();
    this._up = new THREE.Vector3(0, 1, 0);
    this.update(0);
  }

  // Site-frame pose at ride time t.
  poseAt(t) {
    const r = t - this.arrival;
    const legs = this.legs;
    if (r <= legs[0].a.t) return { x: legs[0].a.x, z: legs[0].a.z, yaw: legs[0].yaw };
    for (let i = 0; i < legs.length; i++) {
      const L = legs[i];
      if (r > L.b.t) continue;
      const prevYaw = i > 0 ? legs[i - 1].yaw : L.yaw;
      const turnStart = L.a.t + L.wait, driveStart = turnStart + L.turn;
      if (r < driveStart) {
        return { x: L.a.x, z: L.a.z, yaw: lerpAngle(prevYaw, L.yaw, ease((r - turnStart) / L.turn)) };
      }
      const k = ease((r - driveStart) / (L.b.t - driveStart));
      return { x: L.a.x + (L.b.x - L.a.x) * k, z: L.a.z + (L.b.z - L.a.z) * k, yaw: L.yaw };
    }
    const last = legs[legs.length - 1];
    return { x: last.b.x, z: last.b.z, yaw: last.yaw };
  }

  update(t) {
    const p = this.poseAt(t);
    const s = this.site;
    const { x, z } = siteToWorld(s, p.x, p.z);
    this.group.position.set(x, this.terrain.heightAt(x, z), z);
    this.group.quaternion.copy(this._q.setFromAxisAngle(this._up, s.yaw + p.yaw));
  }
}
