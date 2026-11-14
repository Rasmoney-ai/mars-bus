// Shared by the tests that talk to a running relay: starting a private
// local relay, and small WebSocket bots. No dependencies: Node 22 has a
// WebSocket client built in.

import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const relayDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wranglerBin = path.join(relayDir, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A random id, also usable as a room name.
export function randomId(prefix = '') {
  return prefix + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
}

// --- A private local relay -----------------------------------------------------

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

// A plain HTTP request (GET unless options.method says otherwise). Resolves
// with { status, body }; a successful WebSocket upgrade resolves with
// { status: 101 }.
export function httpGet(url, headers = {}, options = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? https : http;
    const req = lib.request(url, { method: 'GET', ...options, headers }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('upgrade', (res, socket) => {
      socket.destroy();
      resolve({ status: res.statusCode, body: '' });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error(`timeout: ${url}`)));
    req.end();
  });
}

// The headers of a WebSocket handshake, for httpGet.
export function upgradeHeaders(extra = {}) {
  return {
    Connection: 'Upgrade',
    Upgrade: 'websocket',
    'Sec-WebSocket-Version': '13',
    'Sec-WebSocket-Key': Buffer.from(randomId()).toString('base64'),
    ...extra,
  };
}

// Starts `wrangler dev` (the real Worker in the local workerd runtime) on a
// free port. Its durable storage lives in a folder of its own, which is
// removed by stop() unless `keepState` is set; `stateDir` names a folder to
// (re)use instead, which is always kept.
// Returns { url, httpUrl, pid, stateDir, started, output(), stop() }.
export async function startRelay({ stateDir = null, keepState = false } = {}) {
  const port = await freePort();
  const inspectorPort = await freePort();
  const dir = stateDir || path.join(relayDir, '.wrangler', `test-state-${process.pid}-${port}`);
  mkdirSync(dir, { recursive: true });

  let output = '';
  const child = spawn(process.execPath, [
    wranglerBin, 'dev',
    '--port', String(port), '--ip', '127.0.0.1',
    '--inspector-port', String(inspectorPort),
    '--persist-to', dir,
    '--show-interactive-dev-session=false',
  ], {
    cwd: relayDir,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false', FORCE_COLOR: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true, // its own process group, so stop() can end wrangler and workerd together
  });
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  let exited = false;
  const done = new Promise((resolve) => child.once('exit', () => { exited = true; resolve(); }));

  const killGroup = (signal) => {
    try {
      process.kill(-child.pid, signal);
    } catch {
      // Already gone.
    }
  };
  const onExit = () => killGroup('SIGKILL');
  process.once('exit', onExit);

  const stop = async () => {
    if (!exited) {
      // Ask wrangler to stop: it then shuts down workerd itself.
      child.kill('SIGTERM');
      await Promise.race([done, sleep(5000)]);
    }
    killGroup('SIGKILL'); // whatever is left of the group
    await done;
    process.removeListener('exit', onExit);
    if (!stateDir && !keepState) rmSync(dir, { recursive: true, force: true });
  };

  const httpUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (exited) throw new Error(`the relay did not start:\n${output}`);
    try {
      const res = await httpGet(`${httpUrl}/`);
      if (res.status === 200 && res.body === 'mars-bus relay ok') break;
    } catch {
      // Not listening yet.
    }
    if (Date.now() > deadline) {
      await stop();
      throw new Error(`the relay did not answer within 60 s:\n${output}`);
    }
    await sleep(200);
  }
  return { url: `ws://127.0.0.1:${port}`, httpUrl, pid: child.pid, stateDir: dir, started: true, output: () => output, stop };
}

// The relay to test: the one named by RELAY_URL (ws://... or wss://...), or
// else a private local one. Returns the same as startRelay. For a relay
// that was not started here, pid is RELAY_PID (the process whose CPU use
// the load test should measure) or null.
export async function relayUnderTest() {
  const given = process.env.RELAY_URL;
  if (!given) return startRelay();
  const url = given.replace(/\/+$/, '');
  const pid = Number(process.env.RELAY_PID) || null;
  return { url, httpUrl: url.replace(/^ws/, 'http'), pid, stateDir: null, started: false, output: () => '', stop: async () => {} };
}

