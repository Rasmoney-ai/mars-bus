// Simulated Meta Quest 3 headsets ride the shared bus together.
//
//   node tests/shared-ride/sim-vr.mjs [ws://localhost:8787] [folder for pictures]
//
// The site runs unchanged in headless Chromium. Each "headset" is a page
// with Meta's Immersive Web Emulation Runtime (see sim-headset.mjs): the
// site believes it is in a Quest 3 with hand tracking, and the test moves
// the head and the hands. The relay must already be running at the address
// given (see relay/README.md). Run `npm install` in this folder once.
//
// Checked: entering VR on a seat, that each headset draws the other
// passenger's helmet and gloves exactly where that passenger's own head and
// hands are, pointing, smooth following, starting the ride with a finger on
// the seat screen, one ride clock for all, the teacher's page taking over,
// leaving, and a full bus of ten.
//
// Without a graphics card every drawn frame is slow, so by default the
// headsets only draw when a picture is taken (the site's own code still runs
// every frame, 30 times a second).
// Environment: SIM_RENDER=always draws every frame (slow), SIM_FPS (frames a
// second per headset, default 30, or 10 when every frame is drawn),
// SIM_GL ('swiftshader' or 'lavapipe'), SIM_AA=1 (antialiasing on).

import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStaticServer, launchBrowser, openHeadset } from './sim-headset.mjs';
import { startBots } from './bots.mjs';
import { decodePng, differingPixels, countNear } from './png.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const RELAY = process.argv[2] || 'ws://localhost:8787';
const OUT = resolve(process.argv[3] || join(HERE, 'out'));
const RENDER = process.env.SIM_RENDER === 'always' ? 'always' : 'onDemand';
const FPS = Number(process.env.SIM_FPS || (RENDER === 'always' ? 10 : 30));
const GL = process.env.SIM_GL || 'swiftshader';
const AA = process.env.SIM_AA === '1';
const SIZE = { width: 960, height: 540 };

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const results = [];
let failed = 0;

async function test(title, fn) {
  const started = Date.now();
  try {
    const note = await fn();
    results.push({ title, ok: true, note: note || '' });
    console.log(`ok    ${title}${note ? `\n      ${note}` : ''}   [${((Date.now() - started) / 1000).toFixed(1)} s]`);
  } catch (err) {
    failed++;
    results.push({ title, ok: false, note: String(err && err.message ? err.message : err) });
    console.log(`FAIL  ${title}\n      ${err && err.stack ? err.stack : err}`);
  }
}

// Waits until the (async) check returns something truthy, and returns it.
async function until(check, what, ms = 60_000) {
  const end = Date.now() + ms;
  let last;
  for (;;) {
    try { last = await check(); } catch (err) { last = null; if (Date.now() > end) throw err; }
    if (last) return last;
    if (Date.now() > end) throw new Error(`timed out waiting for: ${what}`);
    await sleep(150);
  }
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const angleDeg = (p, q) => {
  const d = Math.abs(p[0] * q[0] + p[1] * q[1] + p[2] * q[2] + p[3] * q[3]);
  return (2 * Math.acos(Math.min(1, d)) * 180) / Math.PI;
};
const yawDeg = (q) => (2 * Math.atan2(q[1], q[3]) * 180) / Math.PI;
const mm = (metres) => `${(metres * 1000).toFixed(1)} mm`;
const median = (list) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];

// --- Measurements inside a rider's page (window.marsbus, see src/main.js) ------

/* eslint-disable no-undef */

