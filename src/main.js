// Mars-bussen: wires the modules together and runs the frame loop.
//
// Each frame: clock -> ride time t -> timeline (bus pose, texts, cues) ->
// bus, landscape, passengers, screens -> render. Nothing moves by adding up
// small steps; everything is computed from t.

import * as THREE from 'three';
import { RENDER, SEATS, NARRATION } from './config.js';
import { Path, ROUTE } from './route.js';
import { Timeline, smooth } from './timeline.js';
import { createWorld } from './terrain.js';
import { Bus, seatOrigin, seatPanelMatrix, screenPlacements } from './bus.js';
import { PassengerView } from './passengers.js';
import { PassengerSimulation } from './simulated.js';
import { UserHands } from './hands.js';
import { LocalClock } from './clock.js';
import { Sound } from './audio.js';
import { Narration } from './narration.js';
import { RoverMotion } from './rover.js';
import { CabinScreens } from './ui/screens.js';
import { SeatPanel, PanelInteraction } from './ui/panel.js';
import { DomUI } from './ui/dom.js';
import { DesktopControls } from './desktop.js';
import { VRSession } from './xr.js';
import { createNetwork } from './network.js';

// --- Settings (start page or URL: ?seat=3&comfort=1&sim=0&speak=0&debug) ----

const params = new URLSearchParams(location.search);
const settings = {
  seat: clampSeat(parseInt(params.get('seat') || '1', 10)),
  comfort: params.get('comfort') === '1',
  simulated: params.get('sim') !== '0',
  speak: params.get('speak') !== '0',
  debug: params.has('debug'),
};

function clampSeat(n) {
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), SEATS.count) : 1;
}

function saveSettingsToUrl() {
  const p = new URLSearchParams(location.search);
  p.set('seat', String(settings.seat));
  if (settings.comfort) p.set('comfort', '1'); else p.delete('comfort');
  if (!settings.simulated) p.set('sim', '0'); else p.delete('sim');
  history.replaceState(null, '', `${location.pathname}?${p.toString()}`);
}

// --- Renderer and scene -----------------------------------------------------

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, RENDER.maxPixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.xr.setFoveation(RENDER.foveation);
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, RENDER.near, RENDER.far);
const outsideCamera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, RENDER.far);

// The route, the landscape (which also grades the road heights) and the timeline.
const path = new Path(ROUTE);
const world = createWorld(path);
const timeline = new Timeline(path);
scene.add(world.group, world.sky);
scene.fog = world.fog;
scene.background = world.background;

// The bus, with the passenger's "rig" (the real floor under their head).
const bus = new Bus();
scene.add(bus.group);
const rig = new THREE.Group();
rig.name = 'rig';
bus.group.add(rig, outsideCamera);
rig.add(camera);

// Light for the moving objects (passengers, gloves, wheels). The landscape
// and cabin have their light baked in.
scene.add(new THREE.HemisphereLight('#fff4e8', '#5a4a42', 2.0));
const cabinLight = new THREE.DirectionalLight('#ffffff', 1.3);
cabinLight.position.set(0.6, 4, 1.5);
bus.group.add(cabinLight, cabinLight.target);

const screens = new CabinScreens(bus, screenPlacements(), timeline);
const passengers = new PassengerView();
bus.group.add(passengers.group);
const simulation = new PassengerSimulation(timeline, world.layout);
const hands = new UserHands(renderer, rig);
const clock = new LocalClock(timeline.duration);
const sound = new Sound();
const rover = new RoverMotion(world.rover, world.layout.rover, world.layout.stop.cliff,
  timeline.stops.find((st) => st.id === 'cliff').arrival, world.terrain);
const narration = new Narration(timeline, sound);
narration.setEnabled(settings.speak);
narration.load();
const network = createNetwork(); // null until step 2

// Fade to black (comfort mode): a small black sphere around the eyes.
const fade = new THREE.Mesh(
  new THREE.SphereGeometry(0.3, 16, 8),
  new THREE.MeshBasicMaterial({ color: '#000000', side: THREE.BackSide, transparent: true, depthTest: false, depthWrite: false, fog: false }),
);
fade.renderOrder = 1000;
fade.frustumCulled = false;
camera.add(fade);

// --- Actions ------------------------------------------------------------------

let autoPaused = false;
let userEyeReset = false;
// VR: how much your seat is raised or lowered so your eyes end up at
// SEATS.eyeHeight (measured shortly after entering VR and after recentering).
let seatLift = 0;
let calibrateIn = 0;
let comfortSwitch = null;
const SWITCH_HALF = 0.35; // seconds to fade out (and in again)

