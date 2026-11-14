// The room logic of the relay (see ../PROTOCOL.md): who is connected, who
// sits where, who may control, the shared ride clock, clock sync and pose
// forwarding.
//
// Plain JavaScript with no Cloudflare APIs, so it can be unit-tested with
// fake connections and a fake clock, and reused by any host (see worker.js).
//
// The host gives the room:
//   now()      the relay's clock in ms (Date.now)
//   storage    { load() -> saved state or null, save(state) }
//              The state is { ride, activeAt }: the ride clock and the last
//              time the room was known to be in use.
//   log(text)  optional: problems worth a line in the log
// and for every socket a connection:
//   { id, send(text), close(code, reason), persist(state) }
// persist is optional. A host that can lose its memory while the sockets
// stay open (hibernation) stores the small state it is given with the socket
// and hands it back through restore().
//
// Everything here is synchronous, and the work per message is tiny.

export const PROTOCOL_VERSION = 1;

export const LIMITS = Object.freeze({
  maxConnections: 16,       // per room
  maxMessageBytes: 2048,
  seats: 10,
  clientIdMin: 8,           // characters in a client id
  clientIdMax: 64,
  staleSeatMs: 15_000,      // a seat holder silent for this long can lose the seat
  maxPosesPerSecond: 40,    // per connection: the extra ones are dropped
  maxPoseNumbers: 32,
  maxRideSeconds: 86_400,   // upper bound for "seek"
  emptyResetMs: 600_000,    // an empty room gets a fresh clock after this
  // How often the two "last heard from" times are written down, so they
  // survive a host that loses its memory. They are only needed roughly.
  seenSaveMs: 5_000,        // per connection (for the stale seat rule)
  activeSaveMs: 60_000,     // per room (for the empty room rule)
});

export const CLOSE = Object.freeze({
  protocolError: 4000,      // after an "error" message
  replaced: 4001,           // the same client connected again
  roomFull: 4002,
});

// The ride time in seconds at server time `now`.
export function rideTime(ride, now) {
  return ride.playing ? ride.base + Math.max(0, now - ride.at) / 1000 : ride.base;
}

const isSeat = (v) => Number.isInteger(v) && v >= 1 && v <= LIMITS.seats;
const isSeatOrNull = (v) => v === null || isSeat(v);

// Bytes of `text` as UTF-8 (text frames are well-formed, so a high
// surrogate always starts a pair: one 4-byte character).
function utf8Length(text) {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff) { bytes += 4; i++; }
    else bytes += 3;
  }
  return bytes;
}

export class RoomCore {
  constructor({ now, storage, log }) {
    this._now = now;
    this._storage = storage;
    this._log = log || (() => {});
    // Connection id -> member (see _member). Seats and "is a control page
    // here" are always read from this one map, so they cannot get out of step.
    this._members = new Map();

    const saved = this._load();
    this.ride = saved.ride || { playing: false, base: 0, at: now(), rev: 0 };
    this._activeAt = saved.activeAt;
    this._peersText = this._peers();
  }

  // Number of connections in the room (also those that have not said hello).
  get size() {
    return this._members.size;
  }

  // True if the next connect() will be refused.
  get full() {
    return this._members.size >= LIMITS.maxConnections;
  }

  // --- Called by the host --------------------------------------------------

  // A new socket. Returns false if the room is full; the connection has
  // then been told so and closed.
  connect(conn) {
    if (this._members.has(conn.id)) this.disconnect(conn.id);
    if (this.full) {
      this._sendTo(conn, { t: 'error', code: 'full', message: 'The room is full.' });
      this._close(conn, CLOSE.roomFull, 'room full');
      return false;
    }
    const now = this._now();
    if (this._members.size === 0) this._open(now);
    const m = this._member(conn, now);
    this._members.set(conn.id, m);
    this._persist(m);
    return true;
  }