// CPU seconds used so far by a process and all its descendants, as
// { total, workerd, workerdSystem }: `workerd` is the part used by the
// workerd runtime (the relay itself), the rest is wrangler's own tooling;
// `workerdSystem` is the share of `workerd` spent inside the operating
// system (mostly socket reads and writes), or null if unknown.
// On Linux the times come from /proc (10 ms steps), elsewhere from ps
// (whole seconds). Returns null if the process is not found.
export function cpuSeconds(rootPid) {
  try {
    const rows = execFileSync('ps', ['-eo', 'pid=,ppid=,time=,comm='], { encoding: 'utf8' })
      .trim().split('\n').map((line) => line.trim().split(/\s+/));
    const byPid = new Map();
    const children = new Map();
    for (const [pid, ppid, time, ...comm] of rows) {
      byPid.set(pid, { time, name: comm.join(' ') });
      if (!children.has(ppid)) children.set(ppid, []);
      children.get(ppid).push(pid);
    }
    if (!byPid.has(String(rootPid))) return null;
    const used = { total: 0, workerd: 0, workerdSystem: 0 };
    const visit = (pid) => {
      const { time, name } = byPid.get(pid);
      const proc = procSeconds(pid);
      const seconds = proc ? proc.user + proc.system : psSeconds(time);
      used.total += seconds;
      if (name.includes('workerd')) {
        used.workerd += seconds;
        if (proc && used.workerdSystem !== null) used.workerdSystem += proc.system;
        else used.workerdSystem = null;
      }
      for (const child of children.get(pid) || []) visit(child);
    };
    visit(String(rootPid));
    return used;
  } catch {
    return null;
  }
}

// { user, system } CPU seconds of a process from /proc/<pid>/stat (clock
// ticks are 100 Hz on every common Linux). Null where there is no /proc.
function procSeconds(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    return { user: Number(fields[11]) / 100, system: Number(fields[12]) / 100 };
  } catch {
    return null;
  }
}

// "[dd-]hh:mm:ss" or "mm:ss.xx" from ps, in seconds.
function psSeconds(text) {
  const [days, rest] = text.includes('-') ? text.split('-') : ['0', text];
  const parts = rest.split(':').map(Number);
  while (parts.length < 3) parts.unshift(0);
  return Number(days) * 86400 + parts[0] * 3600 + parts[1] * 60 + parts[2];
}

