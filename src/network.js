// The shared ride: one clock for the whole bus, and the other passengers'
// real head and hand poses, through a small relay (see relay/PROTOCOL.md).
// Used only when the address has ?room=<name>.
//
// Nothing here knows about three.js or the scene. main.js uses:
//   network.clock            a clock with the same interface as LocalClock
//   network.sendPose(d)      our own pose (seat space), a few times a second
//   network.passengers(now)  the others, in the data format of passengers.js
//
// No room alignment is involved: a headset only knows its seat number. A
// pose is measured from the passenger's own seat and drawn at that seat.

import { NETWORK, SEATS } from './config.js';

const VERSION = 1;

// Pose array (relay/PROTOCOL.md): head position 0..2 and quaternion 3..6,
// then for each hand a flag (0 none, 1 rest, 2 point), position, quaternion.
export const POSE_LENGTH = 23;
const HAND = [7, 15];
// Received poses are never placed closer together in time than this (ms).
const MIN_SPACING = 500 / NETWORK.sendHz;

// A room name from the address, or null if it is missing or not usable.
export function roomName(text) {
  const room = String(text || '').trim().toLowerCase();
  return /^[a-z0-9-]{1,32}$/.test(room) ? room : null;
}

// The relay's address. On your own machine (localhost) it can be set with
// ?relay=ws://localhost:8787 for testing.
function relayBase(params) {
  const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  const override = local && params ? params.get('relay') : null;
  return (override || NETWORK.relayUrl || '').replace(/\/+$/, '');
}

// The network for ?room=<name>, or null for the solo ride (no room in the
// address, or the relay is not set up).
// options: { params: URLSearchParams, role: 'rider' | 'control',
//            seat: wanted seat or null for the first free one,
//            duration: length of the ride in seconds }
export function createNetwork({ params, role = 'rider', seat = null, duration = Infinity } = {}) {
  const room = roomName(params && params.get('room'));
  const base = relayBase(params);
  if (!room || !base || typeof WebSocket === 'undefined') return null;
  return new Network({ url: `${base}/room/${room}`, room, role, seat, duration });
}

const validSeat = (n) => Number.isInteger(n) && n >= 1 && n <= SEATS.count;

