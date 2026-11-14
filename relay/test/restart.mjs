// What must survive when the relay loses its memory (see "The ride clock"
// in ../PROTOCOL.md), tested with the real Worker in the local workerd
// runtime:
//
// 1. Hibernation. A Durable Object whose sockets are quiet for about 10 s is
//    put to sleep: the sockets stay open, the memory is gone, and the next
//    message wakes it up in a new instance. Seats, roles and the ride clock
//    must be as before.
// 2. A restart of the whole relay. All sockets are gone; the bots connect
//    again and must find the ride clock as it was.
//
//   node --test test/restart.mjs      (takes about a minute)
//
// The test always starts its own relay, because it has to restart it.

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { startRelay, Bot, randomId, sleep } from './helpers.mjs';

let relay = null;
let stateDir = null;
const room = randomId('restart-');
const clients = { a: randomId('a-'), teacher: randomId('teacher-') };
let rideBefore = null;

after(async () => {
  if (relay) await relay.stop();
  if (stateDir) rmSync(stateDir, { recursive: true, force: true });
});

// How often the room's object has started with sockets already open.
const wakeUps = () => (relay.output().match(/woke up with \d+ connection/g) || []).length;

const rideTime = (ride, now) => (ride.playing ? ride.base + (now - ride.at) / 1000 : ride.base);

describe('losing the memory', () => {
  test('hibernation: seats, roles and the ride clock are as before', { timeout: 120_000 }, async () => {
    relay = await startRelay({ keepState: true });
    stateDir = relay.stateDir;

    const silent = await Bot.join(relay.url, room, { seat: 7 }); // says hello and then nothing
    const heardAt = silent.welcome.now;
    const a = await Bot.join(relay.url, room, { seat: 3, client: clients.a });
    const b = await Bot.join(relay.url, room, { seat: 5 });
    const teacher = await Bot.join(relay.url, room, { role: 'control', client: clients.teacher });
    const quiet = await Bot.open(relay.url, room); // never says hello

    teacher.send({ t: 'cmd', op: 'seek', time: 100 });
    await teacher.next('ride');
    teacher.send({ t: 'cmd', op: 'play' });
    const ride = await teacher.next('ride');
    assert.deepEqual({ playing: ride.playing, base: ride.base }, { playing: true, base: 100 });
    await b.ping();
    for (const bot of [silent, a, b, teacher]) { bot.take('ride'); bot.take('peers'); }

    // Nobody says anything for 12.5 s: the object goes to sleep.
    const before = wakeUps();
    await sleep(12_500);
    const pong = await b.ping(); // wakes it up
    // (The relay's log line can arrive a moment after the pong.)
    for (let i = 0; i < 30 && wakeUps() === before; i++) await sleep(100);
    assert.equal(wakeUps(), before + 1, 'the object was asleep and woke up in a new instance');
    assert.match(relay.output(), /woke up with 5 connection\(s\)/);
    assert.ok(pong.s - heardAt >= 12_000);

    // A newcomer sees the room as it was.
    const d = await Bot.join(relay.url, room, { seat: 7 });
    assert.equal(d.welcome.seat, null, 'seat 7 is still held (its holder was heard 13 s ago)');
    assert.deepEqual(d.welcome.peers, [3, 5, 7]);
    assert.equal(d.welcome.control, true);
    assert.deepEqual(d.welcome.ride, { playing: true, base: 100, at: ride.at, rev: ride.rev });
    await b.ping();
    assert.deepEqual(b.take('peers'), [], 'nothing changed, so nothing was announced');

    // Roles are remembered: a rider is denied, the teacher is obeyed.
    b.send({ t: 'cmd', op: 'pause' });
    assert.deepEqual(await b.next('denied'), { t: 'denied', op: 'pause' });
    const low = (await teacher.ping()).s;
    teacher.send({ t: 'cmd', op: 'pause' });
    const paused = await teacher.next('ride');
    const high = (await teacher.ping()).s;
    assert.equal(paused.playing, false);
    assert.equal(paused.rev, ride.rev + 1);
    assert.ok(paused.base >= rideTime(ride, low) && paused.base <= rideTime(ride, high),
      `the clock ran on during the sleep: ${paused.base}`);
    assert.ok(paused.base > 112 && paused.base < 120, `about 13 s were ridden: ${paused.base}`);
    assert.deepEqual(await b.next('ride'), paused);

    // Sockets from before the sleep work in both directions.
    a.send({ t: 'pose', d: [1, 2, 3] });
    for (const bot of [b, d, teacher, silent]) {
      assert.deepEqual(await bot.next('pose'), { t: 'pose', seat: 3, d: [1, 2, 3] });
    }

    // The one that had not said hello still has to.
    quiet.send({ t: 'ping', c: 1 });
    assert.equal((await quiet.next('error')).code, 'hello');
    assert.deepEqual(await quiet.closed(), { code: 4000, reason: 'hello' });

    // A client that connects again still takes over its old connection.
    const a2 = await Bot.join(relay.url, room, { seat: null, client: clients.a });
    assert.deepEqual(await a.closed(), { code: 4001, reason: 'replaced' });
    assert.equal(a2.welcome.seat, 3);

    // The stale seat rule counts from before the sleep: the silent holder
    // of seat 7 was last heard at heardAt. The relay writes that time down
    // at most every 5 s, so after a sleep it is sure of the 15 s of silence
    // at heardAt + 20 s at the latest.
    let now = (await d.ping()).s;
    while (now - heardAt < 20_000) {
      await sleep(500);
      now = (await d.ping()).s;
    }
    d.send({ t: 'seat', seat: 7 });
    assert.deepEqual(await d.next('seat'), { t: 'seat', seat: 7, ok: true });
    assert.deepEqual(await silent.next('seat'), { t: 'seat', seat: null, ok: false });
    assert.equal((await silent.ping()).t, 'pong', 'the old holder is still connected');

    // Leave the ride playing for the restart test.
    teacher.send({ t: 'cmd', op: 'seek', time: 200 });
    await teacher.next('ride');
    teacher.send({ t: 'cmd', op: 'play' });
    rideBefore = await teacher.next('ride');
    delete rideBefore.t;
    await teacher.ping();
  });

  test('a restart of the relay: the ride clock is as before', { timeout: 120_000 }, async () => {
    assert.ok(rideBefore, 'the first test has run');

    // The relay dies in the middle of the ride and comes back.
    await relay.stop();
    relay = await startRelay({ stateDir });

    const a = await Bot.join(relay.url, room, { seat: 3, client: clients.a });
    assert.deepEqual(a.welcome.ride, rideBefore, 'nobody is sent back to the start');
    assert.equal(a.welcome.seat, 3);
    assert.deepEqual(a.welcome.peers, [3], 'the old sockets are gone');
    assert.equal(a.welcome.control, false);
    const t = rideTime(a.welcome.ride, a.welcome.now);
    assert.ok(t > 200.5 && t < 260, `the ride went on during the restart: ${t}`);

    // And the clock still works.
    const teacher = await Bot.join(relay.url, room, { role: 'control', client: clients.teacher });
    teacher.send({ t: 'cmd', op: 'pause' });
    const paused = await teacher.next('ride');
    assert.equal(paused.rev, rideBefore.rev + 1);
    assert.ok(paused.base >= t);
    await a.close();
    await teacher.close();
  });
});