  // Puts a connection back after the host lost its memory. `saved` is the
  // state last given to conn.persist (or null).
  restore(conn, saved) {
    const now = this._now();
    const m = this._member(conn, now);
    if (saved && typeof saved.client === 'string') {
      m.client = saved.client;
      m.role = saved.role === 'control' ? 'control' : 'rider';
      if (m.role === 'rider' && isSeat(saved.seat) && !this._holder(saved.seat)) m.seat = saved.seat;
    }
    if (saved && Number.isFinite(saved.seen)) {
      // The connection's latest message came at most seenSaveMs after the
      // saved time. Use the latest possible time, so that nobody loses a
      // seat too early.
      m.seenSaved = saved.seen;
      m.lastSeen = Math.min(now, saved.seen + LIMITS.seenSaveMs);
    }
    this._members.set(conn.id, m);
    this._peersText = this._peers();
  }

  // A frame from a socket: a string, or anything else for a binary frame.
  message(id, data) {
    const m = this._members.get(id);
    if (!m) return; // not in the room (any more)
    const now = this._now();
    m.lastSeen = now;
    if (this._activeAt === null || now - this._activeAt >= LIMITS.activeSaveMs) {
      this._activeAt = now;
      this._save();
    }
    this._handle(m, data, now);
    if (now - m.seenSaved >= LIMITS.seenSaveMs && this._members.get(id) === m) this._persist(m);
  }

  // A socket closed or failed.
  disconnect(id) {
    if (this._members.delete(id)) this._left();
  }

  // --- Messages ------------------------------------------------------------