const actions = {
  selectSeat(n) {
    settings.seat = clampSeat(n);
    applySeat();
    dom.refreshSettings();
    saveSettingsToUrl();
  },
  setComfort(on) {
    settings.comfort = on;
    dom.refreshSettings();
    saveSettingsToUrl();
  },
  setSimulated(on) {
    settings.simulated = on;
    dom.refreshSettings();
    saveSettingsToUrl();
  },
  // During the ride, switching comfort mode fades through black, so the
  // view never jumps.
  toggleComfort() {
    if (!clock.playing) actions.setComfort(!settings.comfort);
    else if (!comfortSwitch) comfortSwitch = { to: !settings.comfort, start: performance.now(), done: false };
  },
  toggleSimulated() { actions.setSimulated(!settings.simulated); },
  async enterVR() {
    sound.unlock();
    try {
      await vr.enter();
    } catch (err) {
      dom.setVRStatus(true, `Kunne ikke starte VR: ${err.message || err}`);
    }
  },
  startDesktop() {
    sound.unlock();
    dom.showHud();
    desktop.enabled = true;
    if (clock.getTime() >= timeline.duration) clock.seek(0);
    clock.play();
  },
  togglePlay() {
    sound.unlock();
    if (clock.playing) clock.pause(); else clock.play();
  },
  play() { clock.play(); },
  pause() { clock.pause(); },
  restart() { clock.restart(); },
  seek(t) { clock.seek(t); },
  seekBy(dt) { clock.seek(clock.getTime() + dt); },
  nextStop() {
    const t = clock.getTime();
    const next = timeline.stopTimes().find((s) => s > t + 0.5);
    clock.seek(next ?? timeline.duration);
  },
  prevStop() {
    const t = clock.getTime();
    const prev = timeline.stopTimes().filter((s) => s < t - 1.5).pop();
    clock.seek(prev ?? 0);
  },
  toggleMute() { sound.setMuted(!sound.muted); },
  toggleHelp() { dom.toggleHelp(); },
  showMenu() {
    clock.pause();
    desktop.enabled = false;
    dom.showStart();
  },
};

function applySeat() {
  seatOrigin(settings.seat, rig.position);
  if (vr.active) rig.position.y += seatLift;
  panel.mesh.matrix.copy(seatPanelMatrix(settings.seat));
  hands.setSeat(settings.seat);
}

// Personal screen in front of the seat (buttons in VR).
const panel = new SeatPanel((id) => {
  sound.unlock();
  if (id === 'pause') clock.pause();
  else if (id === 'play') clock.play();
  else if (id === 'restart') clock.restart();
  else if (id === 'comfort') actions.toggleComfort();
});
panel.mesh.matrixAutoUpdate = false;
bus.group.add(panel.mesh);
const interaction = new PanelInteraction(renderer, rig, panel, hands);

const dom = new DomUI(timeline, settings, actions);
const desktop = new DesktopControls(renderer.domElement, camera, outsideCamera, actions);