// Our own head and hands as they are in this headset, measured in the bus.
function ownInBus() {
  const { camera, bus, hands, settings } = window.marsbus;
  bus.group.updateMatrixWorld(true);
  const inverse = bus.group.matrixWorld.clone().invert();
  const P = camera.position.clone(), Q = camera.quaternion.clone(), S = camera.scale.clone();
  const inBus = (object) => {
    object.matrixWorld.clone().premultiply(inverse).decompose(P, Q, S);
    return { position: P.toArray(), quaternion: Q.toArray() };
  };
  const out = { seat: settings.seat, head: inBus(camera), hands: { left: null, right: null } };
  for (const side of ['left', 'right']) {
    const wrist = hands.wrist(side);
    const i = hands.handedness.indexOf(side);
    if (!wrist || i < 0) continue;
    const tip = hands.hands[i].joints['index-finger-tip'];
    out.hands[side] = {
      ...inBus(wrist),
      pose: hands.pointing(side) ? 'point' : 'rest',
      indexTip: tip ? inBus(tip).position : null,
      // The same two points in the headset's own space (for aiming a finger).
      wristOwn: wrist.position.toArray(),
      tipOwn: tip ? tip.position.toArray() : null,
    };
  }
  return out;
}

// How the passenger on `seat` is drawn in this headset, measured in the bus:
// the helmet, and every glove that is drawn (for any passenger).
function drawnInBus(seat) {
  const { passengers, camera } = window.marsbus;
  const P = camera.position.clone(), Q = camera.quaternion.clone(), S = camera.scale.clone();
  const M = camera.matrix.clone();
  const out = { head: null, helmets: 0, gloves: [], groupIsPlain: passengers.group.matrix.elements.every((v, i) => v === (i % 5 === 0 ? 1 : 0)) };
  for (const set of Object.values(passengers.sets)) {
    out.helmets += set.body.count;
    const sign = set.signs[seat - 1];
    if (sign.visible && set.body.count > 0) {
      sign.matrix.decompose(P, Q, S);
      out.head = { position: P.toArray(), quaternion: Q.toArray() };
    }
    for (const [key, mesh] of Object.entries(set.gloves)) {
      // The fingertip of this glove shape: its vertex furthest forward (-z).
      const vertices = mesh.geometry.attributes.position;
      let best = 0;
      for (let v = 1; v < vertices.count; v++) if (vertices.getZ(v) < vertices.getZ(best)) best = v;
      for (let k = 0; k < mesh.count; k++) {
        mesh.getMatrixAt(k, M);
        M.decompose(P, Q, S);
        const tip = P.clone().set(vertices.getX(best), vertices.getY(best), vertices.getZ(best)).applyMatrix4(M);
        out.gloves.push({
          pose: key.startsWith('point') ? 'point' : 'rest',
          side: key.endsWith('-1') ? 'left' : 'right',
          position: P.toArray(), quaternion: Q.toArray(), tip: tip.toArray(),
        });
      }
    }
  }
  return out;
}

// The ride as this page sees it right now.
function rideState() {
  const { clock, network, bus, panel, timeline } = window.marsbus;
  return {
    t: clock.getTime(), playing: clock.playing, at: Date.now(),
    bus: [...bus.group.position.toArray(), bus.group.rotation.y],
    status: network ? network.status : 'solo',
    seat: network ? network.seat : null,
    peers: network ? [...network.peers] : [],
    control: network ? network.control : false,
    canControl: network ? network.canControl : true,
    rtt: network ? network.rtt : null,
    buttons: panel.buttons.map((b) => b.id),
    line: panel.state.line,
    message: panel.message,
    duration: timeline.duration,
  };
}

// Where a button of the seat screen is, in the headset's own space:
// a point 6 cm in front of it and a point on it.
function panelTarget(id) {
  const { panel, rig, bus } = window.marsbus;
  bus.group.updateMatrixWorld(true);
  const b = panel.buttons.find((x) => x.id === id);
  if (!b) return null;
  const v = rig.position.clone();
  const at = (z) => {
    v.set(((b.x + b.w / 2) / 512 - 0.5) * panel.screen.width, (0.5 - (b.y + b.h / 2) / 256) * panel.screen.height, z);
    panel.mesh.localToWorld(v);
    rig.worldToLocal(v);
    return v.toArray();
  };
  return { hover: at(0.06), press: at(0.003) };
}

// Where a point in the bus lands in this headset's picture (pixels).
function toPicture(point) {
  const { camera, bus } = window.marsbus;
  bus.group.updateMatrixWorld(true);
  const v = camera.position.clone().set(point[0], point[1], point[2]).applyMatrix4(bus.group.matrixWorld).project(camera);
  return { x: ((v.x + 1) / 2) * window.innerWidth, y: ((1 - v.y) / 2) * window.innerHeight, inView: Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 && v.z < 1 };
}

