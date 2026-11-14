// Robot passengers for testing the shared ride: each one is the site's own
// network client (src/network.js) running in Node, sitting on a seat and
// sending a calm, repeatable head and hand movement.
//
//   import { startBots } from './bots.mjs';
//   const bots = await startBots({ relay: 'ws://localhost:8787', room: 'test', seats: [1, 2, 5] });
//   ...
//   bots.stop();
//
// Or from the command line, to fill a bus while you look around in a browser:
//
//   node tests/shared-ride/bots.mjs ws://localhost:8787 <room> 1,2,5,6

// The few browser globals network.js touches.
globalThis.location ??= { hostname: 'localhost' };

const { createNetwork, POSE_LENGTH } = await import('../../src/network.js');
const { NETWORK, SEATS } = await import('../../src/config.js');

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

// Rotation about the vertical axis (radians, positive = to the left), then
// tilted up by `pitch`: quaternion [x, y, z, w].
function lookQuat(yaw, pitch = 0) {
  const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2);
  const cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
  return [cy * sp, sy * cp, -sy * sp, cy * cp];
}

// The pose a robot on `seat` has at `time` seconds: it looks slowly from side
// to side, and every so often points out of its own window. Everything is a
// plain function of the time, so two runs look the same.
export function botPose(seat, time) {
  const d = new Array(POSE_LENGTH).fill(0);
  const phase = seat * 1.7;
  const window = seat % 2 === 1 ? 1 : -1; // odd seats sit on the left: window to the left
  const yaw = 0.55 * Math.sin(time * 0.5 + phase) + 0.25 * window;
  const pitch = 0.08 * Math.sin(time * 0.37 + phase * 2);
  d[0] = 0.03 * Math.sin(time * 0.6 + phase);
  d[1] = SEATS.eyeHeight + 0.01 * Math.sin(time * 0.9 + phase);
  d[2] = 0.02 * Math.cos(time * 0.4 + phase);
  lookQuat(yaw, pitch).forEach((v, i) => { d[3 + i] = v; });

  // Left hand rests on the knee. The right hand points for 4 s out of every 12.
  const pointing = (time + seat * 3) % 12 < 4;
  // left hand
  d[7] = 1;
  d[8] = -0.17; d[9] = 0.62; d[10] = -0.3;
  lookQuat(0.1, -0.2).forEach((v, i) => { d[11 + i] = v; });
  // right hand
  d[15] = pointing ? 2 : 1;
  if (pointing) {
    d[16] = 0.2 + 0.12 * window * -1; d[17] = 1.02; d[18] = -0.38;
    lookQuat(1.1 * window, 0.15).forEach((v, i) => { d[19 + i] = v; });
  } else {
    d[16] = 0.17; d[17] = 0.62; d[18] = -0.3;
    lookQuat(-0.1, -0.2).forEach((v, i) => { d[19 + i] = v; });
  }
  return d;
}

// Starts one robot per seat and waits until each sits on its seat.
export async function startBots({ relay, room, seats, timeout = 15000 }) {
  const nets = seats.map((seat) => {
    const params = new URLSearchParams({ room, relay });
    const net = createNetwork({ params, role: 'rider', seat, duration: Infinity });
    if (!net) throw new Error('createNetwork returned null (room name or relay address not usable)');
    net.setActive(true);
    return net;
  });
  const end = Date.now() + timeout;
  while (!nets.every((n, i) => n.seat === seats[i])) {
    if (Date.now() > end) {
      throw new Error(`robots did not get their seats: wanted ${seats.join(',')}, got ${nets.map((n) => n.seat).join(',')}`);
    }
    await sleep(50);
  }
  const started = Date.now();
  const timer = setInterval(() => {
    const time = (Date.now() - started) / 1000;
    for (const net of nets) {
      if (net.seat !== null) net.sendPose(botPose(net.seat, time));
    }
  }, 1000 / NETWORK.sendHz);
  return {
    nets,
    stop() {
      clearInterval(timer);
      for (const net of nets) net.close();
    },
  };
}

// Command line use.
if (import.meta.url === `file://${process.argv[1]}`) {
  const [relay = 'ws://localhost:8787', room = 'test', list = '1,2,3,4,5,6,7,8,9'] = process.argv.slice(2);
  const seats = list.split(',').map((s) => parseInt(s, 10)).filter((n) => n >= 1 && n <= SEATS.count);
  const bots = await startBots({ relay, room, seats });
  console.log(`Robots on seats ${seats.join(', ')} in room "${room}" on ${relay}. Ctrl+C stops them.`);
  process.on('SIGINT', () => { bots.stop(); process.exit(0); });
}