// Desktop: clicking the seat panel presses its buttons (handy for testing).
const clickRay = new THREE.Raycaster();
desktop.onClick = (x, y) => {
  if (desktop.outside) return;
  const ndc = new THREE.Vector2((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
  clickRay.setFromCamera(ndc, camera);
  const hit = clickRay.intersectObject(panel.mesh, false)[0];
  if (hit) panel.press(panel.hitTest(hit.uv));
};

const vr = new VRSession(renderer, {
  onStart() {
    userEyeReset = true;
    seatLift = vr.floorLevel ? 0 : SEATS.eyeHeight;
    calibrateIn = 10; // frames, so the headset pose has settled
    dom.hideAll();
    desktop.enabled = false;
    applySeat();
    autoPaused = false;
    if (clock.getTime() >= timeline.duration) clock.seek(0);
    clock.play();
  },
  onEnd() {
    clock.pause();
    applySeat();
    dom.showStart();
    onResize();
  },
  onVisibility(state) {
    // Solo ride: pause while the Quest menu is open, continue afterwards.
    if (state !== 'visible' && clock.playing) {
      clock.pause();
      autoPaused = true;
    } else if (state === 'visible' && autoPaused) {
      autoPaused = false;
      clock.play();
    }
  },
  onReset() {
    calibrateIn = 3;
    panel.flash('Billedet er rettet ind', performance.now());
  },
});

applySeat();

// The guide's ceiling speaker, above and a little ahead of your seat; the
// listener is your head, both in bus coordinates, so the voice stays up in
// the roof when you turn your head.
const spk = { m: new THREE.Matrix4(), inv: new THREE.Matrix4(), q: new THREE.Quaternion(), s: new THREE.Vector3(),
  head: new THREE.Vector3(), fwd: new THREE.Vector3(), up: new THREE.Vector3(), pos: new THREE.Vector3() };
function placeSpeaker() {
  seatOrigin(settings.seat, spk.pos);
  spk.pos.set(0, spk.pos.y + NARRATION.speaker.height, spk.pos.z - NARRATION.speaker.ahead);
  spk.inv.copy(bus.group.matrixWorld).invert();
  spk.m.multiplyMatrices(spk.inv, camera.matrixWorld).decompose(spk.head, spk.q, spk.s);
  spk.fwd.set(0, 0, -1).applyQuaternion(spk.q);
  spk.up.set(0, 1, 0).applyQuaternion(spk.q);
  narration.setListener(spk.pos, spk.head, spk.fwd, spk.up);
}

// --- Frame loop -----------------------------------------------------------------

const view = { pose: {}, fade: 0, phase: null };
const NO_PASSENGERS = [];
let lastT = clock.getTime();
let userEye = SEATS.eyeHeight;
let lastFrame = performance.now();
let fps = 0, frames = 0, fpsStart = performance.now();

function frame() {
  const now = performance.now();
  const frameDt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  const t = clock.getTime();

  // Sound cues passed since the last frame (not when jumping in time).
  if (clock.playing && t > lastT && t - lastT < 0.5) timeline.eventsBetween(lastT, t, (e) => sound.cue(e));
  lastT = t;

  let switchFade = 0;
  if (comfortSwitch) {
    const e = (now - comfortSwitch.start) / 1000;
    if (e < SWITCH_HALF) switchFade = smooth(e / SWITCH_HALF);
    else {
      if (!comfortSwitch.done) {
        comfortSwitch.done = true;
        actions.setComfort(comfortSwitch.to);
      }
      switchFade = 1 - smooth((e - SWITCH_HALF) / SWITCH_HALF);
      if (e >= 2 * SWITCH_HALF) comfortSwitch = null;
    }
  }

  timeline.view(t, settings.comfort, view);
  bus.setPose(view.pose);
  // World matrices of everything in the bus (panel, rig, hands) must match
  // this frame's bus pose before the hands and buttons are checked.
  bus.group.updateMatrixWorld(true);
  world.update(view.pose);
  rover.update(t);

  const status = timeline.status(t, settings.comfort, view.pose);
  screens.update(status, view, clock.playing, now);
  // Simulated classmates follow your own eye height (slowly, so they do not
  // bob when you move your head).
  if (vr.active && calibrateIn > 0 && --calibrateIn === 0 && SEATS.autoEyeHeight) {
    const y = camera.position.y;
    if (y > -1 && y < 2.5 && y !== 0) {
      seatLift = SEATS.eyeHeight - y;
      applySeat();
      userEyeReset = true;
    }
  }
  const eye = camera.position.y + (vr.active ? seatLift : 0);
  if (vr.active && eye > 0.5 && eye < 2.2) {
    if (userEyeReset) { userEye = eye; userEyeReset = false; }
    userEye += (eye - userEye) * Math.min(1, frameDt / 4);
  }
  passengers.update(settings.simulated ? simulation.update(t, userEye) : NO_PASSENGERS, settings.seat);

  if (vr.active) {
    hands.update();
    interaction.update();
  }
  const line = status.big ? `${status.title} ${status.big}` : status.title;
  panel.update({
    playing: clock.playing,
    started: t > 0,
    ended: t >= timeline.duration,
    comfort: settings.comfort,
    line: settings.debug ? `${line} · ${fps} fps` : line,
  }, now);

  const fadeLevel = Math.max(view.fade, switchFade);
  fade.visible = fadeLevel > 0.001;
  fade.material.opacity = fadeLevel;
  sound.setEngine(view.pose.v, clock.playing);
  narration.update(t, clock.playing);
  placeSpeaker();

  if (!vr.active) desktop.apply();
  dom.update(t, clock.playing, status, fps, now);

  renderer.render(scene, vr.active ? camera : desktop.activeCamera);

  frames++;
  if (now - fpsStart >= 1000) {
    fps = Math.round((frames * 1000) / (now - fpsStart));
    frames = 0;
    fpsStart = now;
  }
}

function onResize() {
  if (renderer.xr.isPresenting) return;
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = outsideCamera.aspect = w / h;
  camera.updateProjectionMatrix();
  outsideCamera.updateProjectionMatrix();
}
window.addEventListener('resize', onResize);

// Compile all shaders up front, so nothing stalls in the middle of the ride.
fade.visible = true;
interaction.cursor.visible = true;
for (const r of interaction.rays) r.visible = true;
renderer.compile(scene, camera);
fade.visible = false;
interaction.cursor.visible = false;
for (const r of interaction.rays) r.visible = false;

renderer.setAnimationLoop(frame);

vr.checkSupport().then(({ supported, message }) => dom.setVRStatus(supported, message));
document.getElementById('btn-desktop').disabled = false;

// For testing in the browser console.
window.marsbus = { clock, timeline, settings, narration, actions, renderer, scene, network, desktop, world, panel, interaction };