// A time when the bus drives at a good speed (for looking at the moving ride).
function drivingTime() {
  const { timeline } = window.marsbus;
  const pose = {};
  for (let t = 40; t < timeline.duration - 30; t += 1) {
    if (timeline.poseAt(t, pose).v > 2.5 && timeline.poseAt(t + 12, pose).v > 2.5) return t;
  }
  return null;
}

/* eslint-enable no-undef */

// --- Set-up -------------------------------------------------------------------

await mkdir(OUT, { recursive: true });
const server = await startStaticServer(ROOT);
const browser = await launchBrowser({ gl: GL });
const room = `simvr-${Math.random().toString(36).slice(2, 8)}`;
const address = (page, extra = '') => `${server.url}${page}?room=${room}&relay=${encodeURIComponent(RELAY)}${extra}`;
const headsetOptions = (name) => ({ name, ...SIZE, render: RENDER, maxFps: FPS, antialias: AA, head: { position: [0, 1.22, 0] } });
const pages = []; // { name, errors() } for the final check
console.log(`Site ${server.url} · relay ${RELAY} · room ${room} · ${GL}, ${RENDER === 'always' ? 'every frame drawn' : 'drawing only for pictures'}, at most ${FPS} frames a second per headset\n`);

// What one headset draws for a seat, compared with that passenger's own pose.
// `needHands`: the comparison only counts once these hands are tracked.
async function compare(subject, viewer, seat, needHands = []) {
  const own = await subject.evaluate(ownInBus);
  const seen = await viewer.evaluate(drawnInBus, seat);
  if (!seen.head) return { ok: false, why: 'no helmet drawn' };
  const head = { position: dist(own.head.position, seen.head.position), angle: angleDeg(own.head.quaternion, seen.head.quaternion) };
  const hands = {};
  let ok = head.position < 0.005 && head.angle < 0.5;
  for (const side of ['left', 'right']) {
    const mine = own.hands[side];
    const glove = seen.gloves.find((g) => g.side === side);
    if (!mine && !glove) continue;
    if (!mine || !glove) { ok = false; hands[side] = { missing: mine ? 'not drawn' : 'drawn but not tracked' }; continue; }
    hands[side] = {
      position: dist(mine.position, glove.position), angle: angleDeg(mine.quaternion, glove.quaternion),
      pose: glove.pose, poseOwn: mine.pose, tip: mine.indexTip ? dist(mine.indexTip, glove.tip) : null,
    };
    if (hands[side].position > 0.005 || hands[side].angle > 0.5 || glove.pose !== mine.pose) ok = false;
  }
  if (needHands.some((side) => !hands[side] || hands[side].missing)) ok = false;
  return { ok, head, hands, own, seen };
}

// --- 0. The solo ride still works in VR ------------------------------------------

await test('the solo ride (no room) still runs in VR with hand tracking', async () => {
  const solo = await openHeadset(browser, `${server.url}?seat=5&speak=0`, headsetOptions('solo'));
  pages.push(solo);
  const session = await solo.enterVR();
  assert.ok(session.enabledFeatures.includes('hand-tracking'), 'hand tracking is on');
  assert.ok(session.enabledFeatures.includes('local-floor'), 'floor-level space is on');
  await solo.setHand('left', { position: [-0.18, 0.8, -0.3] });
  await solo.setHand('right', { position: [0.2, 1.0, -0.35], pose: 'point' });
  await solo.waitFrames(14);
  const one = await solo.evaluate(rideState);
  await sleep(1500);
  const two = await solo.evaluate(rideState);
  const own = await solo.evaluate(ownInBus);
  assert.equal(one.status, 'solo');
  assert.ok(two.playing && two.t > one.t, 'the ride is running');
  assert.ok(own.hands.left && own.hands.right, 'both own hands are tracked');
  assert.equal(own.hands.right.pose, 'point', 'a pointing hand is recognised');
  assert.equal(own.hands.left.pose, 'rest', 'a relaxed hand is not taken for pointing');
  await solo.screenshot(join(OUT, 'solo-vr.png'));
  await solo.close();
  return `ride time went from ${one.t.toFixed(1)} s to ${two.t.toFixed(1)} s; own gloves tracked`;
});

