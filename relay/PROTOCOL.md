# Shared ride: relay protocol (version 1)

The relay lets the headsets in one classroom share a ride: one clock, who sits
where, and each passenger's head and hand poses. It forwards small JSON
messages over WebSocket. It stores no names, sound or images: only seat
numbers, poses and the ride clock.

No room alignment is needed. Every passenger sits in a fixed seat, so a pose
is sent in *seat space* (origin on the bus floor under that passenger's head,
-z forward, metres; see `src/passengers.js`) and drawn by the others at that
seat in the bus.

## Endpoint

- `GET /` → `200`, plain text `mars-bus relay ok` (health check).
- `GET /room/<room>` with `Upgrade: websocket` → the room's WebSocket.
  `<room>` is lower-cased and must match `^[a-z0-9-]{1,32}$`, else `400`.
  Without the upgrade header → `426`.
- If the request has an `Origin` header it must be in the allow list
  (`ALLOWED_ORIGINS`, comma separated; an entry may end in `:*` to allow any
  port, e.g. `http://localhost:*`), else `403`. Requests without an `Origin`
  header (test bots) are allowed.

One room = one bus = one departure. At most 16 connections per room.

## Messages

All messages are JSON objects with a string field `t` (type). Text frames
only, at most 2048 bytes. Times called "server ms" are the relay's
`Date.now()`.

### Client → relay

| `t` | Fields | Meaning |
|---|---|---|
| `hello` | `v: 1`, `client: string` (8–64 chars, random, stable per device), `role: "rider" \| "control"`, `seat: 1..10 \| null` | Must be the first message. A rider may ask for a seat right away. |
| `seat` | `seat: 1..10 \| null` | Rider asks for another seat, or gives up the seat (`null`). |
| `ping` | `c: number` | Clock sync. `c` is echoed back untouched. |
| `pose` | `d: number[]` (1–32 finite numbers) | The rider's current pose. Ignored if the sender has no seat. |
| `cmd` | `op: "play" \| "pause" \| "seek" \| "restart"`, and for `seek`: `time: number` (ride seconds) | Change the shared ride clock. Only allowed for senders that may control (below). |

### Relay → client

| `t` | Fields | Meaning |
|---|---|---|
| `welcome` | `v: 1`, `now: server ms`, `seat: 1..10 \| null`, `peers`, `control`, `ride` | Answer to `hello`. `seat` is the granted seat, or `null` if it was taken or not asked for. |
| `peers` | `peers: number[]` (occupied seats, sorted), `control: boolean` | Sent to everyone whenever a seat is taken or freed, or a control page comes or goes. `peers` includes the receiver's own seat. |
| `seat` | `seat: 1..10 \| null`, `ok: boolean` | Answer to a `seat` request. `seat` is what the sender holds now. |
| `pong` | `c`, `s: server ms` | Answer to `ping`, sent at once. |
| `pose` | `seat: 1..10`, `d: number[]` | Another rider's pose, forwarded unchanged to everyone except the sender. |
| `ride` | `playing: boolean`, `base: number`, `at: server ms`, `rev: number` | The shared ride clock (below). Sent to everyone on every change. Also inside `welcome`. |
| `denied` | `op: string` | A `cmd` from a sender that may not control. |
| `error` | `code: string`, `message: string` | Protocol error; the relay closes the socket afterwards. Codes: `version`, `hello`, `full`, `size`, `bad`. |

`peers` in `welcome` and `control` in `welcome` have the same meaning as in
the `peers` message.

### Close codes

- `4000` protocol error (after an `error` message)
- `4001` replaced: the same `client` connected again; the new connection
  takes over the old one's seat and role
- `4002` room full

## Seats

- A seat (1–10) is held by at most one rider.
- A request for a free seat is granted. A request for a seat held by another
  client is refused, unless that holder has sent nothing for 15 seconds
  (stale): then the seat moves to the asker and the stale holder keeps its
  connection without a seat (it gets a `seat` message with `ok: false`).
- Asking for the seat you already hold is granted again (idempotent).
- A control page never holds a seat.
- When a connection closes, its seat is freed.

## Who may control the ride

- A `control` connection (the teacher's page) always may.
- A rider may only while no `control` connection is in the room. This makes a
  quick test with two headsets possible without a teacher's computer.

## The ride clock

The relay keeps `{ playing, base, at, rev }`:

    ride time (seconds) = playing ? base + (now - at) / 1000 : base

where `now` is server ms. Commands:

- `play`: if not playing → `playing = true`, `at = now`.
- `pause`: if playing → `base = ride time`, `playing = false`.
- `seek`: `base = clamp(time, 0, 86400)`, `at = now` (playing unchanged).
- `restart`: `base = 0`, `at = now`, `playing = true`.

`rev` goes up by one on every change. The relay does not know how long the
ride is; clients clamp the ride time to their own timeline's duration.

The clock is kept in durable storage, so a restart of the relay in the middle
of a ride does not send everyone back to the start. When a room has been
empty for more than 10 minutes, the next connection starts with a fresh clock
(`playing: false`, `base: 0`).

## Clock sync (client side)

A client estimates the relay's clock from `ping`/`pong`:

    rtt = receiveTime - c
    offset sample = s + rtt / 2 - receiveTime      (server ms minus local ms)

It keeps the sample with the smallest `rtt` among the latest ones and moves
its offset smoothly towards it, so the ride time never jumps.

## Pose array `d`

23 numbers, seat space, metres, quaternions as x, y, z, w:

    0..2    head position
    3..6    head quaternion
    7       left hand: 0 = not tracked, 1 = rest, 2 = point
    8..10   left wrist position
    11..14  left wrist quaternion
    15      right hand: 0 = not tracked, 1 = rest, 2 = point
    16..18  right wrist position
    19..22  right wrist quaternion

The relay does not look inside `d`; it only checks that it is an array of at
most 32 finite numbers.

## Limits

- 16 connections per room, 2048 bytes per message.
- More than 40 `pose` messages per second from one connection: the extra
  ones are dropped silently.
