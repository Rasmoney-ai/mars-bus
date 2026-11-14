// Unit tests of the room logic (src/room-core.js) with fake connections, a
// fake clock and a fake storage. Run with: node --test test/unit.mjs
//
// The sections follow ../PROTOCOL.md.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { RoomCore, LIMITS, CLOSE, PROTOCOL_VERSION, rideTime } from '../src/room-core.js';

const START = 1_700_000_000_000; // the fake clock's first "server ms"

class FakeConn {
  constructor(id) {
    this.id = id;
    this.sent = [];       // parsed messages, oldest first
    this.closed = null;   // { code, reason } once closed
    this.saved = null;    // what the room last asked to persist
    this.broken = false;  // true: send() throws, like a dead socket
  }

  send(text) {
    if (this.broken || this.closed) throw new Error('the socket is closed');
    this.sent.push(JSON.parse(text));
  }

  close(code, reason) {
    this.closed = { code, reason };
  }

  persist(state) {
    this.saved = structuredClone(state);
  }

  // What was sent since the last call, optionally of one type only.
  take(type) {
    const out = this.sent;
    this.sent = [];
    return type ? out.filter((m) => m.t === type) : out;
  }
}

function fakeStorage() {
  return {
    state: null,
    saves: 0,
    load() { return this.state; },
    save(state) { this.state = structuredClone(state); this.saves += 1; },
  };
}

let count = 0; // for connection ids: unique across all rooms of a test run

// A room with a fake clock and storage, and short ways to drive it.
function setup({ store = fakeStorage(), clock = { now: START } } = {}) {
  const logs = [];
  const room = new RoomCore({ now: () => clock.now, storage: store, log: (line) => logs.push(line) });
  const s = {
    room, clock, store, logs,
    advance(ms) { clock.now += ms; },
    // A new socket that has not said hello.
    connect() {
      const conn = new FakeConn(`conn-${++count}`);
      conn.accepted = room.connect(conn);
      return conn;
    },
    // A message from a connection: an object (sent as JSON) or raw data.
    say(conn, message) {
      room.message(conn.id, typeof message === 'object' && !ArrayBuffer.isView(message) && !(message instanceof ArrayBuffer)
        ? JSON.stringify(message) : message);
    },
    // A new socket that says hello. conn.welcome is the relay's answer.
    join({ role = 'rider', seat = null, client = null } = {}) {
      const conn = s.connect();
      conn.client = client || `client-of-${conn.id}`;
      s.say(conn, { t: 'hello', v: 1, client: conn.client, role, seat });
      conn.welcome = conn.sent.find((m) => m.t === 'welcome') || null;
      return conn;
    },
    // Forget everything sent so far.
    clear(...conns) {
      for (const conn of conns) conn.take();
    },
  };
  return s;
}

// The connection got an "error" with this code and was closed with 4000.
function assertFailed(conn, code) {
  const last = conn.sent[conn.sent.length - 1];
  assert.ok(last, 'an error message was sent');
  assert.equal(last.t, 'error');
  assert.equal(last.code, code);
  assert.equal(typeof last.message, 'string');
  assert.ok(last.message.length > 0);
  assert.deepEqual(conn.closed, { code: CLOSE.protocolError, reason: code });
}

const hello = (extra = {}) => ({ t: 'hello', v: 1, client: 'client-12345', role: 'rider', seat: null, ...extra });
const pose23 = () => Array.from({ length: 23 }, (_, i) => i / 10);

describe('constants', () => {
  test('match PROTOCOL.md', () => {
    assert.equal(PROTOCOL_VERSION, 1);
    assert.equal(LIMITS.maxConnections, 16);
    assert.equal(LIMITS.maxMessageBytes, 2048);
    assert.equal(LIMITS.seats, 10);
    assert.equal(LIMITS.staleSeatMs, 15_000);
    assert.equal(LIMITS.maxPosesPerSecond, 40);
    assert.equal(LIMITS.maxPoseNumbers, 32);
    assert.equal(LIMITS.maxRideSeconds, 86_400);
    assert.equal(LIMITS.emptyResetMs, 600_000);
    assert.deepEqual({ ...CLOSE }, { protocolError: 4000, replaced: 4001, roomFull: 4002 });
  });
});

describe('hello and welcome', () => {
  test('welcome answers hello: version, server time, seat, peers, control, ride', () => {
    const s = setup();
    s.advance(250);
    const a = s.connect();
    s.say(a, hello({ seat: 3 }));
    assert.deepEqual(a.sent, [
      {
        t: 'welcome', v: 1, now: START + 250, seat: 3, peers: [3], control: false,
        ride: { playing: false, base: 0, at: START, rev: 0 },
      },
      { t: 'peers', peers: [3], control: false },
    ]);
    assert.equal(a.closed, null);
  });

  test('a rider who asks for no seat gets none, and nobody is told', () => {
    const s = setup();
    const a = s.join({ seat: 2 });
    s.clear(a);
    const b = s.join();
    assert.equal(b.welcome.seat, null);
    assert.deepEqual(b.welcome.peers, [2]);
    assert.deepEqual(b.sent.map((m) => m.t), ['welcome']);
    assert.deepEqual(a.sent, []);
  });

  test('a seat that is taken is not granted: welcome has seat null', () => {
    const s = setup();
    const a = s.join({ seat: 5 });
    s.clear(a);
    const b = s.join({ seat: 5 });
    assert.equal(b.welcome.seat, null);
    assert.deepEqual(b.welcome.peers, [5]);
    assert.deepEqual(a.sent, [], 'the holder hears nothing');
  });

  test('a control page gets no seat, even if it asks for one', () => {
    const s = setup();
    const c = s.join({ role: 'control', seat: 4 });
    assert.equal(c.welcome.seat, null);
    assert.deepEqual(c.welcome.peers, []);
    assert.equal(c.welcome.control, true);
    assert.deepEqual(c.sent[1], { t: 'peers', peers: [], control: true });
  });

  test('welcome carries the current ride clock', () => {
    const s = setup();
    const a = s.join();
    s.say(a, { t: 'cmd', op: 'seek', time: 12.5 });
    s.advance(40);
    s.say(a, { t: 'cmd', op: 'play' });
    const b = s.join();
    assert.deepEqual(b.welcome.ride, { playing: true, base: 12.5, at: START + 40, rev: 2 });
  });

  test('the first message must be hello', () => {
    for (const first of [{ t: 'ping', c: 1 }, { t: 'seat', seat: 1 }, { t: 'pose', d: [1] }, { t: 'cmd', op: 'play' }]) {
      const s = setup();
      const a = s.connect();
      s.say(a, first);
      assertFailed(a, 'hello');
      assert.equal(s.room.size, 0);
    }
  });

  test('hello can only be sent once', () => {
    const s = setup();
    const a = s.join({ seat: 1 });
    s.say(a, hello({ client: a.client, seat: 1 }));
    assertFailed(a, 'hello');
  });

  test('a wrong or missing version is refused with "version"', () => {
    for (const v of [0, 2, '1', null, undefined, 1.5]) {
      const s = setup();
      const a = s.connect();
      s.say(a, hello({ v }));
      assertFailed(a, 'version');
    }
  });

  test('the version is checked before the other fields', () => {
    const s = setup();
    const a = s.connect();
    s.say(a, { t: 'hello', v: 2, something: 'else' });
    assertFailed(a, 'version');
  });

  test('a hello with invalid fields is refused with "bad"', () => {
    const invalid = [
      { client: 'short' },                  // 5 characters
      { client: 'x'.repeat(65) },
      { client: 12345678 },
      { client: undefined },
      { role: 'driver' },
      { role: undefined },
      { seat: 0 },
      { seat: 11 },
      { seat: 2.5 },
      { seat: '3' },
      { seat: undefined },                  // the field is missing
    ];
    for (const fields of invalid) {
      const s = setup();
      const a = s.connect();
      s.say(a, hello(fields));
      assertFailed(a, 'bad');
    }
  });

  test('client ids of 8 and of 64 characters are accepted', () => {
    const s = setup();
    assert.ok(s.join({ client: '12345678' }).welcome);
    assert.ok(s.join({ client: 'x'.repeat(64) }).welcome);
  });

  test('a connection that has not said hello gets no broadcasts', () => {
    const s = setup();
    const quiet = s.connect();
    const a = s.join({ seat: 1 });
    const b = s.join({ seat: 2 });
    s.say(a, { t: 'cmd', op: 'play' });
    s.say(a, { t: 'pose', d: [1, 2, 3] });
    assert.ok(b.take('pose').length === 1);
    assert.deepEqual(quiet.sent, []);
  });
});

