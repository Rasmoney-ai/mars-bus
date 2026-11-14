// Integration tests: the real Worker in the local workerd runtime, spoken to
// over real WebSockets, checked against ../PROTOCOL.md.
//
//   node --test test/protocol.mjs
//
// The test starts its own relay on a free port and stops it afterwards. To
// test a relay that is already running (also a deployed one), name it:
//
//   RELAY_URL=ws://127.0.0.1:8787 node --test test/protocol.mjs

import { test, describe, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { relayUnderTest, Bot, httpGet, upgradeHeaders, randomId, sleep } from './helpers.mjs';

let relay;
const bots = [];

before(async () => {
  relay = await relayUnderTest();
});

afterEach(async () => {
  await Promise.all(bots.splice(0).map((bot) => bot.close()));
});

after(async () => {
  await relay.stop();
});

// Every test gets its own room.
const newRoom = () => randomId('t-');

async function join(room, options) {
  const bot = await Bot.join(relay.url, room, options);
  bots.push(bot);
  return bot;
}

async function open(room) {
  const bot = await Bot.open(relay.url, room);
  bots.push(bot);
  return bot;
}

// Waits until everything the relay has sent so far has arrived: first at
// the bot that acted, then at the others. (A pong comes after everything
// the relay sent to that bot before it.)
async function settle(actor, ...others) {
  await actor.ping();
  await Promise.all(others.map((bot) => bot.ping()));
}

// The bot got an "error" with this code and the socket closed with 4000.
async function assertFailed(bot, code) {
  const error = await bot.next('error');
  assert.equal(error.code, code);
  assert.equal(typeof error.message, 'string');
  assert.deepEqual(await bot.closed(), { code: 4000, reason: code });
}

const handshake = (path, headers = {}) => httpGet(`${relay.httpUrl}${path}`, upgradeHeaders(headers));

describe('endpoint', () => {
  test('GET / is the health check', async () => {
    assert.deepEqual(await httpGet(`${relay.httpUrl}/`), { status: 200, body: 'mars-bus relay ok' });
  });

  test('a room without a WebSocket upgrade answers 426', async () => {
    assert.equal((await httpGet(`${relay.httpUrl}/room/${newRoom()}`)).status, 426);
  });

  test('a room name that does not match ^[a-z0-9-]{1,32}$ answers 400', async () => {
    for (const name of ['bad_name', 'a.b', 'a%20b', 'a/b', '%C3%A6', 'x'.repeat(33), '']) {
      assert.equal((await handshake(`/room/${name}`)).status, 400, `room "${name}"`);
    }
  });

  test('room names of 1 and of 32 characters are fine', async () => {
    assert.equal((await handshake('/room/7')).status, 101);
    assert.equal((await handshake(`/room/${'a-1'.repeat(10)}xy`)).status, 101);
  });

  test('the room name is lower-cased', async () => {
    const room = newRoom();
    await join(room.toUpperCase(), { seat: 6 });
    const b = await join(room);
    assert.deepEqual(b.welcome.peers, [6]);
  });

  test('other paths answer 404, other methods 405', async () => {
    assert.equal((await httpGet(`${relay.httpUrl}/rooms`)).status, 404);
    assert.equal((await httpGet(`${relay.httpUrl}/room`)).status, 404);
    assert.equal((await httpGet(`${relay.httpUrl}/`, {}, { method: 'POST' })).status, 405);
  });
});

describe('origin check', () => {
  test('a foreign Origin answers 403', async () => {
    const room = newRoom();
    const foreign = [
      'https://evil.example',
      'https://rasmoney-ai.github.io.evil.example',
      'http://rasmoney-ai.github.io',          // http, not https
      'https://rasmoney-ai.github.io:8443',    // no port allowed for this entry
      'http://localhost.evil.example',
      'http://localhost:8000.evil.example',
      'http://localhost:80a',
      'https://localhost:8000',                // https, not http
      'http://127.0.0.1.evil.example:8000',
      'null',
    ];
    for (const origin of foreign) {
      const res = await handshake(`/room/${room}`, { Origin: origin });
      assert.equal(res.status, 403, `Origin: ${origin}`);
    }
  });

  test('the site, localhost and 127.0.0.1 on any port are allowed', async () => {
    const room = newRoom();
    const allowed = [
      'https://rasmoney-ai.github.io',
      'http://localhost:8000',
      'http://localhost:5500',
      'http://localhost',
      'http://127.0.0.1:8191',
      'http://127.0.0.1',
    ];
    for (const origin of allowed) {
      const res = await handshake(`/room/${room}`, { Origin: origin });
      assert.equal(res.status, 101, `Origin: ${origin}`);
    }
  });

  test('a request without an Origin header is allowed', async () => {
    assert.equal((await handshake(`/room/${newRoom()}`)).status, 101);
  });

  test('the check also covers the health check', async () => {
    assert.equal((await httpGet(`${relay.httpUrl}/`, { Origin: 'https://evil.example' })).status, 403);
    assert.equal((await httpGet(`${relay.httpUrl}/`, { Origin: 'http://localhost:8000' })).status, 200);
  });
});

describe('hello', () => {
  test('welcome answers hello', async () => {
    const a = await join(newRoom(), { seat: 3 });
    const w = a.welcome;
    assert.deepEqual(Object.keys(w).sort(), ['control', 'now', 'peers', 'ride', 'seat', 't', 'v']);
    assert.equal(w.v, 1);
    assert.ok(Number.isInteger(w.now) && w.now > 1.6e12, 'now is server ms');
    assert.equal(w.seat, 3);
    assert.deepEqual(w.peers, [3], 'peers includes the receiver\'s own seat');
    assert.equal(w.control, false);
    assert.deepEqual(Object.keys(w.ride).sort(), ['at', 'base', 'playing', 'rev']);
    assert.equal(w.ride.playing, false);
    assert.equal(w.ride.base, 0);
    assert.equal(w.ride.rev, 0);
    assert.deepEqual(await a.next('peers'), { t: 'peers', peers: [3], control: false });
  });

  test('the first message must be hello', async () => {
    const a = await open(newRoom());
    a.send({ t: 'ping', c: 1 });
    await assertFailed(a, 'hello');
  });

  test('a wrong version is refused', async () => {
    const a = await open(newRoom());
    a.send({ t: 'hello', v: 2, client: randomId(), role: 'rider', seat: null });
    await assertFailed(a, 'version');
  });

  test('a hello with invalid fields is refused', async () => {
    const a = await open(newRoom());
    a.send({ t: 'hello', v: 1, client: 'short', role: 'rider', seat: null });
    await assertFailed(a, 'bad');
  });

  test('hello twice is refused', async () => {
    const a = await join(newRoom());
    a.send({ t: 'hello', v: 1, client: a.client, role: 'rider', seat: null });
    await assertFailed(a, 'hello');
  });
});

describe('message validation', () => {
  test('bad JSON is refused', async () => {
    const room = newRoom();
    const a = await join(room, { seat: 1 });
    const b = await join(room, { seat: 2 });
    await settle(a, b);
    b.take('peers');
    a.sendRaw('{"t":"ping","c":');
    await assertFailed(a, 'bad');
    // The room goes on without it.
    assert.deepEqual(await b.next('peers'), { t: 'peers', peers: [2], control: false });
    assert.equal((await b.ping()).t, 'pong');
  });

  test('an unknown message type is refused', async () => {
    const a = await join(newRoom());
    a.send({ t: 'bogus' });
    await assertFailed(a, 'bad');
  });

  test('a malformed seat request is refused', async () => {
    const a = await join(newRoom());
    a.send({ t: 'seat', seat: 11 });
    await assertFailed(a, 'bad');
  });

  test('a binary frame is refused', async () => {
    const a = await join(newRoom());
    a.sendRaw(new Uint8Array([1, 2, 3]));
    await assertFailed(a, 'bad');
  });

  test('a message of 2048 bytes passes, an oversized one is refused', async () => {
    const padded = (bytes) => {
      const text = JSON.stringify({ t: 'ping', c: 1, pad: '' });
      return text.replace('""', `"${'x'.repeat(bytes - text.length)}"`);
    };
    const a = await join(newRoom());
    a.sendRaw(padded(2048));
    assert.equal((await a.next('pong')).c, 1);
    a.sendRaw(padded(2049));
    await assertFailed(a, 'size');

    const b = await join(newRoom());
    b.sendRaw(JSON.stringify({ t: 'pose', d: [1], pad: 'x'.repeat(50_000) }));
    await assertFailed(b, 'size');
  });
});

describe('seats and peers', () => {
  test('a taken seat is refused, in hello and in a seat request', async () => {
    const room = newRoom();
    const a = await join(room, { seat: 5 });
    const b = await join(room, { seat: 5 });
    assert.equal(b.welcome.seat, null);
    assert.deepEqual(b.welcome.peers, [5]);

    b.send({ t: 'seat', seat: 5 });
    assert.deepEqual(await b.next('seat'), { t: 'seat', seat: null, ok: false });
    b.send({ t: 'seat', seat: 6 });
    assert.deepEqual(await b.next('seat'), { t: 'seat', seat: 6, ok: true });
    b.send({ t: 'seat', seat: 5 });
    assert.deepEqual(await b.next('seat'), { t: 'seat', seat: 6, ok: false }, 'the asker keeps its own seat');
    b.send({ t: 'seat', seat: 6 });
    assert.deepEqual(await b.next('seat'), { t: 'seat', seat: 6, ok: true }, 'asking again is fine');
    assert.equal((await a.ping()).t, 'pong');
  });

  test('peers is sent to everyone when a seat is taken or freed or a control page comes or goes', async () => {
    const room = newRoom();
    const a = await join(room, { seat: 2 });
    assert.deepEqual(await a.next('peers'), { t: 'peers', peers: [2], control: false });

    const b = await join(room, { seat: 9 });
    assert.deepEqual(b.welcome.peers, [2, 9]);
    assert.deepEqual(await a.next('peers'), { t: 'peers', peers: [2, 9], control: false });
    assert.deepEqual(await b.next('peers'), { t: 'peers', peers: [2, 9], control: false });

    const teacher = await join(room, { role: 'control', seat: 4 });
    assert.equal(teacher.welcome.seat, null, 'a control page never holds a seat');
    assert.equal(teacher.welcome.control, true);
    for (const bot of [a, b, teacher]) {
      assert.deepEqual(await bot.next('peers'), { t: 'peers', peers: [2, 9], control: true });
    }

    b.send({ t: 'seat', seat: 1 });   // moves
    for (const bot of [a, b, teacher]) {
      assert.deepEqual(await bot.next('peers'), { t: 'peers', peers: [1, 2], control: true });
    }
    b.send({ t: 'seat', seat: null }); // gives up the seat
    assert.deepEqual(await b.next('seat'), { t: 'seat', seat: 1, ok: true });
    assert.deepEqual(await b.next('seat'), { t: 'seat', seat: null, ok: true });
    for (const bot of [a, b, teacher]) {
      assert.deepEqual(await bot.next('peers'), { t: 'peers', peers: [2], control: true });
    }

    await teacher.close();            // the control page goes
    for (const bot of [a, b]) {
      assert.deepEqual(await bot.next('peers'), { t: 'peers', peers: [2], control: false });
    }
    await a.close();                  // a closed connection frees its seat
    assert.deepEqual(await b.next('peers'), { t: 'peers', peers: [], control: false });

    // Nothing else was sent.
    await settle(b);
    assert.deepEqual(b.take('peers'), []);
  });

  test('a rider without a seat coming or going is not announced', async () => {
    const room = newRoom();
    const a = await join(room, { seat: 2 });
    await a.next('peers');
    const b = await join(room);
    assert.equal(b.welcome.seat, null);
    await settle(b, a);
    await b.close();
    await settle(a);
    assert.deepEqual(a.take('peers'), []);
    assert.deepEqual(b.take('peers'), []);
  });

  test('the same client connecting again: the old socket closes with 4001, the seat is kept', async () => {
    const room = newRoom();
    const client = randomId('same-');
    const old = await join(room, { seat: 3, client });
    const other = await join(room, { seat: 4 });
    await settle(other, old);
    other.take('peers');

    const fresh = await join(room, { seat: 3, client });
    assert.deepEqual(await old.closed(), { code: 4001, reason: 'replaced' });
    assert.deepEqual(old.take('error'), [], 'no error message before 4001');
    assert.equal(fresh.welcome.seat, 3);
    assert.deepEqual(fresh.welcome.peers, [3, 4]);

    // The others never saw the seat free.
    await settle(fresh, other);
    assert.deepEqual(other.take('peers'), []);
    other.send({ t: 'seat', seat: 3 });
    assert.deepEqual(await other.next('seat'), { t: 'seat', seat: 4, ok: false });

    // A new hello without a seat keeps the seat too.
    const third = await join(room, { seat: null, client });
    assert.deepEqual(await fresh.closed(), { code: 4001, reason: 'replaced' });
    assert.equal(third.welcome.seat, 3);
  });

  test('a holder silent for 15 s loses the seat to an asker and stays connected', { timeout: 40_000 }, async () => {
    const room = newRoom();
    const holder = await join(room, { seat: 3 });
    const heardAt = holder.welcome.now; // the holder's last message, in server ms
    const asker = await join(room);
    await holder.next('peers');

    // The asker pings once a second (which also keeps the relay awake)
    // and watches the relay's clock.
    let serverNow = (await asker.ping()).s;
    while (serverNow - heardAt < 12_500) {
      await sleep(1000);
      serverNow = (await asker.ping()).s;
    }
    asker.send({ t: 'seat', seat: 3 });
    assert.deepEqual(await asker.next('seat'), { t: 'seat', seat: null, ok: false }, 'silent for less than 15 s');

    while (serverNow - heardAt < 15_000) {
      await sleep(500);
      serverNow = (await asker.ping()).s;
    }
    asker.send({ t: 'seat', seat: 3 });
    assert.deepEqual(await asker.next('seat'), { t: 'seat', seat: 3, ok: true }, 'silent for 15 s');
    assert.deepEqual(await holder.next('seat'), { t: 'seat', seat: null, ok: false });
    assert.equal((await holder.ping()).t, 'pong', 'the old holder is still connected');
    holder.send({ t: 'seat', seat: 4 });
    assert.deepEqual(await holder.next('seat'), { t: 'seat', seat: 4, ok: true });
  });
});

describe('who may control', () => {
  test('a rider may only while no control page is connected', async () => {
    const room = newRoom();
    const rider = await join(room, { seat: 1 });
    const other = await join(room);

    rider.send({ t: 'cmd', op: 'play' });
    const first = await rider.next('ride');
    assert.equal(first.playing, true);
    assert.deepEqual(await other.next('ride'), first);

    const teacher = await join(room, { role: 'control' });
    assert.deepEqual(teacher.welcome.ride, { playing: true, base: 0, at: first.at, rev: first.rev });
    await settle(teacher, rider, other);
    for (const [op, extra] of [['pause', {}], ['play', {}], ['restart', {}], ['seek', { time: 30 }]]) {
      rider.send({ t: 'cmd', op, ...extra });
      assert.deepEqual(await rider.next('denied'), { t: 'denied', op });
    }
    await settle(rider, other, teacher);
    for (const bot of [rider, other, teacher]) assert.deepEqual(bot.take('ride'), [], 'the clock did not change');

    teacher.send({ t: 'cmd', op: 'pause' });
    const paused = await teacher.next('ride');
    assert.equal(paused.playing, false);
    assert.equal(paused.rev, first.rev + 1);
    assert.deepEqual(await rider.next('ride'), paused);
    assert.deepEqual(await other.next('ride'), paused);

    await teacher.close();
    assert.deepEqual(await rider.next('peers'), { t: 'peers', peers: [1], control: false });
    other.send({ t: 'cmd', op: 'play' }); // a rider without a seat may too
    assert.equal((await other.next('ride')).rev, first.rev + 2);
    assert.equal((await rider.next('ride')).rev, first.rev + 2);
  });
});

describe('the ride clock', () => {
  test('play, pause, seek and restart: the arithmetic of PROTOCOL.md', async () => {
    const room = newRoom();
    const teacher = await join(room, { role: 'control' });
    const rider = await join(room, { seat: 1 });
    let rev = teacher.welcome.ride.rev;

    // Sends a command and returns the "ride" message everyone got, with the
    // relay's clock just before and just after it.
    const cmd = async (op, time) => {
      const before = (await teacher.ping()).s;
      teacher.send(time === undefined ? { t: 'cmd', op } : { t: 'cmd', op, time });
      const ride = await teacher.next('ride');
      const afterwards = (await teacher.ping()).s;
      assert.deepEqual(await rider.next('ride'), ride, 'everyone gets the same message');
      assert.deepEqual(Object.keys(ride).sort(), ['at', 'base', 'playing', 'rev', 't']);
      rev += 1;
      assert.equal(ride.rev, rev, 'rev goes up by one');
      return { ride, before, afterwards };
    };
    const between = (value, low, high, what) => {
      assert.ok(value >= low && value <= high, `${what}: ${value} is not in ${low}..${high}`);
    };
    // Commands that change nothing give no "ride" message.
    const noChange = async (op) => {
      teacher.send({ t: 'cmd', op });
      await settle(teacher, rider);
      assert.deepEqual(teacher.take('ride'), []);
      assert.deepEqual(rider.take('ride'), []);
    };

    // seek while paused: base = time, at = now, playing unchanged
    let r = await cmd('seek', 100);
    assert.equal(r.ride.playing, false);
    assert.equal(r.ride.base, 100);
    between(r.ride.at, r.before, r.afterwards, 'at = now');
    await noChange('pause');

    // play: playing = true, at = now
    r = await cmd('play');
    assert.equal(r.ride.playing, true);
    assert.equal(r.ride.base, 100);
    between(r.ride.at, r.before, r.afterwards, 'at = now');
    const playedAt = r.ride.at;
    await noChange('play');

    // pause: base = ride time, playing = false
    await sleep(1200);
    r = await cmd('pause');
    assert.equal(r.ride.playing, false);
    assert.equal(r.ride.at, playedAt, 'at is not touched by pause');
    between(r.ride.base, 100 + (r.before - playedAt) / 1000, 100 + (r.afterwards - playedAt) / 1000, 'base = ride time');
    assert.ok(r.ride.base >= 101.2 && r.ride.base < 103, `about 1.2 s were ridden: ${r.ride.base}`);
    const pausedBase = r.ride.base;

    // play again continues from there
    r = await cmd('play');
    assert.equal(r.ride.base, pausedBase);
    between(r.ride.at, r.before, r.afterwards, 'at = now');

    // seek while playing: playing unchanged
    r = await cmd('seek', 10.5);
    assert.equal(r.ride.playing, true);
    assert.equal(r.ride.base, 10.5);
    between(r.ride.at, r.before, r.afterwards, 'at = now');

    // seek clamps to 0..86400
    assert.equal((await cmd('seek', -5)).ride.base, 0);
    assert.equal((await cmd('seek', 1e9)).ride.base, 86_400);

    // restart: base = 0, at = now, playing = true (also from paused)
    await cmd('pause');
    r = await cmd('restart');
    assert.equal(r.ride.playing, true);
    assert.equal(r.ride.base, 0);
    between(r.ride.at, r.before, r.afterwards, 'at = now');

    // A newcomer gets the clock in welcome.
    const late = await join(room);
    assert.deepEqual({ t: 'ride', ...late.welcome.ride }, r.ride);
  });

  test('a malformed command is refused', async () => {
    const a = await join(newRoom());
    a.send({ t: 'cmd', op: 'seek' });
    await assertFailed(a, 'bad');
  });
});

describe('clock sync', () => {
  test('pong echoes c untouched and gives the relay\'s clock', async () => {
    const a = await join(newRoom());
    const sent = [0, -1.5, 123456.789012345, performance.now()];
    for (const c of sent) a.send({ t: 'ping', c });
    const pongs = [];
    for (let i = 0; i < sent.length; i++) pongs.push(await a.next('pong'));
    assert.deepEqual(pongs.map((p) => p.c), sent);
    for (const pong of pongs) {
      assert.deepEqual(Object.keys(pong).sort(), ['c', 's', 't']);
      assert.ok(Number.isInteger(pong.s) && pong.s >= a.welcome.now, 's is server ms');
    }
    // The relay's clock moves on.
    await sleep(300);
    const later = await a.ping();
    assert.ok(later.s - pongs[0].s >= 250 && later.s - pongs[0].s < 2000, `${later.s - pongs[0].s} ms later`);
  });
});

describe('poses', () => {
  test('a pose goes to all the others, unchanged, and is not echoed', async () => {
    const room = newRoom();
    const a = await join(room, { seat: 3 });
    const b = await join(room, { seat: 4 });
    const noSeat = await join(room);
    const teacher = await join(room, { role: 'control' });

    const d = [0.1, 1.2345, -0.3, 0, 0.7071, 0, 0.7071, 1, -0.25, 0.9, -0.4, 0, 0, 0, 1, 2, 0.25, 0.9, -0.4, 0, 0, 0, 1];
    assert.equal(d.length, 23);
    a.send({ t: 'pose', d });
    for (const bot of [b, noSeat, teacher]) {
      assert.deepEqual(await bot.next('pose'), { t: 'pose', seat: 3, d });
    }
    await settle(a, b, noSeat, teacher);
    assert.deepEqual(a.take('pose'), [], 'not echoed to the sender');
    for (const bot of [b, noSeat, teacher]) assert.deepEqual(bot.take('pose'), [], 'forwarded once');

    // A pose from someone without a seat goes nowhere.
    noSeat.send({ t: 'pose', d });
    teacher.send({ t: 'pose', d });
    await settle(noSeat, teacher);
    await settle(a, b);
    for (const bot of [a, b, noSeat, teacher]) assert.deepEqual(bot.take('pose'), []);
  });

  test('a malformed pose is refused', async () => {
    const room = newRoom();
    const a = await join(room, { seat: 3 });
    a.send({ t: 'pose', d: Array(33).fill(0) });
    await assertFailed(a, 'bad');
    const b = await join(room, { seat: 3 });
    b.sendRaw('{"t":"pose","d":[1,null,3]}');
    await assertFailed(b, 'bad');
  });

  test('more than 40 poses in a second: the extra ones are dropped silently', async () => {
    const room = newRoom();
    const a = await join(room, { seat: 1 });
    const b = await join(room, { seat: 2 });
    for (let i = 0; i < 60; i++) a.send({ t: 'pose', d: [i] });
    await settle(a, b);
    assert.deepEqual(b.take('pose').map((m) => m.d[0]), Array.from({ length: 40 }, (_, i) => i));
    assert.deepEqual(a.take('error'), []);
    assert.ok(a.open);
    await sleep(1100);
    a.send({ t: 'pose', d: [99] });
    assert.deepEqual(await b.next('pose'), { t: 'pose', seat: 1, d: [99] });
  });
});

describe('room full', () => {
  test('the 17th connection is refused with "full" and close code 4002', async () => {
    const room = newRoom();
    const first = [];
    for (let i = 0; i < 16; i++) {
      // Riders, a control page and two that never say hello: all count.
      if (i < 13) first.push(await join(room, { seat: i < 10 ? i + 1 : null }));
      else if (i === 13) first.push(await join(room, { role: 'control' }));
      else first.push(await open(room));
    }

    const extra = await open(room);
    const error = await extra.next('error');
    assert.equal(error.code, 'full');
    assert.deepEqual(await extra.closed(), { code: 4002, reason: 'room full' });

    // The same for a client that says hello at once, as the site does.
    const eager = await open(room);
    eager.send({ t: 'hello', v: 1, client: randomId(), role: 'rider', seat: null });
    assert.equal((await eager.next('error')).code, 'full');
    assert.deepEqual(await eager.closed(), { code: 4002, reason: 'room full' });
    assert.deepEqual(eager.take('welcome'), []);

    // The room is untouched, and there is room again when someone leaves.
    assert.equal((await first[0].ping()).t, 'pong');
    await settle(first[0]);
    assert.deepEqual(first[0].take('peers').pop(), { t: 'peers', peers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], control: true });
    await first[15].close();
    const late = await join(room);
    assert.deepEqual(late.welcome.peers, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.equal(late.welcome.control, true);
  });
});
