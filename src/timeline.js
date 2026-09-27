// The timeline turns the ride time t (seconds) into everything the ride
// shows: where the bus is, which stop is next, texts and sound cues.
//
// Rule: the same t always gives the same result. Nothing here is
// accumulated frame by frame, and nothing is random.

import { COMFORT, TIMELINE } from './config.js';
import { planDrive, sampleDrive } from './route.js';

export class Timeline {
  constructor(path) {
    this.path = path;
    this.stops = path.stops.map((stop, index) => ({ ...stop, index }));
    const stops = this.stops;

    const phases = [];
    const pre = TIMELINE.introSeconds + TIMELINE.countdownSeconds;
    this.departureTime = pre;
    phases.push({ type: 'start', t0: 0, t1: pre, stop: 0 });
    stops[0].arrival = 0;
    stops[0].departure = pre;

    let t = pre;
    for (let i = 1; i < stops.length; i++) {
      const plan = planDrive(path, stops[i - 1].s, stops[i].s);
      phases.push({ type: 'drive', t0: t, t1: t + plan.duration, from: i - 1, to: i, plan });
      t += plan.duration;
      stops[i].arrival = t;
      const hold = stops[i].final
        ? TIMELINE.finalStopSeconds
        : (stops[i].hold ?? TIMELINE.defaultStopSeconds);
      phases.push({ type: 'stop', t0: t, t1: t + hold, stop: i });
      t += hold;
      stops[i].departure = t;
    }
    this.duration = t;
    phases.push({ type: 'end', t0: t, t1: Infinity, stop: stops.length - 1 });
    this.phases = phases;

    // Sound cues on the timeline.
    const events = [];
    for (let k = 0; k < TIMELINE.countdownSeconds; k++) {
      events.push({ t: TIMELINE.introSeconds + k, type: 'beep' });
    }
    events.push({ t: pre, type: 'go' });
    for (const p of phases) {
      if (p.type === 'stop') events.push({ t: p.t0, type: 'chime', stop: p.stop });
      if (p.type === 'drive' && p.from > 0) events.push({ t: p.t0, type: 'depart' });
    }
    events.push({ t: this.duration, type: 'end' });
    this.events = events.sort((a, b) => a.t - b.t);

    this._drive = { s: 0, v: 0 };
    this._pathSample = {};
  }

  phaseAt(t) {
    const phases = this.phases;
    for (let i = 0; i < phases.length; i++) {
      if (t < phases[i].t1) return phases[i];
    }
    return phases[phases.length - 1];
  }

  // Bus pose from arc length s: position, heading, height.
  poseAtS(s, v = 0, out = {}) {
    const p = this.path.sample(s, this._pathSample);
    out.s = s;
    out.v = v;
    out.x = p.x;
    out.z = p.z;
    out.y = this.path.heightAt(s);
    out.heading = p.heading;
    return out;
  }

  // The true bus pose at time t.
  poseAt(t, out = {}) {
    const phase = this.phaseAt(Math.max(t, 0));
    if (phase.type === 'drive') {
      const d = sampleDrive(phase.plan, t - phase.t0, this._drive);
      return this.poseAtS(d.s, d.v, out);
    }
    return this.poseAtS(this.stops[phase.stop].s, 0, out);
  }

  // What this passenger sees at time t. In comfort mode the bus waits at
  // the stop, then fades to black and in again, arriving on time.
  view(t, comfort, out = { pose: {}, fade: 0, phase: null }) {
    const phase = this.phaseAt(Math.max(t, 0));
    out.phase = phase;
    out.fade = 0;
    if (!comfort || phase.type !== 'drive') {
      this.poseAt(t, out.pose);
      return out;
    }
    const F = COMFORT.fadeOutSeconds, B = COMFORT.blackSeconds, I = COMFORT.fadeInSeconds;
    const tf = Math.max(phase.t0, phase.t1 - (F + B + I));
    const from = this.stops[phase.from].s;
    const to = this.stops[phase.to].s;
    if (t < tf) {
      this.poseAtS(from, 0, out.pose);
    } else if (t < tf + F) {
      this.poseAtS(from, 0, out.pose);
      out.fade = smooth((t - tf) / F);
    } else if (t < tf + F + B) {
      this.poseAtS(to, 0, out.pose);
      out.fade = 1;
    } else {
      this.poseAtS(to, 0, out.pose);
      out.fade = 1 - smooth((t - tf - F - B) / I);
    }
    return out;
  }

  // Texts for the screens at time t.
  status(t, comfort, pose) {
    const phase = this.phaseAt(Math.max(t, 0));
    const stops = this.stops;
    const st = {
      title: '', subtitle: '', big: '',
      next: null, distance: null, eta: null,
      phase: phase.type,
    };
    if (phase.type === 'start') {
      st.next = stops[1];
      st.distance = stops[1].s - pose.s;
      st.eta = stops[1].arrival - t;
      if (t < TIMELINE.introSeconds) {
        st.title = 'Velkommen ombord på Mars-bussen';
        st.subtitle = 'Sid godt, og kig fremad';
      } else {
        st.title = 'Bussen kører om';
        st.big = String(Math.max(1, Math.ceil(phase.t1 - t)));
      }
    } else if (phase.type === 'drive') {
      const next = stops[phase.to];
      st.next = next;
      st.distance = Math.max(0, next.s - pose.s);
      st.eta = phase.t1 - t;
      st.title = `Næste stop: ${next.name}`;
      if (comfort) {
        st.subtitle = `Ankomst om ${formatTime(st.eta)}`;
      } else if (t - phase.t0 < 4 && phase.from === 0) {
        st.subtitle = 'Vi kører mod Marsbasen';
      } else {
        st.subtitle = `${roundDistance(st.distance)} m`;
      }
    } else if (phase.type === 'stop') {
      const stop = stops[phase.stop];
      const left = phase.t1 - t;
      st.title = stop.final ? stop.name : `Stop ${phase.stop}: ${stop.name}`;
      st.subtitle = stop.text || '';
      if (!stop.final && left <= 5) {
        st.subtitle = `Bussen kører videre om ${Math.max(1, Math.ceil(left))}`;
      }
      if (!stop.final) {
        st.next = stops[phase.stop + 1];
        st.distance = st.next.s - stop.s;
        st.eta = st.next.arrival - t;
      }
    } else {
      st.title = 'Turen er slut';
      st.subtitle = 'Tak fordi du kørte med Mars-bussen';
    }
    return st;
  }

  // Calls fn(event) for each sound cue in (t0, t1].
  eventsBetween(t0, t1, fn) {
    for (const e of this.events) {
      if (e.t > t0 && e.t <= t1) fn(e);
    }
  }

  // Times the bus arrives at each stop (0 for the start).
  stopTimes() {
    return this.stops.map((s) => s.arrival);
  }
}

export function smooth(x) {
  const u = Math.min(Math.max(x, 0), 1);
  return u * u * (3 - 2 * u);
}

export function formatTime(seconds) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function roundDistance(d) {
  return d > 100 ? Math.round(d / 10) * 10 : Math.max(0, Math.round(d / 5) * 5);
}