function randomId() {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

// One id per browser tab, kept across reloads, so a reconnect takes over the
// old connection (and its seat) instead of fighting it.
function clientId(role) {
  const key = `marsbus-client-${role}`;
  try {
    let id = sessionStorage.getItem(key);
    if (!id) {
      id = randomId();
      sessionStorage.setItem(key, id);
    }
    return id;
  } catch {
    return randomId();
  }
}

export class Network {
  constructor({ url, room, role, seat, duration }) {
    this.url = url;
    this.room = room;
    this.role = role;
    this.client = clientId(role);
    this.preferredSeat = validSeat(seat) ? seat : null;
    this.seat = null;             // the seat the relay has given us
    this.peers = [];              // occupied seats, ours included
    this.control = false;         // a teacher's control page is in the room
    // connecting | online | offline | replaced | full | outdated
    this.status = 'connecting';
    this.active = false;          // true while riding: the clock is synced more often
    this.rtt = null;              // best round trip to the relay (ms), for the debug line
    this.onChange = null;         // seat, peers, status or the ride clock changed
    this.onSeat = null;           // (seat) the relay gave us this seat
    this.onDenied = null;         // (op) a command was refused: the teacher steers
    this.clock = new SharedClock(this, duration);

    this._ws = null;
    this._closed = false;
    this._retry = 0;
    this._reconnectTimer = null;
    this._pingTimer = null;
    this._burst = 0;
    this._heard = 0;              // performance.now() of the latest message
    this._error = null;
    this._seatTries = 0;
    this._seatAsked = 0;          // seat requests still waiting for their answer
    // Clock sync: relay clock minus performance.now(), in ms.
    this._samples = [];
    this._offset = null;
    this._target = null;
    this._rough = true;
    this._slewAt = 0;
    // Other passengers: seat -> { samples: [{ time, d }], out: passenger data }
    this._remote = new Map();
    this._list = [];
    this.connect();
  }

  // True when this page may start, pause and seek the shared ride: the
  // teacher's page always, a rider only while no teacher's page is connected.
  get canControl() {
    return this.status === 'online' && (this.role === 'control' || !this.control);
  }

  // Number of occupied seats.
  get riders() {
    return this.peers.length;
  }

  connect() {
    if (this._closed) return;
    clearTimeout(this._reconnectTimer);
    let ws;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this._scheduleReconnect();
      return;
    }
    this._ws = ws;
    this._heard = performance.now();
    ws.onopen = () => {
      if (ws !== this._ws) return;
      this._heard = performance.now();
      this._send({
        t: 'hello', v: VERSION, client: this.client, role: this.role,
        seat: this.role === 'rider' ? (this.seat ?? this.preferredSeat) : null,
      });
    };
    ws.onmessage = (e) => { if (ws === this._ws) this._onMessage(e.data); };
    ws.onclose = (e) => { if (ws === this._ws) this._onClose(e.code); };
    ws.onerror = () => { /* a close event follows */ };
  }

  // Stop for good (leaving the page).
  close() {
    this._closed = true;
    clearTimeout(this._reconnectTimer);
    clearTimeout(this._pingTimer);
    if (this._ws) {
      try { this._ws.close(); } catch { /* already closed */ }
      this._ws = null;
    }
  }

  // While riding (in VR or watching on the screen) the clock is synced often.
  setActive(on) {
    if (on === this.active) return;
    this.active = on;
    if (this.status === 'online') this._startPings(on);
  }

  // Ask for another seat. The answer comes through onSeat / onChange.
  claimSeat(seat) {
    if (this.role !== 'rider' || !validSeat(seat)) return;
    this.preferredSeat = seat;
    this._askSeat(seat);
  }

  // Change the shared ride clock: 'play' | 'pause' | 'seek' | 'restart'.
  command(op, time) {
    if (!this.canControl) {
      if (this.onDenied) this.onDenied(op);
      return;
    }
    this._send(op === 'seek' ? { t: 'cmd', op, time } : { t: 'cmd', op });
  }

  // Our own pose: POSE_LENGTH numbers in seat space (see the top of the file).
  sendPose(d) {
    const ws = this._ws;
    if (!ws || ws.readyState !== 1 || this.seat === null) return;
    // A slow link: skip this one rather than queue up old poses.
    if (ws.bufferedAmount > 8192) return;
    let text = '{"t":"pose","d":[';
    for (let i = 0; i < POSE_LENGTH; i++) {
      const v = Number.isFinite(d[i]) ? Math.round(d[i] * 1e4) / 1e4 : 0;
      text += i ? `,${v}` : v;
    }
    ws.send(`${text}]}`);
  }

  // The relay's clock (ms), estimated from ping/pong; null until the relay
  // has answered once. The estimate is nudged, never jumped (except when it
  // is far off), so the ride time runs smoothly.
  serverNow() {
    if (this._offset === null) return null;
    const now = performance.now();
    const d = this._target - this._offset;
    if (d !== 0) {
      const step = Math.max(0, now - this._slewAt) * NETWORK.maxSlew;
      this._offset += Math.max(-step, Math.min(step, d));
    }
    this._slewAt = now;
    return now + this._offset;
  }

  // The other passengers at time `now` (performance.now()), in the data
  // format of passengers.js. They are drawn a moment behind (delayMs) and
  // blended between the two nearest received poses, so 15 poses a second
  // look smooth at 72-90 frames a second.
  passengers(now = performance.now()) {
    const list = this._list;
    list.length = 0;
    const at = now - NETWORK.delayMs;
    for (const r of this._remote.values()) {
      const s = r.samples;
      const n = s.length;
      if (!n || now - s[n - 1].time > NETWORK.staleMs) continue;
      let i = -1;
      for (let k = 0; k < n; k++) if (s[k].time <= at) i = k;
      const a = s[Math.max(i, 0)];
      const b = i >= 0 && i < n - 1 ? s[i + 1] : a;
      const alpha = b === a ? 0 : (at - a.time) / (b.time - a.time);
      blend(r.out, a.d, b.d, alpha);
      list.push(r.out);
    }
    return list;
  }

  // --- Internals ---------------------------------------------------------------

  _send(message) {
    const ws = this._ws;
    if (!ws || ws.readyState !== 1) return false;
    try {
      ws.send(JSON.stringify(message));
      return true;
    } catch {
      return false;
    }
  }

  _changed() {
    if (this.onChange) this.onChange();
  }

  _onMessage(text) {
    let m;
    try { m = JSON.parse(text); } catch { return; }
    if (!m || typeof m.t !== 'string') return;
    this._heard = performance.now();
    switch (m.t) {
      case 'pose': this._onPose(m); break;
      case 'pong': this._onPong(m); break;
      case 'welcome': this._onWelcome(m); break;
      case 'peers':
        this._applyPeers(m.peers, m.control);
        if (this.role === 'rider' && this.seat === null) this._claimFreeSeat();
        this._changed();
        break;
      case 'seat':
        this._seatAsked = Math.max(0, this._seatAsked - 1);
        this._gotSeat(m.seat);
        if (this.seat === null) this._claimFreeSeat();
        this._changed();
        break;
      case 'ride':
        this.clock._apply(m);
        this._changed();
        break;
      case 'denied':
        if (this.onDenied) this.onDenied(m.op);
        break;
      case 'error':
        this._error = m.code;
        break;
      default:
        break;
    }
  }

  _onWelcome(m) {
    this._retry = 0;
    this._seatTries = 0;
    this._seatAsked = 0;
    this.status = 'online';
    // A first rough clock estimate; the pings below make it precise. After
    // a reconnect the old estimate is kept and only nudged, so the ride
    // does not jump.
    this._samples.length = 0;
    this._rough = this._offset === null;
    if (this._offset === null && typeof m.now === 'number') {
      this._offset = this._target = m.now - performance.now();
      this._slewAt = performance.now();
    }
    this._applyPeers(m.peers, m.control);
    this.clock._apply(m.ride);
    this._gotSeat(m.seat);
    if (this.role === 'rider' && this.seat === null) this._claimFreeSeat();
    this._startPings(true);
    this._changed();
  }

  _gotSeat(seat) {
    this.seat = validSeat(seat) ? seat : null;
    if (this.seat !== null) {
      this._remote.delete(this.seat);
      if (this.onSeat) this.onSeat(this.seat);
    }
  }

  _askSeat(seat) {
    if (this._send({ t: 'seat', seat })) this._seatAsked++;
  }

  // Take the first free seat (when ours was taken, or none was asked for).
  // One request at a time: when several headsets join at once, each one that
  // is refused simply asks for the next free seat.
  _claimFreeSeat() {
    if (this.status !== 'online' || this._seatAsked > 0 || this._seatTries >= 4 * SEATS.count) return;
    for (let n = 1; n <= SEATS.count; n++) {
      if (!this.peers.includes(n)) {
        this._seatTries++;
        this._askSeat(n);
        return;
      }
    }
  }

  _applyPeers(peers, control) {
    const before = this.peers.length;
    this.peers = Array.isArray(peers) ? peers.filter(validSeat) : [];
    this.control = control === true;
    if (this.peers.length < before) this._seatTries = 0;
    for (const seat of this._remote.keys()) {
      if (!this.peers.includes(seat)) this._remote.delete(seat);
    }
  }

  _onPong(m) {
    const now = performance.now();
    if (typeof m.c !== 'number' || typeof m.s !== 'number') return;
    const rtt = now - m.c;
    if (!(rtt >= 0 && rtt < 5000)) return;
    this._samples.push({ rtt, offset: m.s + rtt / 2 - now });
    if (this._samples.length > 12) this._samples.shift();
    let best = this._samples[0];
    for (const s of this._samples) if (s.rtt < best.rtt) best = s;
    this.rtt = best.rtt;
    this._target = best.offset;
    if (this._offset === null || this._rough || Math.abs(this._target - this._offset) > 500) {
      this._offset = this._target;
      this._slewAt = now;
    }
    this._rough = false;
  }

  _onPose(m) {
    const seat = m.seat, d = m.d;
    if (!validSeat(seat) || seat === this.seat || !Array.isArray(d) || d.length < POSE_LENGTH) return;
    for (let i = 0; i < POSE_LENGTH; i++) {
      if (typeof d[i] !== 'number' || !Number.isFinite(d[i])) return;
    }
    // A head far from its seat is a broken pose: ignore it.
    if (Math.abs(d[0]) > 3 || d[1] < -1 || d[1] > 4 || Math.abs(d[2]) > 3) return;
    let r = this._remote.get(seat);
    if (!r) {
      r = { samples: [], out: newPassenger(seat) };
      this._remote.set(seat, r);
    }
    const s = r.samples;
    const now = performance.now();
    let time = now;
    if (s.length) {
      // Poses that arrive in a burst (after a short stall on the network) are
      // spread out, so the movement catches up smoothly instead of jumping.
      time = Math.max(now, s[s.length - 1].time + MIN_SPACING);
      if (time - now > 400) {
        // Too far behind: start again from this pose.
        s.length = 0;
        time = now;
      }
    }
    s.push({ time, d });
    if (s.length > 8) s.shift();
  }

  _startPings(burst) {
    clearTimeout(this._pingTimer);
    this._burst = burst ? 5 : 0;
    this._ping();
  }

  _ping() {
    if (this._closed || !this._ws) return;
    const interval = 1000 * (this.active ? NETWORK.pingSeconds : NETWORK.idlePingSeconds);
    // Nothing heard for several pings: the connection is dead even if the
    // browser has not noticed yet. Drop it and connect again.
    if (performance.now() - this._heard > 3 * interval + 3000) {
      const ws = this._ws;
      this._ws = null;
      try { ws.close(); } catch { /* already closed */ }
      this._onClose(1006);
      return;
    }
    this._send({ t: 'ping', c: performance.now() });
    this._pingTimer = setTimeout(() => this._ping(), this._burst-- > 0 ? 200 : interval);
  }

  _onClose(code) {
    this._ws = null;
    this._seatAsked = 0;
    clearTimeout(this._pingTimer);
    if (this._closed) return;
    const error = this._error;
    this._error = null;
    if (code === 4001) {
      // The same tab id connected somewhere else (a duplicated tab).
      this.status = 'replaced';
    } else if (error === 'version') {
      this.status = 'outdated';
    } else if (code === 4002 || error === 'full') {
      this.status = 'full';
      this._scheduleReconnect(10000);
    } else {
      this.status = 'offline';
      this._scheduleReconnect();
    }
    this._changed();
  }

  _scheduleReconnect(ms) {
    clearTimeout(this._reconnectTimer);
    const wait = ms ?? Math.min(5000, 500 * 2 ** this._retry++) * (0.75 + Math.random() * 0.5);
    this._reconnectTimer = setTimeout(() => this.connect(), wait);
  }
}