describe('the same client connects again', () => {
  test('the old socket is closed with 4001 and the new one keeps the seat', () => {
    const s = setup();
    const old = s.join({ seat: 3, client: 'client-aaaa' });
    const other = s.join({ seat: 4 });
    s.clear(old, other);

    const fresh = s.join({ seat: 3, client: 'client-aaaa' });
    assert.deepEqual(old.closed, { code: CLOSE.replaced, reason: 'replaced' });
    assert.deepEqual(old.sent, [], 'no error message before 4001');
    assert.equal(fresh.welcome.seat, 3);
    assert.deepEqual(fresh.welcome.peers, [3, 4]);
    assert.deepEqual(other.sent, [], 'who sits where has not changed, so nobody is told');
    assert.equal(s.room.size, 2);
  });

  test('the seat is kept even if the new hello asks for none', () => {
    const s = setup();
    s.join({ seat: 7, client: 'client-aaaa' });
    const fresh = s.join({ seat: null, client: 'client-aaaa' });
    assert.equal(fresh.welcome.seat, 7);
  });

  test('the old socket closing afterwards does not free the seat', () => {
    const s = setup();
    const old = s.join({ seat: 3, client: 'client-aaaa' });
    const fresh = s.join({ seat: 3, client: 'client-aaaa' });
    const other = s.join();
    s.clear(fresh, other);
    s.room.disconnect(old.id);                 // the close event of the replaced socket
    s.say(old, { t: 'seat', seat: null });     // and a late message from it
    assert.deepEqual(other.sent, []);
    s.say(other, { t: 'seat', seat: 3 });
    assert.deepEqual(other.take('seat'), [{ t: 'seat', seat: null, ok: false }]);
  });

  test('the new hello may move to another free seat', () => {
    const s = setup();
    s.join({ seat: 3, client: 'client-aaaa' });
    const other = s.join({ seat: 4 });
    s.clear(other);
    const fresh = s.join({ seat: 5, client: 'client-aaaa' });
    assert.equal(fresh.welcome.seat, 5);
    assert.deepEqual(other.sent, [{ t: 'peers', peers: [4, 5], control: false }]);
  });

  test('if the new hello asks for a taken seat, the old seat is kept', () => {
    const s = setup();
    s.join({ seat: 3, client: 'client-aaaa' });
    s.join({ seat: 4 });
    const fresh = s.join({ seat: 4, client: 'client-aaaa' });
    assert.equal(fresh.welcome.seat, 3);
  });

  test('the role comes from the new hello: a rider can come back as the control page', () => {
    const s = setup();
    s.join({ seat: 3, client: 'client-aaaa' });
    const other = s.join({ seat: 4 });
    s.clear(other);
    const fresh = s.join({ role: 'control', client: 'client-aaaa' });
    assert.equal(fresh.welcome.seat, null);
    assert.deepEqual(fresh.welcome.peers, [4]);
    assert.equal(fresh.welcome.control, true);
    assert.deepEqual(other.sent, [{ t: 'peers', peers: [4], control: true }]);
  });

  test('a control page that comes back as a rider leaves the room without a control page', () => {
    const s = setup();
    s.join({ role: 'control', client: 'client-aaaa' });
    const other = s.join({ seat: 4 });
    s.clear(other);
    const fresh = s.join({ role: 'rider', seat: 1, client: 'client-aaaa' });
    assert.equal(fresh.welcome.seat, 1);
    assert.equal(fresh.welcome.control, false);
    assert.deepEqual(other.sent, [{ t: 'peers', peers: [1, 4], control: false }]);
  });

  test('a replaced control page does not leave riders locked out', () => {
    const s = setup();
    s.join({ role: 'control', client: 'client-teacher' });
    const teacher = s.join({ role: 'control', client: 'client-teacher' });
    const rider = s.join({ seat: 1 });
    s.say(rider, { t: 'cmd', op: 'play' });
    assert.deepEqual(rider.take('denied'), [{ t: 'denied', op: 'play' }]);
    s.room.disconnect(teacher.id);
    s.say(rider, { t: 'cmd', op: 'play' });
    assert.equal(rider.take('ride').length, 1);
  });
});

