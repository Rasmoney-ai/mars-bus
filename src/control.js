// The teacher's page for the shared ride (control.html?room=<name>): shows
// who is on board and starts, pauses and moves the ride for everyone.
// No 3D here: only the timeline (for the texts and stop times) and the
// network (see network.js and relay/PROTOCOL.md).

import { SEATS } from './config.js';
import { Path, ROUTE } from './route.js';
import { Timeline, formatTime } from './timeline.js';
import { createNetwork, roomName } from './network.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const room = roomName(params.get('room'));

if (!room) {
  // Ask for a room name, then open the page for that room.
  const form = $('c-join');
  form.hidden = false;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = roomName($('c-room-input').value);
    if (!name) return;
    params.set('room', name);
    location.search = params.toString();
  });
} else {
  start();
}

function start() {
  $('c-main').hidden = false;
  const timeline = new Timeline(new Path(ROUTE));
  const network = createNetwork({ params, role: 'control', duration: timeline.duration });
  const clock = network ? network.clock : null;

  // The address the pupils open (this page's folder, same room, same relay).
  const riders = new URLSearchParams();
  riders.set('room', room);
  if (params.get('relay')) riders.set('relay', params.get('relay'));
  $('c-link').textContent = `${location.origin}${location.pathname.replace(/[^/]*$/, '')}?${riders.toString()}`;

  // Seats laid out like the bus (front at the top), lit when someone sits there.
  const seatBoxes = [];
  for (let n = 1; n <= SEATS.count; n++) {
    const b = document.createElement('div');
    b.className = `seat ${n % 2 === 1 ? 'left' : 'right'} empty`;
    b.innerHTML = `<span class="dot" style="background:${SEATS.colors[n - 1]}"></span>${n}`;
    $('c-seats').appendChild(b);
    seatBoxes.push(b);
  }

  const scrub = $('c-scrub');
  scrub.max = String(timeline.duration);
  for (const t of timeline.stopTimes().slice(1)) {
    const tick = document.createElement('span');
    tick.style.left = `${(t / timeline.duration) * 100}%`;
    $('c-ticks').appendChild(tick);
  }

  if (!network) {
    $('c-status').textContent = 'Fælles tur er ikke sat op endnu: der mangler en adresse til forbindelsen (relayUrl i src/config.js).';
    $('c-status').dataset.state = 'problem';
    return;
  }

  $('c-play').addEventListener('click', () => {
    if (clock.playing) clock.pause(); else clock.play();
  });
  // Back to the landing site, waiting: pause first, then move to the start.
  $('c-reset').addEventListener('click', () => {
    clock.pause();
    clock.seek(0);
  });
  $('c-prev').addEventListener('click', () => {
    const t = clock.getTime();
    clock.seek(timeline.stopTimes().filter((s) => s < t - 1.5).pop() ?? 0);
  });
  $('c-next').addEventListener('click', () => {
    const t = clock.getTime();
    clock.seek(timeline.stopTimes().find((s) => s > t + 0.5) ?? timeline.duration);
  });
  scrub.addEventListener('change', () => clock.seek(parseFloat(scrub.value)));

  const STATUS = {
    connecting: 'forbinder …',
    online: 'forbundet',
    offline: 'ingen forbindelse, prøver igen …',
    replaced: 'siden er åbnet i en anden fane. Luk den ene.',
    full: 'der er ikke plads til flere forbindelser.',
    outdated: 'siden er for gammel. Genindlæs siden.',
  };
  const pose = {};

  function update() {
    const online = network.status === 'online';
    const box = $('c-status');
    box.textContent = `Fælles tur "${room}": ${STATUS[network.status] || network.status}`;
    box.dataset.state = online ? 'online' : network.status === 'connecting' ? '' : 'problem';

    seatBoxes.forEach((b, i) => b.classList.toggle('empty', !network.peers.includes(i + 1)));
    const n = network.peers.length;
    $('c-count').textContent = n === 0 ? 'Ingen er om bord endnu' : n === 1 ? '1 er om bord' : `${n} er om bord`;

    const t = clock.getTime();
    const playing = clock.playing;
    const ended = t >= timeline.duration;
    const st = timeline.status(t, false, timeline.poseAt(t, pose));
    $('c-title').textContent = t <= 0 && !playing ? 'Bussen venter på landingspladsen' : st.big ? `${st.title} ${st.big}` : st.title;
    $('c-subtitle').textContent = t <= 0 && !playing ? 'Tryk Start, når alle sidder klar med brillen på.' : st.big ? '' : st.subtitle;
    $('c-time').textContent = `${formatTime(t)} / ${formatTime(timeline.duration)}`;
    if (document.activeElement !== scrub) scrub.value = String(t);

    const play = $('c-play');
    play.textContent = ended ? 'Kør igen' : playing ? 'Pause' : t > 0 ? 'Fortsæt' : 'Start turen';
    for (const id of ['c-play', 'c-reset', 'c-prev', 'c-next']) $(id).disabled = !online;
    scrub.disabled = !online;
  }

  network.onChange = update;
  setInterval(update, 250);
  update();

  // For testing in the browser console.
  window.marsbusControl = { network, timeline, clock };
}
