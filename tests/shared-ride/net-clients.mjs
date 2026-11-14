// Tests the site's own network code (src/network.js) without a browser:
// many clients in one Node process talk to a running relay.
//
//   node tests/shared-ride/net-clients.mjs [ws://localhost:8787]
//
// Checks: seats when ten join at once, an eleventh waiting for a seat, the
// shared clock (how far apart the clients' ride times are), commands and who
// may give them, smooth blending of received poses, stale passengers,
// and a duplicated tab.

import assert from 'node:assert/strict';

// The few browser globals network.js touches.
globalThis.location = { hostname: 'localhost' };

const { createNetwork, POSE_LENGTH } = await import('../../src/network.js');
const { NETWORK } = await import('../../src/config.js');

const RELAY = process.argv[2] || 'ws://localhost:8787';
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const room = () => `test-${Math.random().toString(36).slice(2, 10)}`;
const results = [];
let failed = 0;

function join(name, { role = 'rider', seat = null, duration = 600 } = {}) {
  const params = new URLSearchParams({ room: name, relay: RELAY });
  const net = createNetwork({ params, role, seat, duration });
  assert.ok(net, 'createNetwork returned null');
  return net;
}

async function until(check, what, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return;
    await sleep(20);
  }
  throw new Error(`timed out waiting for: ${what}`);
}

async function test(title, fn) {
  const started = Date.now();
  try {
    const note = await fn();
    results.push({ title, ok: true, note: note || '', ms: Date.now() - started });
    console.log(`ok    ${title}${note ? `  (${note})` : ''}`);
  } catch (err) {
    failed++;
    results.push({ title, ok: false, note: String(err && err.message ? err.message : err) });
    console.log(`FAIL  ${title}\n      ${err && err.stack ? err.stack : err}`);
  }
}

const closeAll = (list) => list.forEach((n) => n.close());

// The clients' ride times at the same instant: spread in milliseconds.
function spread(nets) {
  const times = nets.map((n) => n.clock.getTime());
  return (Math.max(...times) - Math.min(...times)) * 1000;
}

function pose({ yaw = 0, hand = null } = {}) {
  const d = new Array(POSE_LENGTH).fill(0);
  d[1] = 1.18;
  d[4] = Math.sin(yaw / 2);
  d[6] = Math.cos(yaw / 2);
  d[14] = 1; d[22] = 1;
  if (hand) {
    d[15] = hand.point ? 2 : 1;
    d[16] = hand.x; d[17] = hand.y; d[18] = hand.z;
  }
  return d;
}

const yawOf = (q) => 2 * Math.atan2(q[1], q[3]);

