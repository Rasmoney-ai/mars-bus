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
    this.shared = null;       // shared ride info (see setShared), null = solo
    this.vrSupported = false;
    this.ready = false;       // the landscape is built: the ride can be shown

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
    const sh = this.shared;
    const joined = sh && sh.status !== 'unavailable';
    this.seatButtons.forEach((b, i) => {
      const n = i + 1;
      // Shared ride: seats that others sit in cannot be chosen.
      const taken = Boolean(joined && n !== sh.seat && sh.peers.includes(n));
      b.setAttribute('aria-pressed', String(joined ? n === sh.seat : n === s.seat));
      b.classList.toggle('taken', taken);
      b.disabled = taken;
      b.setAttribute('aria-label', taken ? `Plads ${n} (optaget)` : `Plads ${n}`);
    });
    const seat = joined ? sh.seat : s.seat;
    $('seat-label').textContent = seat ? `Plads ${seat} · ${SEATS.colorNames[seat - 1]} hjelm` : 'Ingen plads endnu';
    $('opt-comfort').checked = s.comfort;
    $('opt-sim').checked = s.simulated;
    // The simulated passengers are only for the solo ride.
    $('opt-sim').closest('label').hidden = Boolean(joined);
    this._refreshVR();
  }

  // Shared ride (?room=<name>): shows the room, how many are on board and
  // which seats are taken. info: { room, status, seat, peers, control } with
  // status connecting | online | offline | replaced | full | outdated |
  // unavailable (no relay set up: the ride is solo).
  setShared(info) {
    this.shared = info;
    const box = $('room-status');
    box.hidden = false;
    const n = info.peers.length;
    const texts = {
      connecting: 'forbinder …',
      online: `${n} om bord · ${info.control ? 'læreren starter turen' : 'turen startes fra en af pladserne'}`,
      offline: 'ingen forbindelse, prøver igen …',
      replaced: 'siden er åbnet i en anden fane. Luk den ene.',
      full: 'bussen er fuld (10 pladser).',
      outdated: 'siden er for gammel. Genindlæs siden.',
      unavailable: 'er ikke sat op endnu. Du kører alene.',
    };
    box.textContent = `Fælles tur${info.room ? ` "${info.room}"` : ''}: ${texts[info.status] || info.status}`;
    const problem = info.status !== 'online' && info.status !== 'connecting';
    box.dataset.state = info.status === 'online' ? 'online' : problem ? 'problem' : '';
    if (problem && info.status !== 'unavailable') {
      // A way out if the connection cannot be made: the same ride, alone.
      const p = new URLSearchParams(location.search);
      p.delete('room');
      const link = document.createElement('a');
      link.href = `${location.pathname}?${p.toString()}`;
      link.textContent = 'Kør alene i stedet';
      box.append(' ', link);
    }
    this.refreshSettings();
  }

  setVRStatus(supported, message) {
    this.vrSupported = supported;
    $('vr-status').textContent = message || '';
    this._refreshVR();
  }

  // The landscape is built: "Se på skærmen" can be used.
  setReady() {
    this.ready = true;
    this._refreshVR();
  }

  // VR needs a headset and, in the shared ride, a seat in the bus.
  _refreshVR() {
    const sh = this.shared;
    const needsSeat = Boolean(sh && sh.status !== 'unavailable' && !sh.seat);
    $('btn-vr').disabled = !this.vrSupported || needsSeat;
    $('btn-desktop').disabled = !this.ready || needsSeat;
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
