// Load test: a full bus. 10 rider bots in one room, each sending a pose of
// 23 numbers 15 times a second, plus one control bot.
//
//   node test/load.mjs            60 seconds
//   node test/load.mjs 10         10 seconds
//
// The test starts its own relay (the real Worker in the local workerd
// runtime) and measures its CPU use. With RELAY_URL=ws://... it uses a relay
// that is already running instead; its CPU use is then only measured if
// RELAY_PID names its process.
//
// Measured:
// - messages sent and received, and poses lost;
// - delivery latency: every bot adds its send time as a 24th number to the
//   pose, and every receiver compares it with its own clock (all bots run
//   in this one process, so they share a clock for this);
// - clock sync: every bot has its own, differently wrong "device clock" and
//   estimates the relay's clock from ping/pong as in PROTOCOL.md. Once a
//   second all bots say what the ride time is at the same instant; the
//   spread between their answers is what passengers would see as the buses
//   being out of step.
//
// Exit code 1 if a pose was lost, a bot was disconnected or got an error.

import os from 'node:os';
import { relayUnderTest, Bot, cpuSeconds, randomId, sleep } from './helpers.mjs';

const SECONDS = Number(process.argv[2] || 60);
const RIDERS = 10;
const HZ = 15;
const POSE_LENGTH = 23;
const PING_SECONDS = 2;      // as the site while riding
const MAX_SLEW = 0.05;       // the estimate is nudged at most 5 % fast or slow

// A bot with its own device clock and the clock sync of PROTOCOL.md.
class Passenger {
  constructor(bot, seat) {
    this.bot = bot;
    this.seat = seat;                               // null for the control bot
    this.skew = (Math.random() - 0.5) * 2e7;        // device clock: up to ±2.8 hours wrong
    this.samples = [];                              // latest ping results: { rtt, offset }
    this.offset = bot.welcome.now - this.device();  // relay clock minus device clock: a rough start
    this.target = this.offset;
    this.rough = true;
    this.slewAt = performance.now();
    this.ride = bot.welcome.ride;
    this.rtts = [];
    this.sent = { pose: 0, ping: 0, cmd: 0 };
    this.received = { pose: 0, pong: 0, ride: 0, peers: 0, other: 0 };
    this.fromSeat = new Array(11).fill(0);          // poses received, by sender seat
    this.lastStamp = new Array(11).fill(-Infinity); // to notice poses arriving out of order
    this.outOfOrder = 0;
    this.errors = [];
    bot.onMessage = (m) => this.onMessage(m);
  }

  // This bot's own (wrong) clock, in ms.
  device(t = performance.now()) {
    return t + this.skew;
  }

  // The relay's clock as this bot believes it to be at local instant t.
  serverNow(t) {
    const d = this.target - this.offset;
    if (d !== 0) {
      const step = Math.max(0, t - this.slewAt) * MAX_SLEW;
      this.offset += Math.max(-step, Math.min(step, d));
    }
    this.slewAt = t;
    return this.device(t) + this.offset;
  }

  // The ride time as this bot believes it to be at local instant t.
  rideTime(t) {
    const r = this.ride;
    return r.playing ? r.base + (this.serverNow(t) - r.at) / 1000 : r.base;
  }

  ping() {
    this.bot.send({ t: 'ping', c: this.device() });
    this.sent.ping += 1;
  }

  sendPose(d) {
    this.bot.send({ t: 'pose', d });
    this.sent.pose += 1;
  }

  onMessage(m) {
    const t = performance.now();
    if (m.t === 'pose') {
      this.received.pose += 1;
      this.fromSeat[m.seat] += 1;
      const stamp = m.d[POSE_LENGTH];
      if (stamp < this.lastStamp[m.seat]) this.outOfOrder += 1;
      this.lastStamp[m.seat] = stamp;
      latencies.push(t - stamp);
    } else if (m.t === 'pong') {
      this.received.pong += 1;
      const now = this.device(t);
      const rtt = now - m.c;
      this.rtts.push(rtt);
      this.samples.push({ rtt, offset: m.s + rtt / 2 - now });
      if (this.samples.length > 12) this.samples.shift();
      let best = this.samples[0];
      for (const s of this.samples) if (s.rtt < best.rtt) best = s;
      this.target = best.offset;
      if (this.rough || Math.abs(this.target - this.offset) > 500) {
        this.offset = this.target;
        this.slewAt = t;
      }
      this.rough = false;
    } else if (m.t === 'ride') {
      this.received.ride += 1;
      this.ride = m;
    } else if (m.t === 'peers') {
      this.received.peers += 1;
    } else {
      this.received.other += 1;
      if (m.t === 'error') this.errors.push(m.code);
    }
    return true;
  }
}

