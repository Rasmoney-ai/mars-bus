// sim-headset.mjs: a simulated Meta Quest 3 for headless Chromium.
//
// Injects Meta's Immersive Web Emulation Runtime (npm package `iwer`) into a
// page before the app's own scripts run, so `navigator.xr` is an emulated
// Quest 3 with hand tracking. The head and hands are then posed from Node
// through Playwright. See NOTES.md for the recipe, gotchas and numbers.
//
// Coordinates: the headset's own tracking space, i.e. WebXR 'local-floor':
// metres, y up from the real floor, -z forward, +x to the right.
// Angles are in degrees, applied as yaw, then pitch, then roll:
//   yaw > 0 turns left, pitch > 0 tilts up, roll > 0 tilts to the left.
//
// Typical use:
//   const browser = await launchBrowser();
//   const headset = await openHeadset(browser, 'http://localhost:8080/?seat=3',
//     { name: 'seat-3', head: { position: [0, 1.1, 0] } });
//   await headset.enterVR();
//   await headset.setHead({ yawDeg: 40 });
//   await headset.setHand('right', { position: [-0.2, 0.98, -0.36], yawDeg: 40, pitchDeg: 25, pose: 'point' });
//   await headset.screenshot('view.png');
//   await headset.close(); await browser.close();

import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = fileURLToPath(new URL('.', import.meta.url));

// IWER's browser build (defines window.IWER). The only npm dependency.
const IWER_BUILD = join(HERE, 'node_modules', 'iwer', 'build', 'iwer.min.js');

// Playwright: a local `playwright-core`/`playwright` if installed, else the
// global one (found through NODE_PATH, or at its fixed place on this machine).
function loadPlaywright() {
  const candidates = ['playwright-core', 'playwright', '/opt/npm-tools/node_modules/playwright-core'];
  for (const id of candidates) {
    try { return require(id); } catch { /* try the next one */ }
  }
  throw new Error('Playwright not found. Install playwright-core next to this file, or set NODE_PATH.');
}

// ---------------------------------------------------------------------------
// Static file server
// ---------------------------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.wasm': 'application/wasm',
  '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
};

/**
 * Serves a folder on http://localhost (a secure context, which WebXR needs).
 * Read-only, and files are never cached, so edits show up on the next load.
 * @param {string} root folder to serve
 * @param {{ port?: number }} [options] port 0 (default) picks a free port
 * @returns {Promise<{ url: string, port: number, close: () => Promise<void> }>}
 *   url ends with a slash, e.g. http://localhost:41234/
 */