describe('seats', () => {
  test('a free seat is granted, and everyone is told', () => {
    const s = setup();
    const a = s.join();
    const b = s.join();
    const c = s.join({ role: 'control' });
    s.clear(a, b, c);
    s.say(a, { t: 'seat', seat: 6 });
    assert.deepEqual(a.sent, [{ t: 'seat', seat: 6, ok: true }, { t: 'peers', peers: [6], control: true }]);
    assert.deepEqual(b.sent, [{ t: 'peers', peers: [6], control: true }]);
    assert.deepEqual(c.sent, [{ t: 'peers', peers: [6], control: true }]);
  });

  test('a seat held by another client is refused, and the asker keeps its own', () => {
    const s = setup();
    const a = s.join({ seat: 1 });
    const b = s.join({ seat: 2 });
    s.clear(a, b);
    s.say(b, { t: 'seat', seat: 1 });
    assert.deepEqual(b.sent, [{ t: 'seat', seat: 2, ok: false }]);
    assert.deepEqual(a.sent, []);
  });

  test('asking for the seat you hold is granted again', () => {
    const s = setup();
    const a = s.join({ seat: 1 });
    const b = s.join();
    s.clear(a, b);
    s.say(a, { t: 'seat', seat: 1 });
    assert.deepEqual(a.sent, [{ t: 'seat', seat: 1, ok: true }]);
    assert.deepEqual(b.sent, []);
  });

  test('moving frees the old seat', () => {
    const s = setup();
    const a = s.join({ seat: 1 });
    const b = s.join({ seat: 9 });
    s.clear(a, b);
    s.say(a, { t: 'seat', seat: 10 });
    assert.deepEqual(a.sent, [{ t: 'seat', seat: 10, ok: true }, { t: 'peers', peers: [9, 10], control: false }]);
    s.say(b, { t: 'seat', seat: 1 });
    assert.deepEqual(b.take('seat'), [{ t: 'seat', seat: 1, ok: true }]);
  });

  test('null gives up the seat', () => {
    const s = setup();
    const a = s.join({ seat: 1 });
    const b = s.join();
    s.clear(a, b);
    s.say(a, { t: 'seat', seat: null });
    assert.deepEqual(a.sent, [{ t: 'seat', seat: null, ok: true }, { t: 'peers', peers: [], control: false }]);
    assert.deepEqual(b.sent, [{ t: 'peers', peers: [], control: false }]);
    s.clear(a, b);
    s.say(a, { t: 'seat', seat: null });
    assert.deepEqual(a.sent, [{ t: 'seat', seat: null, ok: true }], 'giving up nothing is fine');
    assert.deepEqual(b.sent, []);
  });

  test('peers are sorted', () => {
    const s = setup();
    s.join({ seat: 10 });
    s.join({ seat: 2 });
    s.join({ seat: 7 });
    assert.deepEqual(s.join().welcome.peers, [2, 7, 10]);
  });

  test('a control page never holds a seat', () => {
    const s = setup();
    const c = s.join({ role: 'control' });
    s.clear(c);
    s.say(c, { t: 'seat', seat: 3 });
    assert.deepEqual(c.sent, [{ t: 'seat', seat: null, ok: false }]);
    s.clear(c);
    s.say(c, { t: 'seat', seat: null });
    assert.deepEqual(c.sent, [{ t: 'seat', seat: null, ok: true }]);
  });

  test('when a connection closes, its seat is freed and everyone is told', () => {
    const s = setup();
    const a = s.join({ seat: 1 });
    const b = s.join({ seat: 2 });
    s.clear(a, b);
    s.room.disconnect(a.id);
    assert.deepEqual(b.sent, [{ t: 'peers', peers: [2], control: false }]);
    s.say(b, { t: 'seat', seat: 1 });
    assert.deepEqual(b.take('seat'), [{ t: 'seat', seat: 1, ok: true }]);
  });

  test('a rider without a seat closing changes nothing for the others', () => {
    const s = setup();
    const a = s.join({ seat: 1 });
    const b = s.join();
    s.clear(a);
    s.room.disconnect(b.id);
    assert.deepEqual(a.sent, []);
  });

  test('invalid seat requests are refused with "bad"', () => {
    for (const seat of [0, 11, -1, 1.5, '3', true, undefined, [1], {}]) {
      const s = setup();
      const a = s.join({ seat: 1 });
      const b = s.join();
      s.clear(a, b);
      s.say(a, { t: 'seat', seat });
      assertFailed(a, 'bad');
      assert.deepEqual(b.sent, [{ t: 'peers', peers: [], control: false }], 'the seat of the closed connection is freed');
    }
  });
});

describe('stale seats', () => {
  test('a holder silent for 15 s loses the seat to an asker and stays connected', () => {
    const s = setup();
    const a = s.join({ seat: 3 });
    const b = s.join();
    const c = s.join({ seat: 4 });
    s.clear(a, b, c);

    s.advance(14_999);
    s.say(b, { t: 'seat', seat: 3 });
    assert.deepEqual(b.take(), [{ t: 'seat', seat: null, ok: false }], 'not yet stale');
    assert.deepEqual(a.sent, []);

    s.advance(1);
    s.say(b, { t: 'seat', seat: 3 });
    assert.deepEqual(b.take('seat'), [{ t: 'seat', seat: 3, ok: true }]);
    assert.deepEqual(a.take(), [{ t: 'seat', seat: null, ok: false }]);
    assert.equal(a.closed, null);
    assert.equal(s.room.size, 3);
    // The stale holder can take another seat (and is not stale any more).
    s.say(a, { t: 'seat', seat: 5 });
    assert.deepEqual(a.take('seat'), [{ t: 'seat', seat: 5, ok: true }]);
    assert.deepEqual(c.take('peers').pop(), { t: 'peers', peers: [3, 4, 5], control: false });
  });

  test('the asker moves: its old seat is freed', () => {
    const s = setup();
    const a = s.join({ seat: 3 });
    const b = s.join({ seat: 8 });
    s.clear(a, b);
    s.advance(15_000);
    s.say(b, { t: 'seat', seat: 3 });
    assert.deepEqual(b.take(), [{ t: 'seat', seat: 3, ok: true }, { t: 'peers', peers: [3], control: false }]);
  });

  test('any message keeps a seat, also a pose dropped by the rate limit', () => {
    const s = setup();
    const a = s.join({ seat: 3 });
    const b = s.join();

    s.advance(10_000);
    s.say(a, { t: 'ping', c: 1 });
    s.advance(14_999);
    s.say(b, { t: 'seat', seat: 3 });
    assert.equal(b.take('seat')[0].ok, false);

    for (let i = 0; i < LIMITS.maxPosesPerSecond; i++) s.say(a, { t: 'pose', d: [1] });
    s.advance(500);
    s.say(a, { t: 'pose', d: [1] }); // over the limit: dropped, but it was sent
    s.advance(14_999);
    s.say(b, { t: 'seat', seat: 3 });
    assert.equal(b.take('seat')[0].ok, false);
    s.advance(1);
    s.say(b, { t: 'seat', seat: 3 });
    assert.equal(b.take('seat')[0].ok, true);
  });

  test('a stale seat can be taken with hello', () => {
    const s = setup();
    const a = s.join({ seat: 3 });
    s.clear(a);
    s.advance(15_000);
    const b = s.join({ seat: 3 });
    assert.equal(b.welcome.seat, 3);
    assert.deepEqual(a.sent, [{ t: 'seat', seat: null, ok: false }]);
  });
});