// --- 1. Two headsets --------------------------------------------------------------

let A, B;
await test('two headsets enter VR on seats 3 and 4 and see each other on board', async () => {
  A = await openHeadset(browser, address('', '&seat=3&speak=0'), headsetOptions('seat 3'));
  B = await openHeadset(browser, address('', '&seat=4&speak=0'), headsetOptions('seat 4'));
  pages.push(A, B);
  const sessions = [await A.enterVR(), await B.enterVR()];
  for (const s of sessions) assert.ok(s.enabledFeatures.includes('hand-tracking'), 'hand tracking is on');
  await A.waitFrames(14);
  await B.waitFrames(14);
  const a = await until(async () => { const s = await A.evaluate(rideState); return s.status === 'online' && s.peers.join() === '3,4' && s; }, 'seat 3 online and seeing both seats');
  const b = await until(async () => { const s = await B.evaluate(rideState); return s.status === 'online' && s.peers.join() === '3,4' && s; }, 'seat 4 online and seeing both seats');
  assert.equal(a.seat, 3);
  assert.equal(b.seat, 4);
  assert.equal(a.playing, false, 'the bus waits until someone starts the ride');
  assert.equal(a.line, 'Er alle klar? Tryk Start');
  return `both online; waiting at the landing site; seat screen says "${a.line}"`;
});

await test('each headset draws the other passenger exactly where that passenger is', async () => {
  // Seat 3 leans a little and looks to the right; the right hand points ahead.
  await A.setHead({ position: [0.04, 1.25, -0.03], yawDeg: -25, pitchDeg: -6, rollDeg: 4 });
  await A.setHand('left', { position: [-0.18, 0.74, -0.28], yawDeg: 10, pitchDeg: -20 });
  await A.setHand('right', { position: [0.24, 1.06, -0.36], yawDeg: 12, pitchDeg: 14, rollDeg: -30, pose: 'point' });
  // Seat 4 looks to the left with both hands up in front.
  await B.setHead({ position: [-0.03, 1.19, 0.02], yawDeg: 35, pitchDeg: 5 });
  await B.setHand('left', { position: [-0.17, 0.98, -0.3], yawDeg: 20, pitchDeg: 10, rollDeg: 40 });
  await B.setHand('right', { position: [0.16, 1.0, -0.32], yawDeg: -15, pitchDeg: 5, rollDeg: -60 });
  const both = ['left', 'right'];
  const ab = await until(async () => { const c = await compare(A, B, 3, both); return c.ok && c; }, 'seat 4 draws seat 3 where seat 3 is');
  const ba = await until(async () => { const c = await compare(B, A, 4, both); return c.ok && c; }, 'seat 3 draws seat 4 where seat 4 is');
  assert.ok(ab.seen.groupIsPlain, 'passengers are drawn in bus coordinates');
  assert.equal(ab.hands.right.pose, 'point');
  assert.equal(ab.hands.left.pose, 'rest');
  assert.equal(ba.hands.left.pose, 'rest');
  assert.equal(ba.hands.right.pose, 'rest');
  // Sanity: the two really sit side by side, about a seat apart.
  const apart = dist(ab.own.head.position, ba.own.head.position);
  assert.ok(apart > 0.5 && apart < 1.6, `heads ${apart.toFixed(2)} m apart`);
  const worst = Math.max(ab.head.position, ba.head.position, ab.hands.left.position, ab.hands.right.position, ba.hands.left.position, ba.hands.right.position);
  const worstAngle = Math.max(ab.head.angle, ba.head.angle, ab.hands.left.angle, ab.hands.right.angle, ba.hands.left.angle, ba.hands.right.angle);
  // The pointing glove is a fixed shape, so its fingertip is close to, but
  // not exactly at, the real fingertip.
  assert.ok(ab.hands.right.tip < 0.06, `pointing fingertip ${mm(ab.hands.right.tip)} from the real one`);
  return `heads ${apart.toFixed(2)} m apart; helmets and wrists at most ${mm(worst)} and ${worstAngle.toFixed(2)}° from the real head and hands; `
    + `pointing fingertip drawn ${mm(ab.hands.right.tip)} from the real fingertip`;
});

