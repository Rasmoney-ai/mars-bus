// What happens to a running ride when the relay goes away and comes back
// (Cloudflare restarts it now and then, and a network can drop out)?
//
//   node tests/shared-ride/relay-restart.mjs [port]
//
// Starts the real relay locally (relay/, `npm install` done there), lets
// three passengers and a teacher ride, stops the relay in the middle of the
// ride, starts it again and checks that everyone comes back by themselves:
// same seats, the ride still running, and the ride time where it should be,
// without a jump.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

globalThis.location = { hostname: 'localhost' };
const { createNetwork } = await import('../../src/network.js');

const HERE = dirname(fileURLToPath(import.meta.url));
const RELAY_DIR = resolve(HERE, '../../relay');
const PORT = Number(process.argv[2] || 8793);
const RELAY = `ws://localhost:${PORT}`;
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

async function until(check, what, ms = 30_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await sleep(50);
  }
  throw new Error(`timed out waiting for: ${what}`);
}

const state = await mkdtemp(join(tmpdir(), 'mars-bus-relay-'));
let relay = null;

async function startRelay() {
  relay = spawn('npx', ['wrangler', 'dev', '--port', String(PORT), '--inspector-port', String(PORT + 1000), '--persist-to', state], {
    cwd: RELAY_DIR, stdio: 'ignore', detached: true,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' },
  });
  await until(async () => {
    try { return (await fetch(`http://localhost:${PORT}/`)).ok; } catch { return false; }
  }, 'the relay to answer', 60_000);
}

async function stopRelay() {
  // The whole process group: wrangler and the runtime it started.
  try { process.kill(-relay.pid, 'SIGKILL'); } catch { /* already gone */ }
  await until(async () => {
    try { await fetch(`http://localhost:${PORT}/`); return false; } catch { return true; }
  }, 'the relay to be gone');
}

let failed = false;
try {
  await startRelay();
  const room = `restart-${Math.random().toString(36).slice(2, 8)}`;
  const join_ = (role, seat) => createNetwork({ params: new URLSearchParams({ room, relay: RELAY }), role, seat, duration: 600 });
  const riders = [join_('rider', 2), join_('rider', 5), join_('rider', 9)];
  const teacher = join_('control', null);
  const all = [...riders, teacher];
  all.forEach((n) => n.setActive(true));
  await until(() => riders.every((n, i) => n.seat === [2, 5, 9][i]) && teacher.status === 'online', 'everyone on board');
  teacher.clock.seek(100);
  teacher.clock.play();
  await until(() => all.every((n) => n.clock.playing && n.clock.getTime() >= 100), 'everyone riding from 1:40');
  await sleep(2500);

  // The true ride time: a plain stopwatch started now.
  const t0 = teacher.clock.getTime(), at0 = performance.now();
  const truth = () => t0 + (performance.now() - at0) / 1000;
  const worst = () => Math.max(...all.map((n) => Math.abs(n.clock.getTime() - truth()))) * 1000;

  await stopRelay();
  console.log('relay stopped in the middle of the ride');
  await until(() => all.every((n) => n.status !== 'online'), 'everyone notices the lost connection');
  await sleep(3000);
  // Meanwhile the ride goes on in every headset by its own clock.
  assert.ok(all.every((n) => n.clock.playing), 'the ride keeps running without the relay');
  const offline = worst();
  assert.ok(offline < 50, `without the relay the ride times drifted ${offline.toFixed(0)} ms`);

  // Follow the ride time closely from now on: it must never jump.
  let jump = 0, last = all.map((n) => n.clock.getTime()), lastAt = performance.now();
  const watch = setInterval(() => {
    const now = performance.now();
    all.forEach((n, i) => {
      const t = n.clock.getTime();
      jump = Math.max(jump, Math.abs((t - last[i]) - (now - lastAt) / 1000));
      last[i] = t;
    });
    lastAt = now;
  }, 20);

  await startRelay();
  console.log('relay started again');
  await until(() => all.every((n) => n.status === 'online'), 'everyone is back online', 40_000);
  await until(() => riders.every((n, i) => n.seat === [2, 5, 9][i]) && riders[0].peers.join() === '2,5,9', 'everyone has their old seat');
  await sleep(4000);
  clearInterval(watch);
  assert.ok(all.every((n) => n.clock.playing), 'the ride is still running');
  const after = worst();
  assert.ok(after < 50, `after the restart the ride times are ${after.toFixed(0)} ms from where they should be`);
  assert.ok(jump < 0.05, `a ride time jumped by ${(jump * 1000).toFixed(0)} ms`);
  assert.equal(riders[0].control, true, 'the teacher is back too');

  // And the controls work again.
  teacher.clock.pause();
  await until(() => all.every((n) => !n.clock.playing), 'paused by the teacher');
  const times = all.map((n) => n.clock.getTime());
  assert.ok(Math.max(...times) - Math.min(...times) < 1e-6, 'paused at exactly the same time');
  all.forEach((n) => n.close());
  console.log(`ok    the ride survived a relay restart: ride times at most ${offline.toFixed(0)} ms off while it was away, `
    + `${after.toFixed(0)} ms off afterwards, largest jump ${(jump * 1000).toFixed(0)} ms; everyone kept their seat`);
} catch (err) {
  failed = true;
  console.log(`FAIL  ${err && err.stack ? err.stack : err}`);
} finally {
  if (relay) { try { process.kill(-relay.pid, 'SIGKILL'); } catch { /* gone */ } }
  await rm(state, { recursive: true, force: true }).catch(() => {});
}
process.exit(failed ? 1 : 0);