describe('who may control the ride', () => {
  test('a rider may while no control page is in the room, also without a seat', () => {
    const s = setup();
    const a = s.join();
    const b = s.join({ seat: 2 });
    s.clear(a, b);
    s.say(a, { t: 'cmd', op: 'play' });
    assert.deepEqual(a.sent, [{ t: 'ride', playing: true, base: 0, at: START, rev: 1 }]);
    assert.deepEqual(b.sent, a.sent);
  });

  test('a rider is denied while a control page is in the room', () => {
    const s = setup();
    const rider = s.join({ seat: 1 });
    const teacher = s.join({ role: 'control' });
    s.clear(rider, teacher);
    for (const op of ['play', 'pause', 'restart']) {
      s.say(rider, { t: 'cmd', op });
      assert.deepEqual(rider.take(), [{ t: 'denied', op }]);
    }
    s.say(rider, { t: 'cmd', op: 'seek', time: 30 });
    assert.deepEqual(rider.take(), [{ t: 'denied', op: 'seek' }]);
    assert.deepEqual(teacher.sent, [], 'nothing changed');
    assert.equal(s.room.ride.rev, 0);
    assert.equal(rider.closed, null);
  });

  test('a control page always may', () => {
    const s = setup();
    const rider = s.join({ seat: 1 });
    const teacher = s.join({ role: 'control' });
    s.clear(rider, teacher);
    s.say(teacher, { t: 'cmd', op: 'restart' });
    assert.deepEqual(teacher.sent, [{ t: 'ride', playing: true, base: 0, at: START, rev: 1 }]);
    assert.deepEqual(rider.sent, teacher.sent);
  });

  test('when the control page leaves, everyone is told and riders may again', () => {
    const s = setup();
    const rider = s.join({ seat: 1 });
    const teacher = s.join({ role: 'control' });
    s.clear(rider);
    s.room.disconnect(teacher.id);
    assert.deepEqual(rider.take(), [{ t: 'peers', peers: [1], control: false }]);
    s.say(rider, { t: 'cmd', op: 'play' });
    assert.equal(rider.take('ride').length, 1);
  });

  test('with two control pages, riders are denied until both have left', () => {
    const s = setup();
    const rider = s.join({ seat: 1 });
    const t1 = s.join({ role: 'control' });
    const t2 = s.join({ role: 'control' });
    s.clear(rider);
    s.room.disconnect(t1.id);
    assert.deepEqual(rider.take(), [], 'still a control page in the room');
    s.say(rider, { t: 'cmd', op: 'play' });
    assert.deepEqual(rider.take(), [{ t: 'denied', op: 'play' }]);
    s.room.disconnect(t2.id);
    assert.deepEqual(rider.take(), [{ t: 'peers', peers: [1], control: false }]);
  });

  test('a malformed command is "bad" even from a rider who may not control', () => {
    const s = setup();
    const rider = s.join({ seat: 1 });
    s.join({ role: 'control' });
    s.say(rider, { t: 'cmd', op: 'stop' });
    assertFailed(rider, 'bad');
  });
});

describe('the ride clock', () => {
  test('starts paused at 0', () => {
    const s = setup();
    assert.deepEqual(s.join().welcome.ride, { playing: false, base: 0, at: START, rev: 0 });
  });

  test('play, pause, seek and restart follow PROTOCOL.md, and rev goes up by one per change', () => {
    const s = setup();
    const teacher = s.join({ role: 'control' });
    const rider = s.join({ seat: 1 });
    s.clear(teacher, rider);
    const cmd = (op, time) => {
      s.say(teacher, time === undefined ? { t: 'cmd', op } : { t: 'cmd', op, time });
      const got = teacher.take();
      assert.deepEqual(rider.take(), got, 'everyone gets the same');
      return got;
    };

    s.advance(1000);
    const playedAt = s.clock.now;
    assert.deepEqual(cmd('play'), [{ t: 'ride', playing: true, base: 0, at: playedAt, rev: 1 }]);
    assert.deepEqual(cmd('play'), [], 'already playing: nothing changes');

    s.advance(2500);
    assert.deepEqual(cmd('pause'), [{ t: 'ride', playing: false, base: 2.5, at: playedAt, rev: 2 }]);
    assert.deepEqual(cmd('pause'), [], 'already paused: nothing changes');

    s.advance(700);
    assert.deepEqual(cmd('seek', 100), [{ t: 'ride', playing: false, base: 100, at: s.clock.now, rev: 3 }]);
    assert.deepEqual(cmd('play'), [{ t: 'ride', playing: true, base: 100, at: s.clock.now, rev: 4 }]);

    s.advance(4000);
    assert.deepEqual(cmd('seek', 10), [{ t: 'ride', playing: true, base: 10, at: s.clock.now, rev: 5 }]);

    s.advance(1500);
    assert.deepEqual(cmd('pause'), [{ t: 'ride', playing: false, base: 11.5, at: s.clock.now - 1500, rev: 6 }]);
    assert.deepEqual(cmd('restart'), [{ t: 'ride', playing: true, base: 0, at: s.clock.now, rev: 7 }]);

    s.advance(3000);
    assert.deepEqual(cmd('restart'), [{ t: 'ride', playing: true, base: 0, at: s.clock.now, rev: 8 }]);
    assert.deepEqual(s.room.ride, { playing: true, base: 0, at: s.clock.now, rev: 8 });
  });

  test('seek clamps the time to 0..86400', () => {
    const s = setup();
    const a = s.join();
    s.clear(a);
    s.say(a, { t: 'cmd', op: 'seek', time: -5 });
    s.say(a, { t: 'cmd', op: 'seek', time: 1e9 });
    s.say(a, { t: 'cmd', op: 'seek', time: 86_400 });
    s.say(a, { t: 'cmd', op: 'seek', time: 0.25 });
    assert.deepEqual(a.take().map((m) => m.base), [0, 86_400, 86_400, 0.25]);
  });

  test('a seek always counts as a change', () => {
    const s = setup();
    const a = s.join();
    s.say(a, { t: 'cmd', op: 'seek', time: 5 });
    s.say(a, { t: 'cmd', op: 'seek', time: 5 });
    assert.equal(s.room.ride.rev, 2);
  });

  test('rideTime gives the ride time of a clock', () => {
    assert.equal(rideTime({ playing: false, base: 7, at: 1000, rev: 0 }, 99_000), 7);
    assert.equal(rideTime({ playing: true, base: 7, at: 1000, rev: 0 }, 3500), 9.5);
    assert.equal(rideTime({ playing: true, base: 7, at: 1000, rev: 0 }, 500), 7, 'never before its base');
  });

  test('malformed commands are refused with "bad"', () => {
    const invalid = [
      { t: 'cmd' },
      { t: 'cmd', op: 'stop' },
      { t: 'cmd', op: 5 },
      { t: 'cmd', op: 'seek' },
      { t: 'cmd', op: 'seek', time: '10' },
      { t: 'cmd', op: 'seek', time: null },
    ];
    for (const message of invalid) {
      const s = setup();
      const a = s.join();
      s.say(a, message);
      assertFailed(a, 'bad');
      assert.equal(s.room.ride.rev, 0);
    }
  });

  test('a seek time that overflows to Infinity is "bad"', () => {
    const s = setup();
    const a = s.join();
    s.say(a, '{"t":"cmd","op":"seek","time":1e999}');
    assertFailed(a, 'bad');
  });

  test('the clock is saved on every change and survives a restart of the relay', () => {
    const s = setup();
    const a = s.join();
    s.say(a, { t: 'cmd', op: 'seek', time: 42 });
    s.say(a, { t: 'cmd', op: 'play' });
    assert.deepEqual(s.store.state.ride, { playing: true, base: 42, at: START, rev: 2 });

    // The relay restarts: all sockets are gone, the storage is still there.
    s.advance(5000);
    const again = setup({ store: s.store, clock: s.clock });
    const b = again.join();
    assert.deepEqual(b.welcome.ride, { playing: true, base: 42, at: START, rev: 2 });
    assert.equal(rideTime(b.welcome.ride, b.welcome.now), 47, 'the ride went on meanwhile');
  });
});