await test('the other passenger is really in the picture (pixels)', async () => {
  // Seat 4 turns towards seat 3. Compare the picture with and without the
  // passengers drawn; what changes must be where the helmet is expected.
  await B.setHead({ position: [0, 1.2, 0], yawDeg: 62, pitchDeg: -8, rollDeg: 0 });
  await B.setHand('left', null);
  await B.setHand('right', null);
  await sleep(600);
  await B.waitFrames(4);
  const seen = await B.evaluate(drawnInBus, 3);
  const spot = await B.evaluate(toPicture, seen.head.position);
  assert.ok(spot.inView, 'the helmet is inside the field of view');
  const first = await B.screenshot(join(OUT, 'two-headsets-seat4-sees-seat3.png'));
  await B.waitFrames(2);
  const again = await B.screenshot();
  await B.evaluate(() => { window.marsbus.passengers.group.visible = false; });
  await B.waitFrames(3);
  const without = await B.screenshot(join(OUT, 'two-headsets-seat4-passengers-hidden.png'));
  await B.evaluate(() => { window.marsbus.passengers.group.visible = true; });
  const one = decodePng(first), two = decodePng(again), three = decodePng(without);
  const noise = differingPixels(one, two);
  const change = differingPixels(one, three);
  let total = 0;
  for (let i = 0; i < change.length; i++) { if (noise[i]) change[i] = 0; total += change[i]; }
  const near = countNear(change, one.width, spot.x, spot.y, 70);
  assert.ok(total > 800, `only ${total} pixels belong to the passenger`);
  assert.ok(near > 400, `only ${near} passenger pixels near the expected place`);
  return `${total} pixels of the picture are the other passenger; ${near} of them within 70 pixels of where the helmet should be (${Math.round(spot.x)}, ${Math.round(spot.y)})`;
});

await test('a turning head is followed smoothly, and a hand out of sight disappears', async () => {
  await A.setHead({ position: [0, 1.22, 0], yawDeg: -40, pitchDeg: 0, rollDeg: 0 });
  await until(async () => { const s = await B.evaluate(drawnInBus, 3); return s.head && Math.abs(yawDeg(s.head.quaternion) + 40) < 1; }, 'the helmet at the start of the turn');
  const samples = [];
  let sampling = true;
  const sampler = (async () => {
    while (sampling) {
      const s = await B.evaluate(drawnInBus, 3);
      if (s.head) samples.push(yawDeg(s.head.quaternion));
      await sleep(70);
    }
  })();
  for (let yaw = -40; yaw <= 40; yaw += 4) {
    await A.setHead({ yawDeg: yaw });
    await sleep(110);
  }
  await until(async () => { const s = await B.evaluate(drawnInBus, 3); return s.head && Math.abs(yawDeg(s.head.quaternion) - 40) < 1; }, 'the helmet at the end of the turn', 20_000);
  sampling = false;
  await sampler;
  let back = 0, biggest = 0;
  for (let i = 1; i < samples.length; i++) {
    back = Math.max(back, samples[i - 1] - samples[i]);
    biggest = Math.max(biggest, samples[i] - samples[i - 1]);
  }
  const between = new Set(samples.filter((y) => y > -38 && y < 38).map((y) => y.toFixed(1))).size;
  assert.ok(back < 1, `the helmet turned back by ${back.toFixed(1)}° at some point`);
  assert.ok(between >= 5, `only ${between} in-between positions were seen`);

  // The right hand leaves the cameras' view: its glove must go away.
  await A.setHand('right', null);
  await until(async () => { const s = await B.evaluate(drawnInBus, 3); return s.head && !s.gloves.some((g) => g.side === 'right'); }, 'the right glove is gone');
  const left = (await B.evaluate(drawnInBus, 3)).gloves.filter((g) => g.side === 'left').length;
  assert.equal(left, 1, 'the left glove is still drawn');
  return `an 80° turn was seen in ${between} steps without going back (largest step ${biggest.toFixed(1)}°); untracked hand not drawn`;
});