// A WebSocket spoken by hand over a plain socket, for clients that
// misbehave in ways the built-in WebSocket cannot: this one never answers
// a close frame and never closes. Resolves with
// { socket, frames, send(text) }; `frames` collects what the relay sends as
// { opcode, text } (opcode 1 = text, 8 = close).
export function rawSocket(relayUrl, room) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${relayUrl.replace(/^ws/, 'http')}/room/${room}`, { headers: upgradeHeaders() });
    req.on('error', reject);
    req.on('response', (res) => reject(new Error(`no upgrade: ${res.statusCode}`)));
    req.on('upgrade', (res, socket, head) => {
      const frames = [];
      let buffer = head;
      const read = () => {
        // Server frames are not masked: 2 bytes of header, or 4 for 126..65535 bytes.
        for (;;) {
          if (buffer.length < 2) return;
          let length = buffer[1] & 0x7f;
          let start = 2;
          if (length === 126) {
            if (buffer.length < 4) return;
            length = buffer.readUInt16BE(2);
            start = 4;
          }
          if (buffer.length < start + length) return;
          frames.push({ opcode: buffer[0] & 0x0f, text: buffer.subarray(start, start + length).toString('latin1') });
          buffer = buffer.subarray(start + length);
        }
      };
      socket.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        read();
      });
      socket.on('error', () => {});
      read();
      const send = (text) => {
        // One masked text frame (payloads under 126 bytes only).
        const payload = Buffer.from(text);
        if (payload.length > 125) throw new Error('rawSocket.send: too long');
        const mask = Buffer.from([1, 2, 3, 4]);
        const masked = Buffer.from(payload.map((byte, k) => byte ^ mask[k % 4]));
        socket.write(Buffer.concat([Buffer.from([0x81, 0x80 | payload.length]), mask, masked]));
      };
      resolve({ socket, frames, send });
    });
  });
}

// --- Bots ------------------------------------------------------------------------

// One WebSocket connection to a room. Incoming messages are parsed and
// queued by type; next(type) waits for the next one of a type.
export class Bot {
  // Resolves when the socket is open.
  static open(relayUrl, room) {
    return new Promise((resolve, reject) => {
      const bot = new Bot(new WebSocket(`${relayUrl}/room/${room}`));
      bot.ws.addEventListener('open', () => resolve(bot), { once: true });
      bot.ws.addEventListener('error', () => reject(new Error(`could not connect to ${relayUrl}/room/${room}`)), { once: true });
    });
  }

  // Opens a socket and says hello. Resolves with the bot; bot.welcome is
  // the relay's answer.
  static async join(relayUrl, room, { role = 'rider', seat = null, client = randomId('bot-') } = {}) {
    const bot = await Bot.open(relayUrl, room);
    bot.client = client;
    bot.send({ t: 'hello', v: 1, client, role, seat });
    bot.welcome = await bot.next('welcome');
    return bot;
  }

  constructor(ws) {
    this.ws = ws;
    this.client = null;
    this.welcome = null;
    this.queues = new Map();   // type -> messages not yet taken
    this.waiters = new Map();  // type -> [{ resolve, reject, timer }]
    this.closeEvent = null;    // { code, reason } once the socket has closed
    this.closeWaiters = [];
    this.onMessage = null;     // (message) => true to keep it out of the queues

    ws.addEventListener('message', (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        message = { t: '(not json)', data: event.data };
      }
      if (this.onMessage && this.onMessage(message) === true) return;
      const waiting = this.waiters.get(message.t);
      if (waiting && waiting.length) {
        const waiter = waiting.shift();
        clearTimeout(waiter.timer);
        waiter.resolve(message);
        return;
      }
      if (!this.queues.has(message.t)) this.queues.set(message.t, []);
      this.queues.get(message.t).push(message);
    });
    ws.addEventListener('close', (event) => {
      this.closeEvent = { code: event.code, reason: event.reason };
      for (const resolve of this.closeWaiters) resolve(this.closeEvent);
      for (const waiting of this.waiters.values()) {
        for (const waiter of waiting) {
          clearTimeout(waiter.timer);
          waiter.reject(new Error(`the socket closed (${event.code}) while waiting for a message`));
        }
      }
      this.waiters.clear();
    });
  }

  get open() {
    return this.ws.readyState === WebSocket.OPEN;
  }

  send(message) {
    this.ws.send(JSON.stringify(message));
  }

  sendRaw(data) {
    this.ws.send(data);
  }

  // The next message of a type (waits for it if none is queued).
  next(type, timeoutMs = 3000) {
    const queue = this.queues.get(type);
    if (queue && queue.length) return Promise.resolve(queue.shift());
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const waiting = this.waiters.get(type) || [];
        const i = waiting.findIndex((w) => w.timer === timer);
        if (i >= 0) waiting.splice(i, 1);
        reject(new Error(`no "${type}" message within ${timeoutMs} ms`));
      }, timeoutMs);
      if (!this.waiters.has(type)) this.waiters.set(type, []);
      this.waiters.get(type).push({ resolve, reject, timer });
    });
  }

  // All queued messages of a type (and empties that queue).
  take(type) {
    const queue = this.queues.get(type) || [];
    this.queues.set(type, []);
    return queue;
  }

  // Waits `ms`, then returns what arrived of a type: use it to check that
  // nothing (or exactly something) came.
  async after(ms, type) {
    await sleep(ms);
    return this.take(type);
  }

  // One ping/pong round trip. Resolves with { c, s, rtt }: `s` is the
  // relay's clock, rtt the round trip in ms.
  async ping() {
    const c = performance.now();
    this.send({ t: 'ping', c });
    const pong = await this.next('pong');
    return { ...pong, rtt: performance.now() - c };
  }

  // Resolves with { code, reason } when the socket has closed.
  closed(timeoutMs = 3000) {
    if (this.closeEvent) return Promise.resolve(this.closeEvent);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`the socket did not close within ${timeoutMs} ms`)), timeoutMs);
      this.closeWaiters.push((event) => {
        clearTimeout(timer);
        resolve(event);
      });
    });
  }

  // Closes the socket and waits until it is closed.
  async close() {
    if (!this.closeEvent) {
      try {
        this.ws.close(1000);
      } catch {
        // Already closing.
      }
    }
    try {
      await this.closed();
    } catch {
      // Good enough for a test bot.
    }
  }
}