describe('clock sync', () => {
  test('pong echoes c and gives the server time', () => {
    const s = setup();
    const a = s.join();
    const b = s.join();
    s.clear(a, b);
    s.advance(1234);
    s.say(a, { t: 'ping', c: 98765.4321 });
    assert.deepEqual(a.sent, [{ t: 'pong', c: 98765.4321, s: START + 1234 }]);
    assert.deepEqual(b.sent, []);
    s.say(a, { t: 'ping', c: -0.5 });
    assert.deepEqual(a.take('pong')[1], { t: 'pong', c: -0.5, s: START + 1234 });
  });

  test('a ping without a number is "bad"', () => {
    for (const c of ['1', null, undefined, [1], {}]) {
      const s = setup();
      const a = s.join();
      s.say(a, { t: 'ping', c });
      assertFailed(a, 'bad');
    }
  });
});

describe('poses', () => {
  test('a pose goes to everyone else with the sender\'s seat, unchanged, and is not echoed', () => {
    const s = setup();
    const a = s.join({ seat: 3 });
    const b = s.join({ seat: 4 });
    const noSeat = s.join();
    const teacher = s.join({ role: 'control' });
    s.clear(a, b, noSeat, teacher);
    const d = pose23();
    s.say(a, { t: 'pose', d });
    const expected = [{ t: 'pose', seat: 3, d }];
    assert.deepEqual(b.sent, expected);
    assert.deepEqual(noSeat.sent, expected);
    assert.deepEqual(teacher.sent, expected);
    assert.deepEqual(a.sent, []);
  });

  test('numbers are forwarded exactly', () => {
    const s = setup();
    const a = s.join({ seat: 1 });
    const b = s.join({ seat: 2 });
    s.clear(b);
    const d = [0.1 + 0.2, -1e-7, 123456.789012345, 0, -3.5, 1e21, Number.MAX_SAFE_INTEGER, 5e-324];
    s.say(a, { t: 'pose', d });
    assert.deepEqual(b.sent[0].d, d);
  });

  test('a pose from a sender without a seat is ignored', () => {
    const s = setup();
    const a = s.join();
    const teacher = s.join({ role: 'control' });
    const b = s.join({ seat: 2 });
    s.clear(a, b, teacher);
    s.say(a, { t: 'pose', d: [1, 2, 3] });
    s.say(teacher, { t: 'pose', d: [1, 2, 3] });
    assert.deepEqual(b.sent, []);
    assert.equal(a.closed, null);
    assert.equal(teacher.closed, null);
  });

  test('1 and 32 numbers are allowed', () => {
    const s = setup();
    const a = s.join({ seat: 1 });
    const b = s.join({ seat: 2 });
    s.clear(b);
    s.say(a, { t: 'pose', d: [0] });
    s.say(a, { t: 'pose', d: Array(32).fill(1.5) });
    assert.deepEqual(b.sent.map((m) => m.d.length), [1, 32]);
  });

  test('a malformed pose is refused with "bad"', () => {
    const invalid = [
      '{"t":"pose"}',
      '{"t":"pose","d":[]}',
      `{"t":"pose","d":[${Array(33).fill(1).join(',')}]}`,
      '{"t":"pose","d":"1,2,3"}',
      '{"t":"pose","d":{"0":1}}',
      '{"t":"pose","d":[1,"2",3]}',
      '{"t":"pose","d":[1,null,3]}',
      '{"t":"pose","d":[1,[2],3]}',
      '{"t":"pose","d":[1,true,3]}',
      '{"t":"pose","d":[1,1e999,3]}',
    ];
    for (const text of invalid) {
      const s = setup();
      const a = s.join({ seat: 1 });
      const b = s.join({ seat: 2 });
      s.clear(b);
      s.say(a, text);
      assertFailed(a, 'bad');
      assert.deepEqual(b.take('pose'), []);
    }
  });

  test('a malformed pose is "bad" also without a seat', () => {
    const s = setup();
    const a = s.join();
    s.say(a, { t: 'pose', d: 'x' });
    assertFailed(a, 'bad');
  });

  test('more than 40 poses in a second: the extra ones are dropped silently', () => {
    const s = setup();
    const a = s.join({ seat: 1 });
    const b = s.join({ seat: 2 });
    s.clear(a, b);
    for (let i = 0; i < 60; i++) {
      s.say(a, { t: 'pose', d: [i] });
      s.advance(10); // 100 poses a second
    }
    // 600 ms have passed: all in the first one-second window.
    assert.deepEqual(b.take().map((m) => m.d[0]), Array.from({ length: 40 }, (_, i) => i));
    assert.deepEqual(a.sent, [], 'no answer to the sender');
    assert.equal(a.closed, null);

    s.advance(400); // one second after the first pose: a new window
    for (let i = 100; i < 150; i++) s.say(a, { t: 'pose', d: [i] });
    assert.equal(b.take().length, 40);
    s.advance(999);
    s.say(a, { t: 'pose', d: [1] });
    assert.equal(b.take().length, 0);
    s.advance(1);
    s.say(a, { t: 'pose', d: [1] });
    assert.equal(b.take().length, 1);
  });

  test('15 poses a second for a minute all pass', () => {
    const s = setup();
    const a = s.join({ seat: 1 });
    const b = s.join({ seat: 2 });
    s.clear(b);
    for (let i = 0; i < 900; i++) {
      s.say(a, { t: 'pose', d: pose23() });
      s.advance(1000 / 15);
    }
    assert.equal(b.take('pose').length, 900);
  });

  test('the limit is per connection', () => {
    const s = setup();
    const a = s.join({ seat: 1 });
    const b = s.join({ seat: 2 });
    const c = s.join({ seat: 3 });
    s.clear(a, b, c);
    for (let i = 0; i < 40; i++) s.say(a, { t: 'pose', d: [i] });
    for (let i = 0; i < 40; i++) s.say(b, { t: 'pose', d: [i] });
    assert.equal(c.take('pose').length, 80);
  });
});