// The shared ride clock, with the same interface as LocalClock (clock.js).
// The relay keeps { playing, base, at }; play(), pause() and seek() ask the
// relay to change it, and the change comes back to everyone at once.
export class SharedClock {
  constructor(network, duration) {
    this.network = network;
    this.duration = duration;
    this._ride = { playing: false, base: 0, at: 0, rev: 0 };
  }

  _raw() {
    const r = this._ride;
    if (!r.playing) return r.base;
    const now = this.network.serverNow();
    return now === null ? r.base : r.base + (now - r.at) / 1000;
  }

  getTime() {
    return Math.min(Math.max(this._raw(), 0), this.duration);
  }

  get playing() {
    return this._ride.playing && this.network.serverNow() !== null && this._raw() < this.duration;
  }

  play() {
    if (this.playing) return;
    this.network.command(this._raw() >= this.duration ? 'restart' : 'play');
  }

  pause() {
    // Also after the end of the ride: the relay does not know the ride's
    // length, so there the clock is still running.
    if (this._ride.playing) this.network.command('pause');
  }

  seek(t) {
    this.network.command('seek', Math.min(Math.max(t, 0), this.duration));
  }

  restart() {
    this.network.command('restart');
  }

  _apply(ride) {
    if (!ride || typeof ride.playing !== 'boolean' || !Number.isFinite(ride.base) || !Number.isFinite(ride.at)) return;
    this._ride = { playing: ride.playing, base: ride.base, at: ride.at, rev: ride.rev | 0 };
  }
}

