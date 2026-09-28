// The flat-screen parts: the start page (seat choice, options, enter VR)
// and the desktop HUD (time, timeline, buttons, key help).

import { SEATS } from '../config.js';
import { formatTime } from '../timeline.js';
import { drawBadge } from './screens.js';

const $ = (id) => document.getElementById(id);

export class DomUI {
  // actions: { selectSeat, setComfort, setSimulated, enterVR, startDesktop,
  //            togglePlay, prevStop, nextStop, restart, seek, showMenu }
  constructor(timeline, settings, actions) {
    this.timeline = timeline;
    this.settings = settings;
    this.actions = actions;
    this.start = $('start');
    this.hud = $('hud');
    this._last = 0;
    this._key = '';

    drawBadge($('badge').getContext('2d'), 256);

    // Seat buttons, laid out like the bus (front at the top).
    const seats = $('seats');
    this.seatButtons = [];
    for (let n = 1; n <= SEATS.count; n++) {
      const b = document.createElement('button');
      b.className = `seat ${n % 2 === 1 ? 'left' : 'right'}`;
      b.innerHTML = `<span class="dot" style="background:${SEATS.colors[n - 1]}"></span>${n}`;
      b.setAttribute('aria-label', `Plads ${n}`);
      b.addEventListener('click', () => actions.selectSeat(n));
      seats.appendChild(b);
      this.seatButtons.push(b);
    }

    $('opt-comfort').checked = settings.comfort;
    $('opt-sim').checked = settings.simulated;
    $('opt-comfort').addEventListener('change', (e) => actions.setComfort(e.target.checked));
    $('opt-sim').addEventListener('change', (e) => actions.setSimulated(e.target.checked));
    $('btn-vr').addEventListener('click', () => actions.enterVR());
    $('btn-desktop').addEventListener('click', () => actions.startDesktop());

    // HUD.
    $('hud-play').addEventListener('click', () => actions.togglePlay());
    $('hud-prev').addEventListener('click', () => actions.prevStop());
    $('hud-next').addEventListener('click', () => actions.nextStop());
    $('hud-restart').addEventListener('click', () => actions.restart());
    $('hud-menu').addEventListener('click', () => actions.showMenu());
    const scrub = $('hud-scrub');
    scrub.max = String(timeline.duration);
    scrub.addEventListener('input', () => actions.seek(parseFloat(scrub.value)));
    for (const t of timeline.stopTimes().slice(1)) {
      const tick = document.createElement('span');
      tick.style.left = `${(t / timeline.duration) * 100}%`;
      $('hud-ticks').appendChild(tick);
    }
    this.refreshSettings();
  }

  refreshSettings() {
    const s = this.settings;
    this.seatButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(i + 1 === s.seat)));
    $('seat-label').textContent = `Plads ${s.seat} · ${SEATS.colorNames[s.seat - 1]} hjelm`;
    $('opt-comfort').checked = s.comfort;
    $('opt-sim').checked = s.simulated;
  }

  setVRStatus(supported, message) {
    $('btn-vr').disabled = !supported;
    $('vr-status').textContent = message || '';
  }

  showStart() {
    this.start.hidden = false;
    this.hud.hidden = true;
  }

  showHud() {
    this.start.hidden = true;
    this.hud.hidden = false;
  }

  hideAll() {
    this.start.hidden = true;
    this.hud.hidden = true;
  }

  toggleHelp() {
    $('hud-help').hidden = !$('hud-help').hidden;
  }

  showError(text) {
    const e = $('error');
    e.textContent = text;
    e.hidden = false;
  }

  // Called every frame; updates the HUD about 8 times per second.
  update(t, playing, status, fps, now) {
    if (this.hud.hidden || now - this._last < 120) return;
    this._last = now;
    $('hud-play').textContent = playing ? '⏸' : '▶';
    $('hud-time').textContent = `${formatTime(t)} / ${formatTime(this.timeline.duration)}`;
    const scrub = $('hud-scrub');
    if (document.activeElement !== scrub) scrub.value = String(t);
    const key = `${status.title}|${status.big || status.subtitle}`;
    if (key !== this._key) {
      this._key = key;
      $('hud-title').textContent = status.big ? `${status.title} ${status.big}` : status.title;
      $('hud-subtitle').textContent = status.big ? '' : status.subtitle;
    }
    $('hud-fps').textContent = fps ? `${fps} fps` : '';
  }
}