describe('message validation', () => {
  test('bad JSON, non-objects and messages without a type are "bad"', () => {
    const invalid = ['', 'hello', '{"t":"ping","c":1', '[]', '[{"t":"ping","c":1}]', '42', 'null', '"ping"', 'true',
      '{}', '{"t":5}', '{"t":null}', '{"type":"ping"}'];
    for (const text of invalid) {
      const s = setup();
      const a = s.join({ seat: 1 });
      s.say(a, text);
      assertFailed(a, 'bad');
    }
  });

  test('an unknown message type is "bad"', () => {
    for (const t of ['welcome', 'peers', 'ride', 'pong', 'bogus', '']) {
      const s = setup();
      const a = s.join();
      s.say(a, { t });
      assertFailed(a, 'bad');
    }
  });

  test('a binary frame is "bad"', () => {
    for (const data of [new ArrayBuffer(4), new Uint8Array([1, 2, 3]), 42, null, undefined]) {
      const s = setup();
      const a = s.join();
      s.room.message(a.id, data);
      assertFailed(a, 'bad');
    }
  });

  test('unknown extra fields are ignored', () => {
    const s = setup();
    const a = s.join();
    s.clear(a);
    s.say(a, { t: 'ping', c: 1, extra: { anything: [1, 2, 3] } });
    assert.equal(a.sent[0].t, 'pong');
  });

  test('a message of 2048 bytes passes, one of 2049 bytes is refused with "size"', () => {
    const padded = (bytes) => {
      const text = JSON.stringify({ t: 'ping', c: 1, pad: '' });
      return text.replace('""', `"${'x'.repeat(bytes - text.length)}"`);
    };
    const s = setup();
    const a = s.join();
    s.clear(a);
    assert.equal(padded(2048).length, 2048);
    s.say(a, padded(2048));
    assert.equal(a.take()[0].t, 'pong');
    s.say(a, padded(2049));
    assertFailed(a, 'size');
  });

  test('the size limit counts bytes, not characters', () => {
    const withPad = (pad) => JSON.stringify({ t: 'ping', c: 1, pad });
    const fits = setup();
    const a = fits.join();
    fits.clear(a);
    fits.say(a, withPad('€'.repeat(670)));   // 3 bytes each: 2010 bytes + the rest
    assert.equal(a.take()[0].t, 'pong');

    const tooBig = setup();
    const b = tooBig.join();
    tooBig.say(b, withPad('€'.repeat(700))); // 700 characters, but over 2100 bytes
    assertFailed(b, 'size');

    const emoji = setup();
    const c = emoji.join();
    emoji.say(c, withPad('🚌'.repeat(510))); // 4 bytes each (2 UTF-16 units): over 2040 bytes
    assertFailed(c, 'size');
  });

  test('a huge message is refused with "size", also before hello and if it is not JSON', () => {
    const s = setup();
    const a = s.connect();
    s.say(a, 'x'.repeat(100_000));
    assertFailed(a, 'size');
  });

  test('after a protocol error the connection is out of the room', () => {
    const s = setup();
    const a = s.join({ seat: 1 });
    const b = s.join({ seat: 2 });
    s.clear(a, b);
    s.say(a, 'not json');
    assertFailed(a, 'bad');
    assert.equal(s.room.size, 1);
    assert.deepEqual(b.sent, [{ t: 'peers', peers: [2], control: false }]);
    // Whatever the closed socket still sends is ignored.
    s.clear(a, b);
    s.say(a, { t: 'cmd', op: 'play' });
    s.say(a, { t: 'pose', d: [1] });
    assert.deepEqual(b.sent, []);
    assert.equal(s.room.ride.rev, 0);
    s.room.disconnect(a.id); // its close event: nothing more happens
    assert.deepEqual(b.sent, []);
  });
});

describe('room full', () => {
  test('the 17th connection gets "full" and close code 4002', () => {
    const s = setup();
    const conns = [];
    for (let i = 0; i < 16; i++) conns.push(s.join({ seat: i < 10 ? i + 1 : null }));
    assert.ok(conns.every((c) => c.accepted && c.welcome));
    s.clear(...conns);

    assert.equal(s.room.full, true);
    const extra = s.connect();
    assert.equal(extra.accepted, false);
    assert.deepEqual(extra.sent.map((m) => [m.t, m.code]), [['error', 'full']]);
    assert.deepEqual(extra.closed, { code: CLOSE.roomFull, reason: 'room full' });
    assert.equal(s.room.size, 16);
    assert.ok(conns.every((c) => c.sent.length === 0), 'the others notice nothing');
    // Messages and the close event of the refused socket are ignored.
    s.say(extra, hello());
    s.room.disconnect(extra.id);
    assert.equal(s.room.size, 16);

    // When someone leaves, there is room again.
    s.room.disconnect(conns[15].id);
    assert.ok(s.join().welcome);
  });

  test('connections that have not said hello count too', () => {
    const s = setup();
    for (let i = 0; i < 16; i++) s.connect();
    assert.equal(s.connect().accepted, false);
  });
});