const latencies = [];
const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
const ms = (v) => `${v.toFixed(2)} ms`;
const sum = (list) => list.reduce((a, b) => a + b, 0);

const relay = await relayUnderTest();
let failed = false;
try {
  const room = randomId('load-');
  const control = new Passenger(await Bot.join(relay.url, room, { role: 'control' }), null);
  const riders = [];
  for (let seat = 1; seat <= RIDERS; seat++) {
    const bot = await Bot.join(relay.url, room, { seat });
    if (bot.welcome.seat !== seat) throw new Error(`seat ${seat} was not granted`);
    riders.push(new Passenger(bot, seat));
  }
  const everyone = [control, ...riders];

  // Clock sync as on the site: five quick pings, then one every 2 s.
  const timers = [];
  for (const p of everyone) {
    for (let i = 0; i < 5; i++) timers.push(setTimeout(() => p.ping(), i * 200 + Math.random() * 100));
    timers.push(setTimeout(() => {
      p.ping();
      timers.push(setInterval(() => p.ping(), PING_SECONDS * 1000));
    }, 1000 + Math.random() * PING_SECONDS * 1000));
  }
  await sleep(1500);

  control.bot.send({ t: 'cmd', op: 'restart' });
  control.sent.cmd += 1;
  await sleep(200);

  console.log(`Load test: ${RIDERS} riders x ${HZ} poses/s (${POSE_LENGTH} numbers) + 1 control page, ${SECONDS} s`);
  console.log(`Relay: ${relay.url}${relay.started ? ' (started for this test)' : ''}, machine: ${os.cpus().length} CPU cores`);

  const cpuBefore = relay.pid ? cpuSeconds(relay.pid) : null;
  const startedAt = performance.now();
  const endAt = startedAt + SECONDS * 1000;

  // Every rider sends on its own schedule, starting at a random moment.
  const period = 1000 / HZ;
  for (const p of riders) {
    const first = startedAt + Math.random() * period;
    let n = 0;
    const pose = new Array(POSE_LENGTH + 1).fill(0);
    const tick = () => {
      const now = performance.now();
      if (now >= endAt) return;
      // Head and both hands moving a little: every number changes, with
      // four decimals as the site sends them (about 200 bytes a pose).
      const a = now / 1000 + p.seat;
      for (let i = 0; i < POSE_LENGTH; i++) pose[i] = Math.round(Math.sin(a * (1 + i / 7) + i) * 1e4) / 1e4;
      pose[7] = 1;   // left hand: at rest
      pose[15] = 2;  // right hand: pointing
      pose[POSE_LENGTH] = Math.round(performance.now() * 1000) / 1000; // the send time
      p.sendPose(pose);
      n += 1;
      timers.push(setTimeout(tick, Math.max(0, first + n * period - performance.now())));
    };
    timers.push(setTimeout(tick, first - performance.now()));
  }

  // Once a second: what does everyone think the ride time is right now?
  const spreads = [];
  const sampler = setInterval(() => {
    const t = performance.now();
    if (t - startedAt < 3000) return; // let the clocks settle first
    const times = everyone.map((p) => p.rideTime(t) * 1000);
    spreads.push(Math.max(...times) - Math.min(...times));
  }, 1000);

  // Half way: pause and play, as a teacher might.
  await sleep(SECONDS * 500);
  control.bot.send({ t: 'cmd', op: 'pause' });
  await sleep(300);
  control.bot.send({ t: 'cmd', op: 'play' });
  control.sent.cmd += 2;

  await sleep(Math.max(0, endAt - performance.now()));
  const wall = (performance.now() - startedAt) / 1000;
  const cpuAfter = relay.pid ? cpuSeconds(relay.pid) : null;
  clearInterval(sampler);
  await sleep(1000); // let the last poses arrive
  for (const timer of timers) { clearTimeout(timer); clearInterval(timer); }

  // --- Report ---
  const sentPoses = sum(riders.map((p) => p.sent.pose));
  const expected = sentPoses * (everyone.length - 1); // each pose goes to the 9 other riders and the control page
  const receivedPoses = sum(everyone.map((p) => p.received.pose));
  const lost = expected - receivedPoses;
  const outOfOrder = sum(everyone.map((p) => p.outOfOrder));
  const sentAll = sum(everyone.map((p) => p.sent.pose + p.sent.ping + p.sent.cmd));
  const receivedAll = sum(everyone.map((p) => sum(Object.values(p.received))));
  const pings = sum(everyone.map((p) => p.sent.ping));
  const pongs = sum(everyone.map((p) => p.received.pong));
  const closed = everyone.filter((p) => !p.bot.open).length;
  const errors = everyone.flatMap((p) => p.errors);
  const rideMessages = everyone.map((p) => p.received.ride);

  latencies.sort((a, b) => a - b);
  const rtts = everyone.flatMap((p) => p.rtts).sort((a, b) => a - b);
  spreads.sort((a, b) => a - b);

  console.log('');
  console.log('Messages');
  console.log(`  sent by the bots:      ${sentAll} (${sentPoses} poses = ${(sentPoses / wall / RIDERS).toFixed(2)} per rider per second, ${pings} pings, ${control.sent.cmd} commands)`);
  console.log(`  received by the bots:  ${receivedAll} (${receivedPoses} poses, ${pongs} pongs, ${sum(rideMessages)} ride, ${sum(everyone.map((p) => p.received.peers))} peers)`);
  console.log(`  poses expected:        ${expected} (each pose to the ${everyone.length - 1} others)`);
  console.log(`  poses lost:            ${lost} (${(100 * lost / expected).toFixed(3)} %), out of order: ${outOfOrder}`);
  console.log(`  pongs missing:         ${pings - pongs}`);
  console.log('Pose delivery latency (send to receive, through the relay)');
  console.log(`  p50 ${ms(percentile(latencies, 0.5))}   p95 ${ms(percentile(latencies, 0.95))}   p99 ${ms(percentile(latencies, 0.99))}   max ${ms(latencies[latencies.length - 1])}   (${latencies.length} samples)`);
  console.log('Ping round trip');
  console.log(`  p50 ${ms(percentile(rtts, 0.5))}   p95 ${ms(percentile(rtts, 0.95))}   max ${ms(rtts[rtts.length - 1])}`);
  console.log(`Clock sync: spread between the ${everyone.length} bots' ride times at the same instant`);
  console.log(`  mean ${ms(sum(spreads) / spreads.length)}   p95 ${ms(percentile(spreads, 0.95))}   max ${ms(spreads[spreads.length - 1])}   (${spreads.length} instants)`);
  if (cpuBefore && cpuAfter) {
    const total = cpuAfter.total - cpuBefore.total;
    const workerd = cpuAfter.workerd - cpuBefore.workerd;
    const system = cpuAfter.workerdSystem === null ? null : cpuAfter.workerdSystem - cpuBefore.workerdSystem;
    const split = system === null ? '' : `, of which ${(100 * system / wall).toFixed(1)} % inside the operating system (socket reads and writes)`;
    console.log('Relay CPU during the run (100 % = one core)');
    console.log(`  workerd (the relay itself):   ${(100 * workerd / wall).toFixed(1)} %  (${workerd.toFixed(2)} CPU-s in ${wall.toFixed(1)} s${split})`);
    console.log(`  with wrangler's dev tooling:  ${(100 * total / wall).toFixed(1)} %  (${total.toFixed(2)} CPU-s)`);
  } else {
    console.log('Relay CPU: not measured (the relay was not started by this test; set RELAY_PID to measure it)');
  }

  const problems = [];
  if (lost !== 0) problems.push(`${lost} poses lost`);
  if (outOfOrder !== 0) problems.push(`${outOfOrder} poses out of order`);
  if (pings !== pongs) problems.push(`${pings - pongs} pongs missing`);
  if (closed !== 0) problems.push(`${closed} bots were disconnected`);
  if (errors.length) problems.push(`errors from the relay: ${errors.join(', ')}`);
  if (new Set(rideMessages).size !== 1 || rideMessages[0] !== 3) problems.push(`ride messages per bot: ${rideMessages.join(',')} (expected 3 each)`);
  console.log('');
  console.log(problems.length ? `FAILED: ${problems.join('; ')}` : 'OK: nothing lost, nobody disconnected');
  failed = problems.length > 0;

  await Promise.all(everyone.map((p) => p.bot.close()));
} finally {
  await relay.stop();
}
process.exit(failed ? 1 : 0);
