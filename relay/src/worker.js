// The relay on Cloudflare Workers (see ../PROTOCOL.md).
//
// The Worker checks each request (Origin, path, room name) and hands a
// WebSocket to the room's Durable Object: one object per room. The object
// adapts Cloudflare's WebSocket Hibernation API to the room logic in
// room-core.js, which knows nothing about Cloudflare.

import { DurableObject } from 'cloudflare:workers';
import { RoomCore } from './room-core.js';

const ROOM_NAME = /^[a-z0-9-]{1,32}$/;
const STORAGE_KEY = 'room'; // the room's saved state: { ride, activeAt }

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    if (origin !== null && !originAllowed(origin, env.ALLOWED_ORIGINS)) {
      return text(403, 'origin not allowed');
    }
    if (request.method !== 'GET') return text(405, 'method not allowed', { Allow: 'GET' });

    const path = new URL(request.url).pathname;
    if (path === '/') return text(200, 'mars-bus relay ok');
    if (!path.startsWith('/room/')) return text(404, 'not found');

    const room = path.slice('/room/'.length).toLowerCase();
    if (!ROOM_NAME.test(room)) return text(400, 'bad room name');
    if (!wantsWebSocket(request)) return text(426, 'expected a WebSocket');

    // One Durable Object per room, found by the room's name. It is created
    // in the Cloudflare data centre nearest the first visitor, so for a
    // Danish school in Europe. To *guarantee* that a room runs and stores
    // its clock inside the EU, ask for the id like this instead:
    //   const id = env.ROOMS.jurisdiction('eu').idFromName(room);
    // That is not done here because the local runtime cannot run it
    // ("Jurisdiction restrictions are not implemented in workerd"), so it
    // could not be tested before deployment.
    const id = env.ROOMS.idFromName(room);
    return env.ROOMS.get(id).fetch(request);
  },
};

function text(status, body, headers = {}) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', ...headers },
  });
}

function wantsWebSocket(request) {
  return (request.headers.get('Upgrade') || '').toLowerCase() === 'websocket';
}

// True if `origin` (the request's Origin header) is in the comma separated
// allow list. An entry ending in ":*" allows any port, and no port:
// "http://localhost:*" allows http://localhost and http://localhost:8000.
function originAllowed(origin, allowList) {
  const wanted = origin.trim().toLowerCase();
  for (const entry of String(allowList || '').split(',')) {
    const allowed = entry.trim().toLowerCase();
    if (allowed === '') continue;
    if (!allowed.endsWith(':*')) {
      if (wanted === allowed) return true;
      continue;
    }
    const host = allowed.slice(0, -2);
    if (wanted === host) return true;
    if (wanted.startsWith(`${host}:`) && /^[0-9]{1,5}$/.test(wanted.slice(host.length + 1))) return true;
  }
  return false;
}

// One room. Cloudflare may put the object to sleep ("hibernate") whenever
// the room is quiet for some seconds: the sockets stay open, but everything
// in memory is lost, and the constructor runs again when the next message
// arrives. So nothing may live in memory only:
// - the ride clock is in durable storage,
// - each socket carries a small attachment { id, client, role, seat, seen }
//   that the room is rebuilt from.
export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // WebSocket -> connection id, for the sockets that are in the room.
    this.ids = new Map();
    this.core = new RoomCore({
      now: () => Date.now(),
      storage: {
        load: () => ctx.storage.kv.get(STORAGE_KEY) ?? null,
        save: (state) => ctx.storage.kv.put(STORAGE_KEY, state),
      },
      log: (line) => console.warn(`room ${ctx.id.name}: ${line}`),
    });

    // Sockets that were open before the object went to sleep.
    let restored = 0;
    for (const ws of ctx.getWebSockets()) {
      let saved = null;
      try {
        saved = ws.deserializeAttachment();
      } catch {
        // Handled below: without its attachment the socket is of no use.
      }
      if (saved && saved.closed) continue; // closed by us, the other side has not answered yet
      if (!saved || typeof saved.id !== 'string') {
        // Should not happen. Close it, so that the client connects again.
        try {
          ws.close(1011, 'state lost');
        } catch {
          // Already closed.
        }
        continue;
      }
      this.core.restore(this.connection(ws, saved.id), saved);
      restored += 1;
    }
    if (restored > 0) console.log(`room ${ctx.id.name}: woke up with ${restored} connection(s)`);
  }

  // A new WebSocket for this room (the Worker has checked the request).
  async fetch(request) {
    if (!wantsWebSocket(request)) return text(426, 'expected a WebSocket');
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const id = crypto.randomUUID();
    if (this.core.full) {
      // The room logic will say "full" on the socket and close it. Such a
      // socket is accepted the plain way, not for hibernation: a
      // hibernating socket that the relay closes before the client has
      // sent anything never gets its close event (seen in local workerd).
      server.accept();
      this.core.connect({
        id,
        send: (message) => server.send(message),
        close: (code, reason) => server.close(code, reason),
      });
    } else {
      this.ctx.acceptWebSocket(server);
      this.core.connect(this.connection(server, id));
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, message) {
    const id = this.ids.get(ws);
    if (id === undefined) return; // a socket we have already closed
    try {
      this.core.message(id, message);
    } catch (err) {
      console.error(`room ${this.ctx.id.name}: message failed: ${(err && err.stack) || err}`);
    }
  }

  webSocketClose(ws, code) {
    this.gone(ws);
    // Answer the close frame, so that the other side sees a clean close.
    // (Newer runtimes answer by themselves; then this does nothing.)
    try {
      ws.close(code === 1000 || (code >= 3000 && code <= 4999) ? code : 1000);
    } catch {
      // Already closed.
    }
  }

  webSocketError(ws) {
    this.gone(ws);
    try {
      ws.close(1011, 'error');
    } catch {
      // Already closed.
    }
  }

  // The room's view of a socket (see room-core.js).
  connection(ws, id) {
    this.ids.set(ws, id);
    return {
      id,
      send: (message) => ws.send(message),
      close: (code, reason) => {
        this.forget(ws, id);
        ws.close(code, reason);
      },
      persist: (state) => ws.serializeAttachment({ id, ...state }),
    };
  }

  // The socket closed or failed: take it out of the room.
  gone(ws) {
    const id = this.ids.get(ws);
    if (id === undefined) return;
    this.forget(ws, id);
    try {
      this.core.disconnect(id);
    } catch (err) {
      console.error(`room ${this.ctx.id.name}: disconnect failed: ${(err && err.stack) || err}`);
    }
  }

  // A closing socket can stay in ctx.getWebSockets() until the other side
  // has answered. The mark keeps it from being put back into the room if
  // the object goes to sleep in the meantime.
  forget(ws, id) {
    this.ids.delete(ws);
    try {
      ws.serializeAttachment({ id, closed: true });
    } catch {
      // The socket is gone already.
    }
  }
}