describe('an empty room', () => {
  const rideOf = (s) => {
    const a = s.join();
    s.say(a, { t: 'cmd', op: 'seek', time: 50 });
    s.say(a, { t: 'cmd', op: 'play' });
    s.room.disconnect(a.id);
    return { playing: true, base: 50, at: s.clock.now, rev: 2 };
  };

  test('empty for 10 minutes or less: the next connection finds the clock as it was', () => {
    const s = setup();
    const ride = rideOf(s);
    s.advance(600_000);
    assert.deepEqual(s.join().welcome.ride, ride);
  });

  test('empty for more than 10 minutes: the next connection starts with a fresh clock', () => {
    const s = setup();
    const ride = rideOf(s);
    s.advance(600_001);
    const b = s.join();
    assert.deepEqual(b.welcome.ride, { playing: false, base: 0, at: s.clock.now, rev: ride.rev + 1 });
    assert.deepEqual(s.store.state.ride, b.welcome.ride, 'the fresh clock is saved');
  });

  test('the 10 minutes start when the last connection leaves', () => {
    const s = setup();
    const a = s.join();
    const b = s.join();
    s.say(a, { t: 'cmd', op: 'play' });
    s.advance(3_600_000);
    s.room.disconnect(a.id);
    s.advance(3_600_000);
    s.room.disconnect(b.id); // empty from now on
    s.advance(599_000);
    assert.equal(s.join().welcome.ride.playing, true);
  });

  test('a room with someone in it is never reset, however quiet', () => {
    const s = setup();
    const a = s.join();
    s.say(a, { t: 'cmd', op: 'seek', time: 50 });
    s.advance(86_400_000);
    assert.deepEqual(s.join().welcome.ride, { playing: false, base: 50, at: START, rev: 1 });
  });

  test('a connection that never said hello keeps the room open too', () => {
    const s = setup();
    const ride = rideOf(s);
    s.advance(60_000);
    const quiet = s.connect();
    s.advance(3_600_000);
    s.room.disconnect(quiet.id);
    s.advance(60_000);
    assert.deepEqual(s.join().welcome.ride, ride);
  });

  test('a brand new room starts with a fresh clock', () => {
    const s = setup();
    s.advance(86_400_000);
    assert.deepEqual(s.join().welcome.ride, { playing: false, base: 0, at: START, rev: 0 });
  });

  test('the rule also holds across a restart of the relay', () => {
    const s = setup();
    const ride = rideOf(s);
    s.advance(300_000);
    assert.deepEqual(setup({ store: s.store, clock: s.clock }).join().welcome.ride, ride);

    const t = setup();
    rideOf(t);
    t.advance(600_001);
    assert.equal(setup({ store: t.store, clock: t.clock }).join().welcome.ride.playing, false);
  });

  test('a relay that restarts in the middle of a ride keeps the clock', () => {
    const s = setup();
    const a = s.join();
    s.say(a, { t: 'cmd', op: 'play' });
    // 30 minutes of riding, a ping every 10 s, then the relay dies: the
    // sockets are gone without a close event.
    for (let i = 0; i < 180; i++) {
      s.advance(10_000);
      s.say(a, { t: 'ping', c: i });
    }
    s.advance(5000);
    const again = setup({ store: s.store, clock: s.clock });
    assert.deepEqual(again.join().welcome.ride, { playing: true, base: 0, at: START, rev: 1 });
  });

  test('... but not if nobody comes back for more than 10 minutes', () => {
    const s = setup();
    const a = s.join();
    s.say(a, { t: 'cmd', op: 'play' });
    for (let i = 0; i < 180; i++) {
      s.advance(10_000);
      s.say(a, { t: 'ping', c: i });
    }
    s.advance(660_000);
    const again = setup({ store: s.store, clock: s.clock });
    assert.deepEqual(again.join().welcome.ride, { playing: false, base: 0, at: s.clock.now, rev: 2 });
  });

  test('the storage is written rarely: about once a minute while the room is in use', () => {
    const s = setup();
    const a = s.join({ seat: 1 });
    const before = s.store.saves;
    for (let i = 0; i < 15 * 600; i++) { // ten minutes of poses
      s.advance(1000 / 15);
      s.say(a, { t: 'pose', d: pose23() });
    }
    const writes = s.store.saves - before;
    assert.ok(writes >= 9 && writes <= 10, `${writes} writes in ten minutes`);
  });
});

describe('a host that loses its memory (hibernation)', () => {
  // A new room from the same storage, with the sockets put back from what
  // the old room asked them to persist.
  const wake = (s, conns) => {
    const again = setup({ store: s.store, clock: s.clock });
    const restored = conns.map((old) => {
      const conn = new FakeConn(old.id);
      conn.client = old.client;
      again.room.restore(conn, old.saved);
      return conn;
    });
    return { again, restored };
  };

  test('each connection is asked to persist its client, role, seat and "last seen" time', () => {
    const s = setup();
    const quiet = s.connect();
    assert.deepEqual(quiet.saved, { client: null, role: null, seat: null, seen: START });
    const a = s.join({ seat: 3, client: 'client-aaaa' });
    assert.deepEqual(a.saved, { client: 'client-aaaa', role: 'rider', seat: 3, seen: START });
    const teacher = s.join({ role: 'control', client: 'client-teacher' });
    assert.deepEqual(teacher.saved, { client: 'client-teacher', role: 'control', seat: null, seen: START });
    s.advance(1000);
    s.say(a, { t: 'seat', seat: 4 });
    assert.deepEqual(a.saved, { client: 'client-aaaa', role: 'rider', seat: 4, seen: START + 1000 });
  });

  test('the "last seen" time is persisted at most every 5 s', () => {
    const s = setup();
    const a = s.join({ seat: 3 });
    s.advance(4999);
    s.say(a, { t: 'ping', c: 1 });
    assert.equal(a.saved.seen, START);
    s.advance(1);
    s.say(a, { t: 'pose', d: [1] });
    assert.equal(a.saved.seen, START + 5000);
  });

  test('the room is rebuilt: seats, control page, clock, and who is who', () => {
    const s = setup();
    const a = s.join({ seat: 3, client: 'client-aaaa' });
    const b = s.join({ seat: 5, client: 'client-bbbb' });
    const teacher = s.join({ role: 'control', client: 'client-teacher' });
    const quiet = s.connect();
    s.say(teacher, { t: 'cmd', op: 'seek', time: 42 });
    s.say(teacher, { t: 'cmd', op: 'play' });

    s.advance(12_000);
    const { again, restored: [a2, b2, teacher2, quiet2] } = wake(s, [a, b, teacher, quiet]);
    assert.equal(again.room.size, 4);
    for (const conn of [a2, b2, teacher2, quiet2]) assert.deepEqual(conn.sent, [], 'waking up sends nothing');

    // A newcomer sees the room as it was.
    const d = again.join({ seat: 3 });
    assert.deepEqual(d.welcome, {
      t: 'welcome', v: 1, now: s.clock.now, seat: null, peers: [3, 5], control: true,
      ride: { playing: true, base: 42, at: START, rev: 2 },
    });
    assert.deepEqual(a2.sent, [], 'nothing changed, so nobody is told');

    // Roles are remembered.
    again.say(b2, { t: 'cmd', op: 'pause' });
    assert.deepEqual(b2.take(), [{ t: 'denied', op: 'pause' }]);
    again.say(teacher2, { t: 'cmd', op: 'pause' });
    assert.deepEqual(teacher2.take(), [{ t: 'ride', playing: false, base: 54, at: START, rev: 3 }]);

    // Poses flow again.
    again.clear(a2, b2, teacher2, d);
    again.say(a2, { t: 'pose', d: [1, 2] });
    assert.deepEqual(b2.take(), [{ t: 'pose', seat: 3, d: [1, 2] }]);
    assert.deepEqual(quiet2.sent, [], 'still has not said hello');

    // The one that had not said hello still has to.
    again.say(quiet2, { t: 'ping', c: 1 });
    assertFailed(quiet2, 'hello');

    // A client that connects again still replaces its old connection.
    const a3 = again.join({ seat: 3, client: 'client-aaaa' });
    assert.deepEqual(a2.closed, { code: CLOSE.replaced, reason: 'replaced' });
    assert.equal(a3.welcome.seat, 3);

    // And leaving is announced as usual.
    again.clear(b2);
    again.room.disconnect(teacher2.id);
    assert.deepEqual(b2.take(), [{ t: 'peers', peers: [3, 5], control: false }]);
  });

  test('nobody loses a seat too early after waking up', () => {
    const s = setup();
    const a = s.join({ seat: 3 });          // persisted "seen" = START
    const b = s.join();
    s.advance(4000);
    s.say(a, { t: 'ping', c: 1 });          // not persisted: less than 5 s later
    s.advance(8000);                        // 12 s after START the host loses its memory
    const { again, restored: [a2, b2] } = wake(s, [a, b]);

    // All the room knows: a's latest message came before START + 5 s.
    s.advance(7999);                        // START + 19.999 s
    again.say(b2, { t: 'seat', seat: 3 });
    assert.deepEqual(b2.take(), [{ t: 'seat', seat: null, ok: false }]);
    s.advance(1);                           // START + 20 s: silent for 15 s for sure
    again.say(b2, { t: 'seat', seat: 3 });
    assert.deepEqual(b2.take('seat'), [{ t: 'seat', seat: 3, ok: true }]);
    assert.deepEqual(a2.take(), [{ t: 'seat', seat: null, ok: false }]);
  });

  test('a holder that was silent long before the host slept is stale at once', () => {
    const s = setup();
    const a = s.join({ seat: 3 });
    const b = s.join();
    s.advance(60_000);
    const { again, restored: [, b2] } = wake(s, [a, b]);
    again.say(b2, { t: 'seat', seat: 3 });
    assert.equal(b2.take('seat')[0].ok, true);
  });

  test('waking up many times never makes a silent holder look alive', () => {
    const s = setup();
    const a = s.join({ seat: 3 });
    const b = s.join();
    let conns = [a, b];
    let room = s;
    for (let i = 0; i < 3; i++) {           // b pings every 11 s; the host sleeps in between
      s.advance(11_000);
      const { again, restored } = wake(room, conns);
      again.say(restored[1], { t: 'ping', c: i });
      conns = restored;
      room = again;
    }
    room.say(conns[1], { t: 'seat', seat: 3 });
    assert.equal(conns[1].take('seat')[0].ok, true);
  });

  test('damaged saved state is not trusted', () => {
    const s = setup();
    const again = setup({ store: s.store, clock: s.clock });
    const a = new FakeConn('a');
    const b = new FakeConn('b');
    const c = new FakeConn('c');
    const d = new FakeConn('d');
    again.room.restore(a, { client: 'client-aaaa', role: 'rider', seat: 3, seen: START });
    again.room.restore(b, { client: 'client-bbbb', role: 'rider', seat: 3, seen: START }); // the same seat twice
    again.room.restore(c, { client: 'client-cccc', role: 'control', seat: 4, seen: 'yesterday' }); // a control page with a seat
    again.room.restore(d, null);
    assert.equal(again.room.size, 4);
    assert.deepEqual(again.join().welcome.peers, [3]);
    again.say(d, { t: 'ping', c: 1 });
    assertFailed(d, 'hello');
  });
});