await test('ten riders joining at once each get their own seat', async () => {
  const name = room();
  const nets = Array.from({ length: 10 }, () => join(name));
  await until(() => nets.every((n) => n.seat !== null), 'all ten seated', 8000);
  const seats = nets.map((n) => n.seat).sort((a, b) => a - b);
  assert.deepEqual(seats, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  await until(() => nets.every((n) => n.peers.length === 10), 'everyone sees ten on board');

  // An eleventh has to wait, and gets the seat when someone leaves.
  const late = join(name);
  await until(() => late.status === 'online', 'eleventh online');
  await sleep(400);
  assert.equal(late.seat, null);
  const leaver = nets.pop();
  const freed = leaver.seat;
  leaver.close();
  await until(() => late.seat === freed, 'eleventh takes the freed seat');
  closeAll([...nets, late]);
  return `seats ${seats.join(',')}; the eleventh waited and then took seat ${freed}`;
});

await test('a wanted seat is kept; a taken seat gives the first free one', async () => {
  const name = room();
  const a = join(name, { seat: 7 });
  await until(() => a.seat === 7, 'a on seat 7');
  const b = join(name, { seat: 7 });
  await until(() => b.seat !== null, 'b seated');
  assert.equal(b.seat, 1);
  b.claimSeat(7);
  await sleep(300);
  assert.equal(b.seat, 1, 'refused: b stays where it is');
  b.claimSeat(4);
  await until(() => b.seat === 4, 'b moves to seat 4');
  await until(() => a.peers.join() === '4,7', 'a sees seats 4 and 7');
  closeAll([a, b]);
});

await test('one clock: all clients agree on the ride time', async () => {
  const name = room();
  const riders = Array.from({ length: 10 }, () => join(name));
  const teacher = join(name, { role: 'control' });
  const all = [...riders, teacher];
  await until(() => riders.every((n) => n.seat !== null) && teacher.status === 'online', 'everyone in');
  all.forEach((n) => n.setActive(true));
  await sleep(1500); // the first pings
  assert.equal(riders[0].canControl, false, 'riders may not steer while the teacher is here');
  assert.equal(teacher.canControl, true);

  let denied = 0;
  riders[0].onDenied = () => denied++;
  riders[0].clock.play();
  await sleep(200);
  assert.equal(denied, 1);
  assert.equal(teacher.clock.playing, false, 'a rider could not start the ride');

  teacher.clock.play();
  await until(() => all.every((n) => n.clock.playing), 'everyone playing');
  const spreads = [];
  for (let i = 0; i < 40; i++) {
    await sleep(100);
    spreads.push(spread(all));
  }
  const worst = Math.max(...spreads);
  assert.ok(worst < 25, `ride times differ by ${worst.toFixed(1)} ms`);
  const t = teacher.clock.getTime();
  assert.ok(t > 3.5 && t < 6, `ride time ${t}`);

  teacher.clock.pause();
  await until(() => all.every((n) => !n.clock.playing), 'everyone paused');
  assert.ok(spread(all) < 1e-6, 'paused: exactly the same time everywhere');

  teacher.clock.seek(120);
  await until(() => all.every((n) => Math.abs(n.clock.getTime() - 120) < 1e-6), 'everyone at 2:00');
  teacher.clock.play();
  await until(() => all.every((n) => n.clock.playing), 'playing again');
  await sleep(500);
  assert.ok(spread(all) < 25);
  assert.ok(teacher.clock.getTime() > 120.3);

  // The end of the ride: clamped to the duration, not playing.
  teacher.clock.seek(599.5);
  await sleep(1200);
  assert.ok(all.every((n) => n.clock.getTime() === 600 && !n.clock.playing), 'stopped at the end');
  teacher.clock.play(); // "Kør igen"
  await until(() => all.every((n) => n.clock.playing && n.clock.getTime() < 5), 'restarted');

  // The teacher leaves: now a rider may steer.
  teacher.close();
  await until(() => riders[0].canControl, 'rider may steer');
  riders[3].clock.pause();
  await until(() => riders.every((n) => !n.clock.playing), 'paused by a rider');
  closeAll(riders);
  return `ride times within ${worst.toFixed(1)} ms of each other over 4 s (11 clients)`;
});

await test('poses arrive at the right seat and are blended smoothly', async () => {
  const name = room();
  const a = join(name, { seat: 2 });
  const b = join(name, { seat: 5 });
  await until(() => a.seat === 2 && b.seat === 5 && a.peers.length === 2, 'both seated');

  // a turns its head at a steady 60 degrees per second and moves a hand.
  const speed = (60 * Math.PI) / 180;
  const start = performance.now();
  const truth = (now) => ((now - start) / 1000) * speed - 0.5;
  const sender = setInterval(() => {
    const now = performance.now();
    a.sendPose(pose({ yaw: truth(now), hand: { x: 0.2, y: 1.0 + 0.1 * Math.sin(now / 300), z: -0.3, point: true } }));
  }, 1000 / NETWORK.sendHz);
  await sleep(600);

  // b draws at about 90 frames a second.
  const errors = [];
  let worstStep = 0, last = null, frames = 0, seen = 0;
  const frameMs = 1000 / 90;
  const end = performance.now() + 2500;
  while (performance.now() < end) {
    const now = performance.now();
    const list = b.passengers(now);
    frames++;
    if (list.length) {
      seen++;
      assert.equal(list.length, 1);
      const p = list[0];
      assert.equal(p.seat, 2, 'drawn at the sender\'s seat');
      assert.equal(p.hands[0], null, 'left hand not tracked');
      assert.equal(p.hands[1].pose, 'point');
      assert.ok(Math.abs(p.hands[1].position[0] - 0.2) < 1e-3);
      const yaw = yawOf(p.head.quaternion);
      errors.push(Math.abs(yaw - truth(now - NETWORK.delayMs)) * (180 / Math.PI));
      if (last !== null) worstStep = Math.max(worstStep, Math.abs(yaw - last.yaw) / ((now - last.now) / 1000));
      last = { yaw, now };
    }
    await sleep(frameMs);
  }
  clearInterval(sender);
  assert.ok(seen > frames * 0.9, `drawn in ${seen} of ${frames} frames`);
  // How far the drawn head direction is from the true one (at 60 degrees per
  // second, 1 degree = 17 ms). The worst frame may be off by more when this
  // machine is busy and a pose is late; then the head simply waits for it.
  errors.sort((x, y) => x - y);
  const median = errors[Math.floor(errors.length / 2)];
  const p95 = errors[Math.floor(errors.length * 0.95)];
  const worst = errors[errors.length - 1];
  assert.ok(median < 0.8, `head direction typically off by ${median.toFixed(2)} degrees`);
  assert.ok(p95 < 2.5, `head direction off by ${p95.toFixed(2)} degrees in 5 % of the frames`);
  assert.ok(worst < 8, `head direction off by ${worst.toFixed(2)} degrees at worst`);
  // No jerks: never turning much faster than the real 60 degrees per second.
  const stepDeg = (worstStep * 180) / Math.PI;
  assert.ok(stepDeg < 150, `turned at up to ${stepDeg.toFixed(0)} degrees per second`);
  assert.equal(a.passengers().length, 0, 'the sender does not get its own pose back');

  // a stops sending (headset taken off): b stops drawing it after a while.
  await sleep(NETWORK.staleMs + 300);
  assert.equal(b.passengers().length, 0, 'a silent passenger is not drawn');
  assert.deepEqual(b.peers, [2, 5], 'but the seat is still taken');
  closeAll([a, b]);
  return `head direction off by ${median.toFixed(2)} degrees typically, ${p95.toFixed(2)} in the worst 5 % of frames; no jerks (at most ${stepDeg.toFixed(0)} deg/s for a 60 deg/s turn)`;
});

await test('a duplicated tab replaces the old one without a fight', async () => {
  const name = room();
  const a = join(name, { seat: 3 });
  await until(() => a.seat === 3, 'a seated');
  const b = join(name, { seat: 3 });
  b.client = a.client; // same tab id (set before the socket opens)
  await until(() => b.seat === 3 && a.status === 'replaced', 'b took over the seat');
  await sleep(1500);
  assert.equal(a.status, 'replaced', 'the old one stays away');
  assert.equal(b.status, 'online');
  assert.equal(b.seat, 3);
  closeAll([a, b]);
});

await test('a late joiner lands in the running ride', async () => {
  const name = room();
  const a = join(name);
  await until(() => a.seat !== null, 'a seated');
  a.clock.play();
  await until(() => a.clock.playing, 'playing');
  await sleep(1500);
  const b = join(name);
  await until(() => b.status === 'online' && b.clock.playing, 'b online and riding');
  await sleep(700);
  const diff = spread([a, b]);
  assert.ok(diff < 25, `late joiner is ${diff.toFixed(1)} ms off`);
  assert.ok(b.clock.getTime() > 2);
  closeAll([a, b]);
  return `the late joiner is ${diff.toFixed(1)} ms from the first rider`;
});

await test('a headset that slept (its own clock stood still) is right again within seconds', async () => {
  const name = room();
  const a = join(name);
  await until(() => a.seat !== null, 'a seated');
  a.setActive(true);
  a.clock.play();
  a.clock.seek(100);
  await until(() => a.clock.playing && a.clock.getTime() >= 100, 'playing from 1:40');
  await sleep(2500);
  // The true ride time by the relay's own clock. (Compares this machine's
  // clock with the relay's, so it is only exact with a relay on this machine.)
  const truth = () => a.clock._ride.base + (Date.now() - a.clock._ride.at) / 1000;
  const off = () => Math.abs(a.clock.getTime() - truth()) * 1000;
  const before = off();
  assert.ok(before < 60, `before the sleep the ride time is ${before.toFixed(0)} ms off`);

  // Asleep for 30 s: the page's clock stops while the relay's goes on.
  const real = performance.now.bind(performance);
  performance.now = () => real() - 30_000;
  let after;
  try {
    assert.ok(off() > 29_000, 'the stopped clock leaves the ride 30 s behind');
    await sleep(NETWORK.pingSeconds * 1000 + 1000);
    after = off();
    assert.ok(after < 60, `a few seconds after waking the ride time is still ${after.toFixed(0)} ms off`);
  } finally {
    a.close();
    delete performance.now;
  }
  return `ride time ${before.toFixed(0)} ms off before, 30 s behind on waking, ${after.toFixed(0)} ms off after the next answer from the relay`;
});

console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