// --- Passenger data (see passengers.js) -----------------------------------------

function newPassenger(seat) {
  const hand = () => ({ position: [0, 0, 0], quaternion: [0, 0, 0, 1], pose: 'rest' });
  return {
    seat,
    head: { position: [0, 0, 0], quaternion: [0, 0, 0, 1] },
    hands: [null, null],
    _hands: [hand(), hand()],
  };
}

// Blend two pose arrays into passenger data: alpha 0 = a, 1 = b.
function blend(out, a, b, alpha) {
  mixPosition(out.head.position, a, b, 0, alpha);
  mixQuaternion(out.head.quaternion, a, b, 3, alpha);
  for (let i = 0; i < 2; i++) {
    const o = HAND[i];
    const fa = a[o], fb = b[o];
    if (!fa && !fb) {
      out.hands[i] = null;
      continue;
    }
    const hand = out._hands[i];
    // Tracked in only one of the two poses: show that one as it is.
    const from = fa ? a : b, to = fb ? b : a;
    mixPosition(hand.position, from, to, o + 1, alpha);
    mixQuaternion(hand.quaternion, from, to, o + 4, alpha);
    hand.pose = (alpha < 0.5 ? from[o] : to[o]) === 2 ? 'point' : 'rest';
    out.hands[i] = hand;
  }
}

function mixPosition(out, a, b, o, alpha) {
  for (let k = 0; k < 3; k++) out[k] = a[o + k] + (b[o + k] - a[o + k]) * alpha;
}

// Normalised linear blend: fine for the small turns between two poses.
function mixQuaternion(out, a, b, o, alpha) {
  const dot = a[o] * b[o] + a[o + 1] * b[o + 1] + a[o + 2] * b[o + 2] + a[o + 3] * b[o + 3];
  const sign = dot < 0 ? -1 : 1;
  let len = 0;
  for (let k = 0; k < 4; k++) {
    out[k] = a[o + k] + (sign * b[o + k] - a[o + k]) * alpha;
    len += out[k] * out[k];
  }
  len = Math.sqrt(len);
  if (len < 1e-6) {
    out[0] = out[1] = out[2] = 0;
    out[3] = 1;
  } else {
    for (let k = 0; k < 4; k++) out[k] /= len;
  }
}