describe('one broken part never breaks the room', () => {
  test('a socket that cannot be written to does not stop a broadcast', () => {
    const s = setup();
    const a = s.join({ seat: 1 });
    const dead = s.join({ seat: 2 });
    const c = s.join({ seat: 3 });
    s.clear(a, c);
    dead.broken = true;
    s.say(a, { t: 'pose', d: [1] });
    s.say(a, { t: 'cmd', op: 'play' });
    s.say(a, { t: 'seat', seat: 4 });
    assert.deepEqual(c.sent.map((m) => m.t), ['pose', 'ride', 'peers']);
    assert.equal(s.room.size, 3);
    // Its close event then takes it out of the room.
    s.clear(a, c);
    s.room.disconnect(dead.id);
    assert.deepEqual(c.sent, [{ t: 'peers', peers: [3, 4], control: false }]);
  });

  test('a socket that cannot be closed is still taken out of the room', () => {
    const s = setup();
    const a = s.join({ seat: 1 });
    const b = s.join({ seat: 2 });
    s.clear(b);
    a.close = () => { throw new Error('close failed'); };
    s.say(a, 'not json');
    assert.equal(s.room.size, 1);
    assert.deepEqual(b.sent, [{ t: 'peers', peers: [2], control: false }]);
    assert.equal(s.logs.length, 1);
  });

  test('messages and close events for unknown connections are ignored', () => {
    const s = setup();
    const a = s.join({ seat: 1 });
    s.clear(a);
    s.room.message('nobody', JSON.stringify({ t: 'cmd', op: 'play' }));
    s.room.disconnect('nobody');
    s.room.disconnect(a.id);
    s.room.disconnect(a.id);
    assert.equal(s.room.size, 0);
    assert.equal(s.room.ride.rev, 0);
  });

  test('a storage that fails does not stop the ride', () => {
    const store = fakeStorage();
    store.save = () => { throw new Error('storage is full'); };
    const s = setup({ store });
    const a = s.join({ seat: 1 });
    const b = s.join({ seat: 2 });
    s.clear(a, b);
    s.say(a, { t: 'cmd', op: 'play' });
    assert.deepEqual(b.sent, [{ t: 'ride', playing: true, base: 0, at: START, rev: 1 }]);
    assert.ok(s.logs.length > 0, 'the problem is logged');
  });

  test('a storage that cannot be read gives a fresh clock', () => {
    const store = fakeStorage();
    store.load = () => { throw new Error('cannot read'); };
    const s = setup({ store });
    assert.deepEqual(s.join().welcome.ride, { playing: false, base: 0, at: START, rev: 0 });
    assert.equal(s.logs.length, 1);
  });

  test('damaged saved state gives a fresh clock', () => {
    for (const state of [{}, { ride: null }, { ride: { playing: 'yes', base: 0, at: 0, rev: 0 } },
      { ride: { playing: true, base: null, at: 0, rev: 0 } }, { ride: { playing: true, base: 1, at: 2 } }, 'nonsense', 42]) {
      const store = fakeStorage();
      store.state = state;
      const s = setup({ store });
      assert.deepEqual(s.join().welcome.ride, { playing: false, base: 0, at: START, rev: 0 });
    }
  });

  test('a connection without persist() works too', () => {
    const s = setup();
    const conn = new FakeConn('plain');
    conn.persist = undefined;
    assert.equal(s.room.connect(conn), true);
    s.room.message('plain', JSON.stringify(hello({ seat: 2 })));
    assert.equal(conn.sent[0].seat, 2);
  });

  test('the same connection id connecting twice replaces the first', () => {
    const s = setup();
    const first = new FakeConn('same');
    const second = new FakeConn('same');
    s.room.connect(first);
    s.room.message('same', JSON.stringify(hello({ seat: 2 })));
    s.room.connect(second);
    assert.equal(s.room.size, 1);
    s.room.message('same', JSON.stringify(hello({ seat: 2, client: 'client-other' })));
    assert.equal(second.sent[0].seat, 2);
  });
});