await test('a pupil starts the ride for both with a finger on the seat screen', async () => {
  const before = await A.evaluate(rideState);
  assert.deepEqual(before.buttons, ['play', 'comfort'], 'without a teacher the seat screen has a Start button');
  const target = await A.evaluate(panelTarget, 'play');
  await A.setHead({ position: [0, 1.22, 0], yawDeg: 0, pitchDeg: -25 });
  // A pointing hand near the screen, to learn where its fingertip is.
  await A.setHand('right', { position: [target.hover[0], target.hover[1] + 0.05, target.hover[2] + 0.22], yawDeg: 0, pitchDeg: -20, rollDeg: 0, pose: 'point' });
  const hand = await until(async () => { const o = await A.evaluate(ownInBus); return o.hands.right && o.hands.right.tipOwn && o.hands.right; }, 'the pointing hand is tracked');
  const reach = sub(hand.tipOwn, hand.wristOwn);
  await A.setHand('right', { position: sub(target.hover, reach) });
  await A.waitFrames(3);
  await A.screenshot(join(OUT, 'seat3-finger-at-start-button.png'));
  await A.setHand('right', { position: sub(target.press, reach) });
  await until(async () => (await A.evaluate(rideState)).playing, 'the ride runs in the headset that pressed Start', 20_000);
  await until(async () => (await B.evaluate(rideState)).playing, 'the ride runs in the other headset', 20_000);
  await A.setHand('right', { position: sub(target.hover, reach) });
  await A.waitFrames(2);
  await A.setHand('right', null);
  return 'the fingertip touched "Start" in seat 3; the ride started in both headsets';
});

await test('both headsets show the same moment of the ride', async () => {
  await sleep(1500);
  const gaps = [];
  for (let i = 0; i < 7; i++) {
    const [a, b] = await Promise.all([A.evaluate(rideState), B.evaluate(rideState)]);
    assert.ok(a.playing && b.playing);
    gaps.push(Math.abs((a.t - b.t) * 1000 - (a.at - b.at)));
    await sleep(300);
  }
  const typical = median(gaps);
  // A loose limit: when every frame is drawn in software, the pages run at
  // a few frames a second, which delays their clock messages. The network
  // test (net-clients.mjs) measures the clock itself.
  assert.ok(typical < 250, `ride times ${typical.toFixed(0)} ms apart`);

  // Seat 4 pauses on its seat screen: both stop at exactly the same time.
  await B.evaluate(() => window.marsbus.panel.press('pause'));
  await until(async () => !(await A.evaluate(rideState)).playing && !(await B.evaluate(rideState)).playing, 'both paused', 20_000);
  await A.waitFrames(3);
  await B.waitFrames(3);
  const [a, b] = await Promise.all([A.evaluate(rideState), B.evaluate(rideState)]);
  assert.ok(Math.abs(a.t - b.t) < 1e-6, `paused at ${a.t} and ${b.t}`);
  assert.ok(dist(a.bus, b.bus) < 1e-6 && Math.abs(a.bus[3] - b.bus[3]) < 1e-9, 'the bus stands at exactly the same place in both');
  return `while driving the two ride times were ${typical.toFixed(0)} ms apart; paused, both stand at exactly t = ${a.t.toFixed(3)} s`;
});

