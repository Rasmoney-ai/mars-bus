// Placeholder sound made with Web Audio (no sound files): a soft electric
// motor hum that follows the bus speed, and short signals from the timeline
// (countdown beeps, departure, a chime at each stop).

import { COMFORT } from './config.js';

export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.engine = null;
  }

  // Must be called from a user gesture (click / tap) the first time.
  unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.9;
      this.master.connect(this.ctx.destination);
      this._buildEngine();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) this.master.gain.setTargetAtTime(muted ? 0 : 0.9, this.ctx.currentTime, 0.05);
  }

  _buildEngine() {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(this.master);

    // Low hum: sawtooth through a low-pass filter.
    const hum = ctx.createOscillator();
    hum.type = 'sawtooth';
    const humFilter = ctx.createBiquadFilter();
    humFilter.type = 'lowpass';
    humFilter.Q.value = 0.8;
    const humGain = ctx.createGain();
    humGain.gain.value = 0.22;
    hum.connect(humFilter).connect(humGain).connect(out);

    // Electric motor whine, rising with speed.
    const whine = ctx.createOscillator();
    whine.type = 'sine';
    const whineGain = ctx.createGain();
    whineGain.gain.value = 0;
    whine.connect(whineGain).connect(out);

    // Rolling / ventilation noise.
    const noise = ctx.createBufferSource();
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let seed = 12345;
    for (let i = 0; i < data.length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      data[i] = (seed / 0x7fffffff) * 2 - 1;
    }
    noise.buffer = buf;
    noise.loop = true;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = 500;
    noiseFilter.Q.value = 0.5;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.02;
    noise.connect(noiseFilter).connect(noiseGain).connect(out);

    hum.start(); whine.start(); noise.start();
    this.engine = { out, hum, humFilter, whine, whineGain, noiseGain, level: -1 };
    this.setEngine(0, false);
  }

  // speed in m/s; running = the ride is playing.
  setEngine(speed, running) {
    const e = this.engine;
    if (!e) return;
    const n = Math.min(Math.max(speed / COMFORT.maxSpeed, 0), 1);
    const level = running ? 0.1 + 0.16 * n : 0;
    // Only touch the audio graph when something audible changes.
    if (Math.abs(level - e.level) < 0.002 && Math.abs(n - (e.n ?? -1)) < 0.01) return;
    e.level = level;
    e.n = n;
    const now = this.ctx.currentTime;
    const tc = 0.25;
    e.out.gain.setTargetAtTime(level, now, tc);
    e.hum.frequency.setTargetAtTime(42 + 26 * n, now, tc);
    e.humFilter.frequency.setTargetAtTime(160 + 420 * n, now, tc);
    e.whine.frequency.setTargetAtTime(260 + 420 * n, now, tc);
    e.whineGain.gain.setTargetAtTime(0.05 * n, now, tc);
    e.noiseGain.gain.setTargetAtTime(0.03 + 0.08 * n, now, tc);
  }

  // A soft tone with a quick attack and exponential decay.
  _tone(freq, start, dur, gain = 0.25, type = 'sine') {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(gain, start + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(g).connect(this.master);
    osc.start(start);
    osc.stop(start + dur + 0.05);
  }

  // Timeline sound cues.
  cue(event) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime + 0.01;
    switch (event.type) {
      case 'beep':
        this._tone(660, t, 0.18, 0.12);
        break;
      case 'go':
        this._tone(880, t, 0.45, 0.14);
        this._tone(1320, t + 0.02, 0.4, 0.05);
        break;
      case 'depart':
        this._tone(523, t, 0.35, 0.1);
        this._tone(659, t + 0.16, 0.45, 0.1);
        break;
      case 'chime':
        // "Ding-dong" at each stop.
        this._tone(659, t, 1.2, 0.18);
        this._tone(1318, t, 0.6, 0.03);
        this._tone(523, t + 0.45, 1.6, 0.18);
        this._tone(1046, t + 0.45, 0.7, 0.03);
        break;
      case 'end':
        [523, 659, 784, 1046].forEach((f, i) => this._tone(f, t + i * 0.18, 1.1, 0.12));
        break;
      default:
        break;
    }
  }
}