export async function startStaticServer(root, { port = 0 } = {}) {
  const base = resolve(root);
  const server = createServer(async (req, res) => {
    try {
      const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      let file = normalize(join(base, path));
      if (file !== base && !file.startsWith(base + sep)) { res.writeHead(403).end(); return; }
      if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
      const body = await readFile(file);
      res.writeHead(200, {
        'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
        'cache-control': 'no-store',
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
    }
  });
  await new Promise((ok, fail) => server.once('error', fail).listen(port, '127.0.0.1', ok));
  const actual = server.address().port;
  return {
    url: `http://localhost:${actual}/`,
    port: actual,
    close: () => new Promise((ok) => { server.closeAllConnections(); server.close(() => ok()); }),
  };
}

// ---------------------------------------------------------------------------
// Browser
// ---------------------------------------------------------------------------

/**
 * Launches headless Chromium. WebGL is drawn in software (there is no GPU);
 * Playwright passes the switch that allows this (--enable-unsafe-swiftshader)
 * by itself, so no extra switches are needed.
 * @param {object} [options]
 * @param {'headless-shell'|'chromium'} [options.engine] 'headless-shell'
 *   (default, Playwright's chrome-headless-shell) or 'chromium' (the full
 *   browser in its new headless mode; same speed, more background noise).
 * @param {'swiftshader'|'lavapipe'} [options.gl] software renderer for WebGL.
 *   'swiftshader' (default) is Chromium's own and uses both cores. 'lavapipe'
 *   (Mesa) only exists on this sandbox image: it draws on one core, so one
 *   headset gets slightly fewer frames, for about 30% less CPU time a frame.
 * @param {string[]} [options.args] extra Chromium switches
 * @param {boolean} [options.headless] default true
 * @returns {Promise<import('playwright-core').Browser>}
 */
export async function launchBrowser({ engine = 'headless-shell', gl = 'swiftshader', args = [], headless = true } = {}) {
  const { chromium } = loadPlaywright();
  const env = { ...process.env };
  // Read by the Chromium wrapper scripts of this sandbox image.
  if (gl === 'lavapipe') env.CHROMIUM_WEBGL_RENDERER = 'lavapipe-patched';
  else delete env.CHROMIUM_WEBGL_RENDERER;
  return chromium.launch({
    headless,
    channel: engine === 'chromium' ? 'chromium' : undefined,
    env,
    args,
  });
}

// ---------------------------------------------------------------------------
// Page side: runs inside the page, before the app's scripts. It is sent to the
// browser as text, so it cannot use anything from this file.
// ---------------------------------------------------------------------------

/* eslint-disable no-undef */
function installSimulatedHeadset(o) {
  if (window.top !== window) return; // top frame only
  const { XRDevice, XRSession, XRFrame, XRViewerPose, metaQuest3 } = window.IWER;
  const oneView = !o.stereo && o.monoViews !== 2;

  const device = new XRDevice(metaQuest3, {
    stereoEnabled: o.stereo,
    fovy: (o.fovyDeg * Math.PI) / 180,
    // With one view the eye sits exactly at the head position.
    ipd: oneView ? 0 : o.ipd,
    // IWER clears the canvas before every frame. When drawing on demand that
    // would wipe the last image, and the app clears anyway before it draws.
    frameClearEnabled: o.render !== 'onDemand',
  });
  // Chromium has its own (deviceless) navigator.xr on localhost, so IWER
  // must be told to replace it.
  device.installRuntime({ forceInstall: true });
  device.primaryInputMode = 'hand';

  // Mono: hand the app one view. Stock IWER always reports two views and
  // gives the right eye a zero-width viewport, so three.js would still send
  // the whole scene to the GPU a second time.
  if (oneView) {
    const getViewerPose = XRFrame.prototype.getViewerPose;
    XRFrame.prototype.getViewerPose = function (referenceSpace) {
      const pose = getViewerPose.call(this, referenceSpace);
      if (!pose || pose.views.length < 2 || device.stereoEnabled) return pose;
      return new XRViewerPose(pose.transform, [pose.views[0]], pose.emulatedPosition);
    };
  }

  // Switch off multisampling on WebGL canvases, unless asked to keep it
  // (the app asks for antialiasing, which is costly in a software renderer).
  if (!o.antialias) {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, attributes, ...rest) {
      if (/webgl/.test(type)) attributes = { ...attributes, antialias: false };
      return getContext.call(this, type, attributes, ...rest);
    };
  }

  // yaw, pitch, roll in degrees -> quaternion [x, y, z, w] (order Y, X, Z).
  const quat = (yawDeg, pitchDeg, rollDeg) => {
    const k = Math.PI / 360;
    const cx = Math.cos(pitchDeg * k), sx = Math.sin(pitchDeg * k);
    const cy = Math.cos(yawDeg * k), sy = Math.sin(yawDeg * k);
    const cz = Math.cos(rollDeg * k), sz = Math.sin(rollDeg * k);
    return [
      sx * cy * cz + cx * sy * sz,
      cx * sy * cz - sx * cy * sz,
      cx * cy * sz - sx * sy * cz,
      cx * cy * cz + sx * sy * sz,
    ];
  };

  const state = {
    head: { position: [0, 1.2, 0], yawDeg: 0, pitchDeg: 0, rollDeg: 0 },
    hands: { left: null, right: null },
  };
  const HAND_DEFAULT = {
    left: { position: [-0.2, 0.8, -0.3], yawDeg: 0, pitchDeg: 0, rollDeg: 0, pose: 'relaxed' },
    right: { position: [0.2, 0.8, -0.3], yawDeg: 0, pitchDeg: 0, rollDeg: 0, pose: 'relaxed' },
  };

  // Merges a partial pose into the current one and checks the numbers, so a
  // bad call changes nothing.
  function merged(current, change, what) {
    const next = { ...current, ...change };
    const p = next.position;
    const numbers = Array.isArray(p) && p.length === 3 ? [...p, next.yawDeg, next.pitchDeg, next.rollDeg] : [NaN];
    if (!numbers.every(Number.isFinite)) {
      throw new Error(`${what}: need position [x, y, z] and yawDeg, pitchDeg, rollDeg as numbers`);
    }
    return next;
  }

  function setHead(h) {
    state.head = merged(state.head, h, 'setHead');
    const { position: p, yawDeg, pitchDeg, rollDeg } = state.head;
    device.position.set(p[0], p[1], p[2]);
    device.quaternion.set(...quat(yawDeg, pitchDeg, rollDeg));
    return state.head;
  }

  function setHand(side, h) {
    const hand = device.hands[side];
    if (!hand) throw new Error(`Unknown hand "${side}" (use 'left' or 'right')`);
    if (h === null) {
      // Not tracked: the input source disappears, as when a hand leaves the
      // headset cameras' view.
      state.hands[side] = null;
      hand.setPinchValueImmediate(0);
      hand.connected = false;
      return null;
    }
    const s = merged(state.hands[side] || HAND_DEFAULT[side], h, 'setHand');
    const poseId = s.pose === 'relaxed' || s.pose === 'pinch' ? 'default' : s.pose;
    if (!hand.poseIds.includes(poseId)) {
      throw new Error(`Unknown hand pose "${s.pose}". Known: relaxed, ${hand.poseIds.filter((id) => id !== 'default').join(', ')}`);
    }
    state.hands[side] = s;
    hand.connected = true;
    if (hand.poseId !== poseId) hand.poseId = poseId;
    // 'pinch' is a relaxed hand with thumb and index closed, which also
    // presses the hand's select button (selectstart on the session).
    hand.updatePinchValue(s.pose === 'pinch' ? 1 : 0);
    // Hold the wrist joint at the position with the given rotation, whatever
    // shape the fingers take. Zero rotation: fingers forward, palm down.
    hand.setPin({ anchor: 'wrist', target: s.position, wristRotation: quat(s.yawDeg, s.pitchDeg, s.rollDeg) });
    return s;
  }

  // Holding the Meta button: where the head is now becomes the origin, facing
  // forward, and the app's reference space fires 'reset' on the next frame.
  function recenter() {
    const { position: p, yawDeg } = state.head;
    device.recenter();
    const a = (-yawDeg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    for (const side of ['left', 'right']) {
      const hand = state.hands[side];
      if (!hand) continue;
      const dx = hand.position[0] - p[0], dz = hand.position[2] - p[2];
      setHand(side, { position: [c * dx + s * dz, hand.position[1], c * dz - s * dx], yawDeg: hand.yawDeg - yawDeg });
    }
    setHead({ position: [0, p[1], 0], yawDeg: 0 });
  }

  setHead(o.head || {});
  setHand('left', null);
  setHand('right', null);

  // Count XR frames (one per XRFrame, however many callbacks the app has).
  const stats = { frames: 0, callbackMs: 0 };
  let lastFrame = null;
  const sessionRAF = XRSession.prototype.requestAnimationFrame;
  XRSession.prototype.requestAnimationFrame = function (callback) {
    return sessionRAF.call(this, (time, frame) => {
      if (frame !== lastFrame) {
        lastFrame = frame;
        stats.frames++;
      }
      const t0 = performance.now();
      try { return callback(time, frame); } finally { stats.callbackMs += performance.now() - t0; }
    });
  };

  // Rendering on demand: the app's frame loop runs as usual, but its draw
  // calls and clears do nothing unless `render.enabled` is set (screenshot()
  // sets it for a few frames). Software WebGL spends nearly all its time
  // drawing, so this is what lets many headsets share two CPU cores.
  const render = { enabled: o.render !== 'onDemand' };
  if (o.render === 'onDemand') {
    const skipped = ['clear', 'drawArrays', 'drawElements', 'drawRangeElements', 'drawArraysInstanced', 'drawElementsInstanced'];
    for (const Context of [window.WebGL2RenderingContext, window.WebGLRenderingContext]) {
      for (const name of skipped) {
        const original = Context && Context.prototype[name];
        if (typeof original !== 'function') continue;
        Context.prototype[name] = function () {
          if (render.enabled) return original.apply(this, arguments);
        };
      }
    }
  }

  // Optional frame-rate cap for the whole page (XR frames run on the
  // window's requestAnimationFrame). Callbacks requested for the same frame
  // still run together, at most `maxFps` times a second.
  if (o.maxFps > 0) {
    const nativeRAF = window.requestAnimationFrame.bind(window);
    const interval = 1000 / o.maxFps;
    let queue = [], running = [], handles = 0, scheduled = false, slot = 0;
    const runFrame = (time) => {
      scheduled = false;
      running = queue;
      queue = [];
      for (const entry of running) {
        if (entry.cancelled) continue;
        try { entry.callback(time); } catch (err) { setTimeout(() => { throw err; }); }
      }
      running = [];
    };
    window.requestAnimationFrame = (callback) => {
      const handle = ++handles;
      queue.push({ handle, callback });
      if (!scheduled) {
        scheduled = true;
        const now = performance.now();
        slot = Math.max(slot + interval, now);
        // Aim a little early: the frame then starts on the browser's next tick.
        setTimeout(() => nativeRAF(runFrame), Math.max(0, slot - now - 8));
      }
      return handle;
    };
    window.cancelAnimationFrame = (handle) => {
      for (const entry of [...queue, ...running]) if (entry.handle === handle) entry.cancelled = true;
    };
  }

  window.__simHeadset = { name: o.name, options: o, device, state, stats, render, setHead, setHand, recenter };
}
/* eslint-enable no-undef */

// ---------------------------------------------------------------------------
// Headset
// ---------------------------------------------------------------------------

/**
 * Opens a page with a simulated Quest 3 in its own browser context (own
 * storage, own renderer process) and loads `url`. Both hands start as "not
 * tracked"; controllers are not used.
 *
 * @param {import('playwright-core').Browser} browser from launchBrowser()
 * @param {string} url page to open, e.g. http://localhost:8080/?seat=3
 * @param {object} [options]
 * @param {string} [options.name] label used in error messages
 * @param {number} [options.width] XR framebuffer width in pixels, default
 *   640. This is the page's viewport: IWER renders into a canvas of exactly
 *   that size, and it has no other resolution setting.
 * @param {number} [options.height] default 360
 * @param {boolean} [options.stereo] false (default): one eye fills the image.
 *   true: left and right eye side by side, each half the width.
 * @param {number} [options.fovyDeg] vertical field of view, default 90
 * @param {boolean} [options.antialias] false (default) forces WebGL
 *   antialiasing off, which more than doubles the frame rate here. true
 *   leaves the app's own choice alone.
 * @param {'always'|'onDemand'} [options.render] 'always' (default): every
 *   frame is drawn, like on a headset. 'onDemand': the app runs every frame
 *   but nothing is drawn, except while screenshot() takes a picture. Use it
 *   to run several headsets at once (about a tenth of the CPU).
 * @param {number} [options.maxFps] cap on the page's frame rate; 0 (default)
 *   is no cap (60 frames a second, when the machine can keep up)
 * @param {{position?: number[], yawDeg?: number, pitchDeg?: number, rollDeg?: number}} [options.head]
 *   head pose before the session starts; default seated at [0, 1.2, 0]
 * @param {string} [options.enterSelector] the app's "enter VR" button,
 *   default '#btn-vr'
 * @param {1|2} [options.monoViews] for measurements only: 2 keeps stock
 *   IWER's two views in mono (the second is empty but still costs a pass)
 */
export async function openHeadset(browser, url, options = {}) {
  const o = {
    name: 'headset', width: 640, height: 360, stereo: false, fovyDeg: 90, ipd: 0.063,
    antialias: false, render: 'always', maxFps: 0, head: {}, enterSelector: '#btn-vr', monoViews: 1,
    ...options,
  };
  if (o.render !== 'always' && o.render !== 'onDemand') throw new Error(`render must be 'always' or 'onDemand', not "${o.render}"`);

  const context = await browser.newContext({
    viewport: { width: o.width, height: o.height },
    deviceScaleFactor: 1,
  });
  await context.addInitScript({ path: IWER_BUILD });
  await context.addInitScript(installSimulatedHeadset, o);
  const page = await context.newPage();

  const seen = { pageErrors: [], consoleErrors: [], warnings: [] };
  page.on('pageerror', (err) => seen.pageErrors.push(String((err && (err.stack || err.message)) || err)));
  page.on('crash', () => seen.pageErrors.push('The page crashed'));
  page.on('console', (msg) => {
    const type = msg.type();
    if (type !== 'error' && type !== 'warning') return;
    const where = msg.location().url ? ` (${msg.location().url})` : '';
    (type === 'error' ? seen.consoleErrors : seen.warnings).push(msg.text() + where);
  });

  await page.goto(url, { waitUntil: 'load' });

  const headset = {
    /** The headset's label. */
    name: o.name,
    /** The Playwright page and context, for anything not covered here. */
    page,
    context,

    /**
     * Clicks the app's "enter VR" button (a real click, so the app gets its
     * user gesture) and waits until the XR session delivers frames.
     * @returns {Promise<{ enabledFeatures: string[], width: number, height: number }>}
     *   the session's features and the XR framebuffer size
     */
    async enterVR({ timeout = 120_000 } = {}) {
      const button = page.locator(o.enterSelector);
      await button.waitFor({ state: 'visible', timeout });
      await page.waitForFunction((sel) => !document.querySelector(sel).disabled, o.enterSelector, { timeout, polling: 100 });
      await button.click({ timeout });
      await page.waitForFunction(
        () => window.__simHeadset.device.activeSession && window.__simHeadset.stats.frames >= 2,
        null, { timeout, polling: 100 },
      );
      return page.evaluate(() => {
        const { device } = window.__simHeadset;
        return { enabledFeatures: [...device.activeSession.enabledFeatures], ...device.canvasDimensions };
      });
    },

    /** Ends the XR session, like leaving VR on the headset. */
    async exitVR() {
      await page.evaluate(() => window.__simHeadset.device.activeSession?.end());
    },

    /**
     * Moves the head. Fields that are left out keep their value. Works
     * before the session starts too.
     * @param {{position?: [number, number, number], yawDeg?: number, pitchDeg?: number, rollDeg?: number}} head
     *   position: the point between the eyes. yaw > 0 looks left, pitch > 0
     *   looks up, roll > 0 tilts the head towards the left shoulder.
     */
    async setHead(head) {
      return page.evaluate((h) => window.__simHeadset.setHead(h), head);
    },

    /**
     * Poses a tracked hand, or pass null for "hand not tracked" (how both
     * hands start). Fields that are left out keep their value.
     * @param {'left'|'right'} side
     * @param {{position?: [number, number, number], yawDeg?: number, pitchDeg?: number, rollDeg?: number, pose?: string}|null} hand
     *   position: the wrist joint. Rotation: of the wrist; all zero means
     *   fingers pointing forward (-z) with the palm down. yaw > 0 turns the
     *   fingers left, pitch > 0 raises them, roll > 0 rolls the hand
     *   anticlockwise as seen from behind (roll -90 on the right hand: thumb
     *   up). pose: 'relaxed' (default), 'point', 'pinch' (also presses
     *   "select"), or another IWER pose id (open, flat, fist, thumbs-up, ...).
     */
    async setHand(side, hand) {
      return page.evaluate(([s, h]) => window.__simHeadset.setHand(s, h), [side, hand]);
    },

    /**
     * Emulates holding the Meta button: where the head is now becomes the
     * origin (facing forward), tracked hands keep their place relative to
     * the head, and the app's reference space fires 'reset'.
     */
    async recenter() {
      await page.evaluate(() => window.__simHeadset.recenter());
    },

    /**
     * Waits for `count` more animation frames, so that a pose set just
     * before has reached the app (and the picture, when drawing).
     */
    async waitFrames(count = 2, { timeout = 60_000 } = {}) {
      let timer;
      const expired = new Promise((_, fail) => {
        timer = setTimeout(() => fail(new Error(`${o.name}: no animation frame within ${timeout} ms`)), timeout);
      });
      // XR frames run on the window's animation frames, so this also works
      // on the start page, before and after a session.
      const frames = page.evaluate((n) => new Promise((done) => {
        const step = () => (n-- > 0 ? requestAnimationFrame(step) : done());
        step();
      }), count);
      try { await Promise.race([frames, expired]); } finally { clearTimeout(timer); }
    },

    /**
     * Measures the XR frame rate over `seconds`. With render 'always' these
     * are drawn frames; with 'onDemand' it is how often the app's frame loop
     * runs.
     * @returns {Promise<{ fps: number, frames: number, seconds: number, callbackMsPerFrame: number }>}
     *   callbackMsPerFrame: time spent in the app's frame callback (its
     *   JavaScript; the drawing itself happens in the browser's GPU process)
     */
    async measureFps(seconds = 5) {
      return page.evaluate(async (ms) => {
        const { stats } = window.__simHeadset;
        const f0 = stats.frames, c0 = stats.callbackMs, t0 = performance.now();
        await new Promise((done) => setTimeout(done, ms));
        const frames = stats.frames - f0, dt = (performance.now() - t0) / 1000;
        return {
          fps: Math.round((frames / dt) * 10) / 10,
          frames,
          seconds: Math.round(dt * 100) / 100,
          callbackMsPerFrame: frames ? Math.round(((stats.callbackMs - c0) / frames) * 10) / 10 : 0,
        };
      }, seconds * 1000);
    },

    /**
     * Saves a PNG of what the headset shows: the page, which the XR canvas
     * fills while a session runs. Waits two frames first, so the picture
     * shows the poses set just before (and, with render 'onDemand', is drawn
     * at all).
     * @param {string} path where to save the PNG
     */
    async screenshot(path) {
      const drawing = (on) => page.evaluate((v) => { window.__simHeadset.render.enabled = v; }, on);
      if (o.render === 'onDemand') await drawing(true);
      try {
        await headset.waitFrames(2);
        return await page.screenshot({ path, type: 'png' });
      } finally {
        if (o.render === 'onDemand') await drawing(false);
      }
    },

    /**
     * Runs a function inside the page (Playwright's page.evaluate). The
     * app's globals are available, and the emulated device is
     * `window.__simHeadset.device` (an IWER XRDevice).
     */
    async evaluate(fn, arg) {
      return page.evaluate(fn, arg);
    },

    /**
     * Problems seen so far.
     * @returns {{ pageErrors: string[], consoleErrors: string[], warnings: string[] }}
     *   uncaught exceptions; console.error messages (failed requests land
     *   here too); console.warn messages
     */
    errors() {
      return { pageErrors: [...seen.pageErrors], consoleErrors: [...seen.consoleErrors], warnings: [...seen.warnings] };
    },

    /** Closes the page and its browser context. */
    async close() {
      await context.close();
    },
  };
  return headset;
}