let teacher;
await test("the teacher's page takes over: it starts, moves and pauses the ride for everyone", async () => {
  const context = await browser.newContext({ viewport: { width: 1100, height: 760 } });
  teacher = await context.newPage();
  const seen = { pageErrors: [], consoleErrors: [], warnings: [] };
  teacher.on('pageerror', (err) => seen.pageErrors.push(String(err)));
  teacher.on('console', (msg) => { if (msg.type() === 'error') seen.consoleErrors.push(msg.text()); });
  pages.push({ name: "teacher's page", errors: () => seen });
  await teacher.goto(address('control.html'));
  await teacher.waitForSelector('#c-status[data-state="online"]', { timeout: 30_000 });
  await teacher.waitForFunction(() => document.getElementById('c-count').textContent === '2 er om bord', null, { timeout: 30_000 });

  // The pupils can no longer steer.
  const a = await until(async () => { const s = await A.evaluate(rideState); return s.control && !s.canControl && s; }, 'seat 3 knows the teacher steers');
  await until(async () => (await A.evaluate(rideState)).buttons.join() === 'comfort', 'the seat screen only has the comfort button');
  await A.evaluate(() => window.marsbus.actions.play());
  await sleep(700);
  const refused = await A.evaluate(rideState);
  assert.equal(refused.playing, false, 'a pupil cannot start the ride now');
  assert.equal(refused.message, 'Læreren styrer turen');

  // Back to the start, then to a place where the bus drives, and start.
  await teacher.click('#c-reset');
  await until(async () => { const s = await B.evaluate(rideState); return !s.playing && s.t === 0; }, 'everyone back at the start');
  await until(async () => (await B.evaluate(rideState)).line === 'Venter på afgang', 'the seat screen says the bus is waiting for departure', 10_000);
  const from = await A.evaluate(drivingTime);
  assert.ok(from !== null, 'found a driving stretch');
  await teacher.evaluate((t) => {
    const scrub = document.getElementById('c-scrub');
    scrub.value = String(t);
    scrub.dispatchEvent(new Event('change'));
  }, from);
  await until(async () => Math.abs((await A.evaluate(rideState)).t - from) < 1e-6 && Math.abs((await B.evaluate(rideState)).t - from) < 1e-6, 'both moved to the chosen time');
  const parked = await A.evaluate(rideState);
  await teacher.click('#c-play');
  await until(async () => (await A.evaluate(rideState)).playing && (await B.evaluate(rideState)).playing, 'both driving');
  await sleep(3000);
  // Seat 4 looks ahead and a little to the left, seat 3 points out of the window.
  await A.setHead({ position: [0, 1.22, 0], yawDeg: 30, pitchDeg: 0 });
  await A.setHand('right', { position: [0.05, 1.12, -0.42], yawDeg: 50, pitchDeg: 8, rollDeg: -20, pose: 'point' });
  await A.setHand('left', { position: [-0.18, 0.74, -0.28], yawDeg: 10, pitchDeg: -20 });
  await B.setHead({ position: [0, 1.2, 0], yawDeg: 48, pitchDeg: -4 });
  await sleep(800);
  await B.waitFrames(3);
  await B.screenshot(join(OUT, 'driving-seat4-sees-seat3-pointing.png'));
  await teacher.screenshot({ path: join(OUT, 'teachers-page.png') });
  await teacher.click('#c-play');
  await until(async () => !(await A.evaluate(rideState)).playing && !(await B.evaluate(rideState)).playing, 'both paused by the teacher');
  await A.waitFrames(3);
  await B.waitFrames(3);
  const [x, y] = await Promise.all([A.evaluate(rideState), B.evaluate(rideState)]);
  assert.ok(Math.abs(x.t - y.t) < 1e-6, `paused at ${x.t} and ${y.t}`);
  assert.ok(x.t > from + 2, 'the ride moved on');
  assert.ok(dist(x.bus, y.bus) < 1e-6, 'the bus is at exactly the same place in both');
  const moved = dist(x.bus, parked.bus);
  assert.ok(moved > 4, `the bus drove ${moved.toFixed(1)} m`);
  return `pupils' screens lost their Start button ("${refused.message}"); the teacher moved everyone to ${from} s, started and paused: `
    + `both headsets stopped at t = ${x.t.toFixed(3)} s after driving ${moved.toFixed(1)} m (rtt ${Math.round(a.rtt ?? 0)} ms)`;
});

