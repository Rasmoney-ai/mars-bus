// The rover Curiosity at work by the Murray Buttes: it drives slowly up to a
// rock, puts its arm down on it, glances at the bus, folds the arm, turns on
// the spot and drives on to the next rock.
//
// Like everything else, the rover's pose is a pure function of the ride
// time t, so pause, seek and shared rides all show the same thing.
// Times are relative to the bus arriving at the stop.

import * as THREE from 'three';
import { sunDirection } from './terrain.js';

// Where the rover is at the start, at rock 1 and at rock 2, in its site
// frame (metres; +z = the site heading, +x as in the model's own axes).
const POINTS = [
  { x: 0, z: -2.4 },
  { x: 0, z: 0.2 },
  { x: -2.2, z: 0.6 },
];
// How far in front of the rover's centre the rock under its arm lies
// (the model's arm target).
export const ROCK_AHEAD = 2.0;
// The rock's centre lies a little further out, so the arm rests on its
// near side.
const ROCK_CENTER = ROCK_AHEAD + 0.3;

// The schedule (seconds relative to the bus arrival).
const T = {
  drive1: [-42, -12],   // start -> rock 1
  arm1: [-10, -3],      // arm down on rock 1
  lookBus: [0.5, 5.5],  // camera head glances at the bus
  fold1: [6, 11],       // arm folded again
  steerIn: [11, 12.5],  // corner wheels turned for a turn on the spot
  turn: [12.5, 18.5],
  steerOut: [18.5, 20],
  drive2: [20, 34],     // rock 1 -> rock 2
  arm2: [35, 42],       // arm down on rock 2
};

const legYaw = (a, b) => Math.atan2(b.x - a.x, b.z - a.z);
const YAW1 = legYaw(POINTS[0], POINTS[1]);
const YAW2 = legYaw(POINTS[1], POINTS[2]);
const LEN1 = Math.hypot(POINTS[1].x - POINTS[0].x, POINTS[1].z - POINTS[0].z);
const LEN2 = Math.hypot(POINTS[2].x - POINTS[1].x, POINTS[2].z - POINTS[1].z);

// The rocks the rover studies, in the site frame.
export function roverRocks() {
  return [
    { x: POINTS[1].x + Math.sin(YAW1) * ROCK_CENTER, z: POINTS[1].z + Math.cos(YAW1) * ROCK_CENTER },
    { x: POINTS[2].x + Math.sin(YAW2) * ROCK_CENTER, z: POINTS[2].z + Math.cos(YAW2) * ROCK_CENTER },
  ];
}

// Site frame -> world (a rotation by the site yaw about +y).
export function siteToWorld(site, x, z) {
  const c = Math.cos(site.yaw), s = Math.sin(site.yaw);
  return { x: site.x + x * c + z * s, z: site.z - x * s + z * c };
}

const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const ramp = (r, [a, b]) => ease((r - a) / (b - a));
const mix = (a, b, k) => a + (b - a) * k;

// Camera head directions (radians; yaw + = towards the model's +x).
const LOOK_AHEAD = { yaw: 0, pitch: -0.15 };
const LOOK_ROCK = { yaw: 0.3, pitch: -0.55 };

export class RoverMotion {
  // rover: { group, setPose, relight, info } from curiosity.js;
  // site: { x, z, yaw } in world space; bus: where the bus stops (world);
  // arrival: ride time when the bus arrives at the stop.
  constructor(rover, site, bus, arrival, terrain) {
    this.rover = rover;
    this.site = site;
    this.arrival = arrival;
    this.terrain = terrain;
    this.wheelRadius = rover.info?.wheelRadius ?? 0.25;
    // The bus as seen from the rover's site (for the camera glance).
    let busYaw = Math.atan2(bus.x - site.x, bus.z - site.z) - (site.yaw + YAW1);
    while (busYaw > Math.PI) busYaw -= 2 * Math.PI;
    while (busYaw < -Math.PI) busYaw += 2 * Math.PI;
    this.busYaw = busYaw;
    this._q = new THREE.Quaternion();
    this._up = new THREE.Vector3(0, 1, 0);
    this._sun = new THREE.Vector3();
    this._litYaw = null;
    this.pose = { wheelAngle: 0, steer: 0, mastYaw: 0, mastPitch: 0, arm: 0, turnYaw: 0 };
    this.update(0);
  }

  // Site-frame position, heading and joint pose at ride time t.
  poseAt(t) {
    const r = t - this.arrival;
    const k1 = ramp(r, T.drive1), k2 = ramp(r, T.drive2), kt = ramp(r, T.turn);
    const x = mix(mix(POINTS[0].x, POINTS[1].x, k1), POINTS[2].x, k2);
    const z = mix(mix(POINTS[0].z, POINTS[1].z, k1), POINTS[2].z, k2);
    const turn = (YAW2 - YAW1) * kt;
    const p = this.pose;
    p.wheelAngle = (LEN1 * k1 + LEN2 * k2) / this.wheelRadius;
    p.turnYaw = turn;
    p.steer = ramp(r, T.steerIn) * (1 - ramp(r, T.steerOut));
    p.arm = ramp(r, T.arm1) * (1 - ramp(r, T.fold1)) + ramp(r, T.arm2);

    // Camera head: ahead while driving, at the rock while the arm works,
    // a short glance at the bus.
    const atRock = Math.max(ramp(r, [-12, -10]) * (1 - ramp(r, [10, 12])), ramp(r, [34, 36]));
    const bus = ramp(r, [T.lookBus[0], T.lookBus[0] + 1.5]) * (1 - ramp(r, [T.lookBus[1] - 1.5, T.lookBus[1]]));
    p.mastYaw = mix(mix(LOOK_AHEAD.yaw, LOOK_ROCK.yaw, atRock), this.busYaw, bus);
    p.mastPitch = mix(mix(LOOK_AHEAD.pitch, LOOK_ROCK.pitch, atRock), -0.05, bus);
    return { x, z, yaw: YAW1 + turn };
  }

  update(t) {
    const p = this.poseAt(t);
    const s = this.site;
    const { x, z } = siteToWorld(s, p.x, p.z);
    const g = this.rover.group;
    g.position.set(x, this.terrain.heightAt(x, z), z);
    const yaw = s.yaw + p.yaw;
    g.quaternion.copy(this._q.setFromAxisAngle(this._up, yaw));
    this.rover.setPose(this.pose);
    // Re-bake the light when the rover has turned noticeably.
    if (this._litYaw === null || Math.abs(yaw - this._litYaw) > 0.08) {
      this._litYaw = yaw;
      this.rover.relight(this._sun.copy(sunDirection()).applyQuaternion(this._q.clone().invert()));
    }
  }
}