  _handle(m, data, now) {
    if (typeof data !== 'string') return this._fail(m, 'bad', 'Only text frames are allowed.');
    if (data.length > LIMITS.maxMessageBytes || utf8Length(data) > LIMITS.maxMessageBytes) {
      return this._fail(m, 'size', `A message can be at most ${LIMITS.maxMessageBytes} bytes.`);
    }
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return this._fail(m, 'bad', 'The message is not valid JSON.');
    }
    if (msg === null || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.t !== 'string') {
      return this._fail(m, 'bad', 'A message must be a JSON object with a string field "t".');
    }
    if (m.client === null) {
      if (msg.t !== 'hello') return this._fail(m, 'hello', 'The first message must be "hello".');
      return this._hello(m, msg, now);
    }
    switch (msg.t) {
      case 'pose': return this._pose(m, msg, now);
      case 'ping': return this._ping(m, msg, now);
      case 'cmd': return this._cmd(m, msg, now);
      case 'seat': return this._seat(m, msg, now);
      case 'hello': return this._fail(m, 'hello', '"hello" can only be sent once.');
      default: return this._fail(m, 'bad', 'Unknown message type.');
    }
  }

  _hello(m, msg, now) {
    if (msg.v !== PROTOCOL_VERSION) {
      return this._fail(m, 'version', `This relay speaks protocol version ${PROTOCOL_VERSION}.`);
    }
    const { client, role, seat } = msg;
    if (typeof client !== 'string' || client.length < LIMITS.clientIdMin || client.length > LIMITS.clientIdMax) {
      return this._fail(m, 'bad', `"hello" needs client: a string of ${LIMITS.clientIdMin} to ${LIMITS.clientIdMax} characters.`);
    }
    if (role !== 'rider' && role !== 'control') {
      return this._fail(m, 'bad', '"hello" needs role: "rider" or "control".');
    }
    if (!isSeatOrNull(seat)) {
      return this._fail(m, 'bad', `"hello" needs seat: 1 to ${LIMITS.seats}, or null.`);
    }

    // The same client connected again (a reload, or a connection that died
    // without the relay noticing): the new connection takes over.
    let inherited = null;
    for (const old of this._members.values()) {
      if (old === m || old.client !== client) continue;
      inherited = old.seat;
      this._members.delete(old.conn.id);
      this._close(old.conn, CLOSE.replaced, 'replaced');
    }

    m.client = client;
    m.role = role;
    if (role === 'rider') {
      m.seat = inherited;
      if (seat !== null) this._takeSeat(m, seat, now);
    }
    this._persist(m);
    this._send(m, {
      t: 'welcome',
      v: PROTOCOL_VERSION,
      now,
      seat: m.seat,
      peers: this._seats(),
      control: this._hasControl(),
      ride: this.ride,
    });
    this._announcePeers();
  }

  _seat(m, msg, now) {
    if (!isSeatOrNull(msg.seat)) {
      return this._fail(m, 'bad', `"seat" needs seat: 1 to ${LIMITS.seats}, or null.`);
    }
    const before = m.seat;
    let ok = true;
    if (msg.seat === null) m.seat = null;
    else ok = this._takeSeat(m, msg.seat, now);
    if (m.seat !== before) this._persist(m);
    this._send(m, { t: 'seat', seat: m.seat, ok });
    this._announcePeers();
  }

  // Gives `seat` to m if the rules allow it. Returns true if m holds it
  // afterwards; otherwise m keeps what it had.
  _takeSeat(m, seat, now) {
    if (m.role !== 'rider') return false; // a control page never holds a seat
    if (m.seat === seat) return true;
    const holder = this._holder(seat);
    if (holder) {
      if (now - holder.lastSeen < LIMITS.staleSeatMs) return false; // taken
      // The holder has been silent too long: the seat moves to the asker,
      // and the holder stays connected without a seat.
      holder.seat = null;
      this._persist(holder);
      this._send(holder, { t: 'seat', seat: null, ok: false });
    }
    m.seat = seat;
    return true;
  }

  _ping(m, msg, now) {
    if (!Number.isFinite(msg.c)) return this._fail(m, 'bad', '"ping" needs c: a number.');
    this._send(m, { t: 'pong', c: msg.c, s: now });
  }

  _pose(m, msg, now) {
    // At most maxPosesPerSecond from one connection, counted in windows of
    // one second. The extra ones are dropped without an answer.
    if (now - m.poseWindowAt >= 1000 || now < m.poseWindowAt) {
      m.poseWindowAt = now;
      m.poseCount = 0;
    }
    m.poseCount += 1;
    if (m.poseCount > LIMITS.maxPosesPerSecond) return;

    const d = msg.d;
    if (!Array.isArray(d) || d.length < 1 || d.length > LIMITS.maxPoseNumbers || !d.every(Number.isFinite)) {
      return this._fail(m, 'bad', `"pose" needs d: 1 to ${LIMITS.maxPoseNumbers} finite numbers.`);
    }
    if (m.seat === null) return; // no seat: nowhere to draw this passenger
    this._broadcast(JSON.stringify({ t: 'pose', seat: m.seat, d }), m);
  }

  _cmd(m, msg, now) {
    const op = msg.op;
    if (op !== 'play' && op !== 'pause' && op !== 'seek' && op !== 'restart') {
      return this._fail(m, 'bad', '"cmd" needs op: "play", "pause", "seek" or "restart".');
    }
    if (op === 'seek' && !Number.isFinite(msg.time)) {
      return this._fail(m, 'bad', '"seek" needs time: a number of seconds.');
    }
    // The teacher's page always may; a rider only while no such page is here.
    if (m.role !== 'control' && this._hasControl()) return this._send(m, { t: 'denied', op });

    const ride = this.ride;
    let next;
    if (op === 'play') {
      if (ride.playing) return; // nothing changes
      next = { playing: true, base: ride.base, at: now };
    } else if (op === 'pause') {
      if (!ride.playing) return; // nothing changes
      next = { playing: false, base: rideTime(ride, now), at: ride.at };
    } else if (op === 'seek') {
      const base = Math.min(Math.max(msg.time, 0), LIMITS.maxRideSeconds);
      next = { playing: ride.playing, base, at: now };
    } else {
      next = { playing: true, base: 0, at: now };
    }
    this.ride = { playing: next.playing, base: next.base, at: next.at, rev: ride.rev + 1 };
    this._save();
    this._broadcast(JSON.stringify({ t: 'ride', ...this.ride }));
  }

  // --- The room ------------------------------------------------------------

  _member(conn, now) {
    return {
      conn,
      client: null,       // set by "hello"; null = has not said hello yet
      role: null,         // 'rider' | 'control'
      seat: null,         // 1..10, riders only
      lastSeen: now,      // server ms of the latest frame (for the stale seat rule)
      seenSaved: now,     // lastSeen as last given to conn.persist
      poseWindowAt: 0,    // start of the current one-second pose window
      poseCount: 0,       // poses in that window
    };
  }

  // The first connection into an empty room.
  _open(now) {
    if (this._activeAt !== null && now - this._activeAt > LIMITS.emptyResetMs) {
      // Empty for a long time: a new departure starts with a fresh clock.
      this.ride = { playing: false, base: 0, at: now, rev: this.ride.rev + 1 };
    }
    this._activeAt = now;
    this._save();
  }

  // After a connection has left the room.
  _left() {
    this._announcePeers();
    if (this._members.size === 0) {
      // The room is empty from now on.
      this._activeAt = this._now();
      this._save();
    }
  }

  _holder(seat) {
    for (const m of this._members.values()) if (m.seat === seat) return m;
    return null;
  }

  _seats() {
    const seats = [];
    for (const m of this._members.values()) if (m.seat !== null) seats.push(m.seat);
    return seats.sort((a, b) => a - b);
  }

  _hasControl() {
    for (const m of this._members.values()) if (m.role === 'control') return true;
    return false;
  }

  _peers() {
    return JSON.stringify({ t: 'peers', peers: this._seats(), control: this._hasControl() });
  }

  // Tells everyone who sits where and whether a control page is here, if
  // that has changed since it was last told.
  _announcePeers() {
    const text = this._peers();
    if (text === this._peersText) return;
    this._peersText = text;
    this._broadcast(text);
  }

  // Protocol error: tell the sender, take it out of the room, close it.
  _fail(m, code, message) {
    this._send(m, { t: 'error', code, message });
    this._members.delete(m.conn.id);
    this._close(m.conn, CLOSE.protocolError, code);
    this._left();
  }

  // --- Sending, closing, saving: a problem with one socket or with the
  // storage must never break the room for the others ------------------------

  _send(m, message) {
    this._sendTo(m.conn, message);
  }

  _sendTo(conn, message) {
    try {
      conn.send(JSON.stringify(message));
    } catch {
      // The socket is gone; its close event takes it out of the room.
    }
  }

  // To everyone who has said hello, except `except`.
  _broadcast(text, except = null) {
    for (const m of this._members.values()) {
      if (m === except || m.client === null) continue;
      try {
        m.conn.send(text);
      } catch {
        // As in _sendTo.
      }
    }
  }

  _close(conn, code, reason) {
    try {
      conn.close(code, reason);
    } catch (err) {
      this._log(`could not close a connection: ${err}`);
    }
  }

  _persist(m) {
    m.seenSaved = m.lastSeen;
    if (!m.conn.persist) return;
    try {
      m.conn.persist({ client: m.client, role: m.role, seat: m.seat, seen: m.lastSeen });
    } catch (err) {
      this._log(`could not save a connection's state: ${err}`);
    }
  }

  _load() {
    let saved = null;
    try {
      saved = this._storage.load();
    } catch (err) {
      this._log(`could not load the room state: ${err}`);
    }
    const ride = saved && saved.ride;
    const valid = ride && typeof ride.playing === 'boolean' && Number.isFinite(ride.base)
      && Number.isFinite(ride.at) && Number.isInteger(ride.rev);
    return {
      ride: valid ? { playing: ride.playing, base: ride.base, at: ride.at, rev: ride.rev } : null,
      activeAt: saved && Number.isFinite(saved.activeAt) ? saved.activeAt : null,
    };
  }

  _save() {
    try {
      this._storage.save({ ride: this.ride, activeAt: this._activeAt });
    } catch (err) {
      this._log(`could not save the room state: ${err}`);
    }
  }
}