await test('a passenger who takes the headset off disappears from the others', async () => {
  await A.exitVR();
  await until(async () => { const s = await B.evaluate(drawnInBus, 3); return !s.head && s.gloves.length === 0; }, 'seat 3 is no longer drawn', 20_000);
  // ... and is back when the headset goes on again.
  await A.enterVR();
  await A.setHead({ position: [0, 1.22, 0], yawDeg: 0, pitchDeg: 0 });
  await until(async () => { const c = await compare(A, B, 3); return c.ok; }, 'seat 3 is drawn again in the right place');
  const [x, y] = await Promise.all([A.evaluate(rideState), B.evaluate(rideState)]);
  assert.ok(Math.abs(x.t - y.t) < 1e-6, 'back at the same moment of the ride as the others');
  return 'gone a few seconds after leaving VR; back in the right place, at the same moment of the ride, after entering again';
});

if (A) await A.close();
if (B) await B.close();

// --- 2. A full bus ------------------------------------------------------------------

await test('a full bus: one headset and nine robot passengers', async () => {
  const seats = [1, 3, 4, 5, 6, 7, 8, 9, 10];
  const bots = await startBots({ relay: RELAY, room, seats });
  try {
    const C = await openHeadset(browser, address('', '&seat=2&speak=0'), headsetOptions('seat 2'));
    pages.push(C);
    await C.enterVR();
    await C.waitFrames(14);
    await until(async () => (await C.evaluate(rideState)).peers.length === 10, 'ten on board');
    const drawn = await until(async () => {
      const all = await Promise.all(seats.map((seat) => C.evaluate(drawnInBus, seat)));
      return all.every((s) => s.head) && all[0];
    }, 'all nine helmets drawn');
    assert.equal(drawn.helmets, 9);
    assert.ok(drawn.gloves.length >= 9, `${drawn.gloves.length} gloves drawn`);
    if (teacher) {
      await teacher.waitForFunction(() => document.getElementById('c-count').textContent === '10 er om bord', null, { timeout: 30_000 });
      await teacher.screenshot({ path: join(OUT, 'teachers-page-full-bus.png') });
    }
    // Look back over the left shoulder at the whole bus, then ahead.
    await C.setHead({ position: [0, 1.22, 0], yawDeg: 152, pitchDeg: -6 });
    await sleep(500);
    await C.waitFrames(3);
    await C.screenshot(join(OUT, 'full-bus-looking-back.png'));
    await C.setHead({ yawDeg: 40, pitchDeg: -4 });
    await sleep(500);
    await C.waitFrames(3);
    await C.screenshot(join(OUT, 'full-bus-looking-ahead-left.png'));
    const speed = await C.measureFps(4);
    const cost = await C.evaluate(() => {
      const { network } = window.marsbus;
      const t0 = performance.now();
      for (let i = 0; i < 3000; i++) network.passengers(performance.now());
      return (performance.now() - t0) / 3000;
    });
    assert.ok(cost < 0.5, `preparing the passengers takes ${cost.toFixed(3)} ms a frame`);
    await C.close();
    return `10 on board, 9 helmets and ${drawn.gloves.length} gloves drawn; preparing the nine passengers takes ${(cost * 1000).toFixed(0)} microseconds a frame here `
      + `(the site's own code for a whole frame: ${speed.callbackMsPerFrame} ms, at ${speed.fps} frames a second on this machine without a graphics card)`;
  } finally {
    bots.stop();
  }
});

await test('no errors in any page', async () => {
  const lines = [];
  for (const page of pages) {
    const e = page.errors();
    for (const text of [...e.pageErrors, ...e.consoleErrors]) lines.push(`${page.name}: ${text}`);
  }
  assert.equal(lines.length, 0, `\n${lines.join('\n')}`);
  const warnings = new Set(pages.flatMap((page) => page.errors().warnings));
  return warnings.size ? `warnings only: ${[...warnings].map((w) => w.slice(0, 90)).join(' | ')}` : 'no warnings either';
});

if (teacher) await teacher.context().close();
await browser.close();
await server.close();
await writeFile(join(OUT, 'sim-vr-results.json'), JSON.stringify({ relay: RELAY, gl: GL, render: RENDER, fps: FPS, results }, null, 2));
const passed = results.length - failed;
console.log(`\n${passed} passed, ${failed} failed. Pictures in ${OUT}`);
process.exit(failed ? 1 : 0);
