// Narration (speak) for the solo ride: one sound file per part of the ride
// (the welcome, each drive and each stop), named in src/route.js.
//
// The speak follows the ride time t, like everything else: at any t the
// file for that part plays from the matching position, so pause, seek and
// jumping between stops keep it in step. Nothing is queued frame by frame.
// In the shared ride (step 2) the teacher's computer plays the guide
// instead, and this is switched off.

import { NARRATION } from './config.js';

const SPK = NARRATION.speaker;

export class Narration {
  constructor(timeline, sound) {
    this.sound = sound;
    this.enabled = true;
    // One entry per part of the ride that has a file.
    this.parts = [];
    for (const p of timeline.phases) {
      const stop = p.type === 'drive' ? timeline.stops[p.to] : timeline.stops[p.stop];
      const name = p.type === 'drive' ? stop.speakOnWay : p.type === 'end' ? null : stop.speak;
      if (!name) continue;
      this.parts.push({
        name,
        start: p.t0 + (NARRATION.delay[p.type] ?? 0),
        data: null,      // the fetched file (compressed)
        buffer: null,    // decoded audio, only kept for the parts near t
        decoding: false,
        missing: false,
      });
    }
    this.playing = null; // { part, source, ctxStart, offset }
    this.out = null;
    this.voice = NARRATION.defaultVoice;
    this.generation = 0; // bumped when the voice changes, so late loads are dropped
  }

  // Switch between the recordings (keys of NARRATION.voices) and load it.
  setVoice(key) {
    if (!NARRATION.voices[key]) key = NARRATION.defaultVoice;
    if (key === this.voice && this.generation > 0) return;
    this.voice = key;
    this._stop();
    this.load();
  }

  // Fetch all files of the current voice in the background (small mp3 files).
  load() {
    const gen = ++this.generation;
    const folder = NARRATION.voices[this.voice].folder;
    for (const part of this.parts) {
      Object.assign(part, { data: null, buffer: null, decoding: false, missing: false, gen });
      fetch(`${folder}${part.name}.mp3`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status))))
        .then((data) => { if (part.gen === gen) part.data = data; })
        .catch(() => { if (part.gen === gen) part.missing = true; });
    }
  }

  setEnabled(on) {
    this.enabled = on;
    if (!on) this._stop();
  }

  // Called every frame with the ride time and whether the ride is running.
  update(t, running) {
    const ctx = this.sound.ctx;
    if (!ctx || ctx.state !== 'running') return;
    if (!this.out) this._buildChain(ctx);

    // The part that should be heard now: the latest one that has started
    // and has not yet finished (a long part keeps going until the next
    // part with sound begins).
    let index = -1;
    for (let i = 0; i < this.parts.length && this.parts[i].start <= t; i++) index = i;
    this._prepare(index);
    let want = null;
    for (let i = index; i >= 0 && i >= index - 1; i--) {
      const part = this.parts[i];
      if (part.missing) continue;
      if (!part.buffer) {
        // Not decoded yet: wait for it rather than falling back to an older part.
        if (i === index) break;
        continue;
      }
      if (t - part.start < part.buffer.duration) want = part;
      break;
    }

    if (!this.enabled || !running || !want) {
      this._stop();
      return;
    }
    const offset = t - want.start;
    const p = this.playing;
    if (p && p.part === want) {
      const heard = p.offset + (ctx.currentTime - p.ctxStart);
      if (Math.abs(heard - offset) < NARRATION.resyncSeconds) return;
    }
    this._stop();
    const source = ctx.createBufferSource();
    source.buffer = want.buffer;
    source.connect(this.out);
    source.start(0, offset);
    this.playing = { part: want, source, ctxStart: ctx.currentTime, offset };
  }

  // Decode the current and next part; free the decoded audio of the others
  // (decoded speak takes a lot of memory on the headset).
  _prepare(index) {
    const ctx = this.sound.ctx;
    this.parts.forEach((part, i) => {
      const near = i >= index - 1 && i <= index + 1;
      if (!near) {
        if (part.buffer && (!this.playing || this.playing.part !== part)) part.buffer = null;
        return;
      }
      if (part.buffer || part.decoding || !part.data) return;
      part.decoding = true;
      const gen = part.gen;
      // decodeAudioData detaches the data it is given, so pass a copy.
      ctx.decodeAudioData(part.data.slice(0))
        .then((buffer) => { if (part.gen === gen) part.buffer = buffer; })
        .catch(() => { if (part.gen === gen) part.missing = true; })
        .finally(() => { if (part.gen === gen) part.decoding = false; });
    });
  }

  // Loudspeaker sound: volume -> small-speaker EQ -> gentle compression ->
  // a panner at the ceiling speaker (dry) plus a little cabin echo (wet).
  _buildChain(ctx) {
    const out = ctx.createGain();
    out.gain.value = NARRATION.volume;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = SPK.highpass; hp.Q.value = 0.8;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = SPK.lowpass; lp.Q.value = 0.9;
    const peak = ctx.createBiquadFilter();
    peak.type = 'peaking'; peak.frequency.value = SPK.presence.freq; peak.Q.value = 1.1; peak.gain.value = SPK.presence.gain;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20; comp.ratio.value = 3; comp.attack.value = 0.005; comp.release.value = 0.2;
    // A gently overdriven small speaker.
    const drive = ctx.createWaveShaper();
    drive.curve = softClip(SPK.drive);
    drive.oversample = '2x';
    out.connect(hp).connect(peak).connect(drive).connect(lp).connect(comp);

    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 1;
    panner.rolloffFactor = 0;
    comp.connect(panner).connect(this.sound.master);

    const reverb = ctx.createConvolver();
    reverb.buffer = cabinEcho(ctx);
    const wet = ctx.createGain();
    wet.gain.value = SPK.reverb;
    comp.connect(reverb).connect(wet).connect(this.sound.master);

    this.out = out;
    this.panner = panner;
  }

  // Place the ceiling speaker and the listener (both in bus coordinates):
  // speaker: Vector3; head: position Vector3, forward and up Vector3s.
  setListener(speaker, head, forward, up) {
    const ctx = this.sound.ctx;
    if (!ctx || !this.panner) return;
    const now = ctx.currentTime, tc = 0.03;
    const set = (param, v) => param.setTargetAtTime(v, now, tc);
    const p = this.panner, L = ctx.listener;
    if (p.positionX) {
      set(p.positionX, speaker.x); set(p.positionY, speaker.y); set(p.positionZ, speaker.z);
    } else p.setPosition(speaker.x, speaker.y, speaker.z);
    if (L.positionX) {
      set(L.positionX, head.x); set(L.positionY, head.y); set(L.positionZ, head.z);
      set(L.forwardX, forward.x); set(L.forwardY, forward.y); set(L.forwardZ, forward.z);
      set(L.upX, up.x); set(L.upY, up.y); set(L.upZ, up.z);
    } else {
      L.setPosition(head.x, head.y, head.z);
      L.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
    }
  }

  _stop() {
    if (!this.playing) return;
    try { this.playing.source.stop(); } catch { /* already stopped */ }
    this.playing.source.disconnect();
    this.playing = null;
  }
}

// A short, fixed "small cabin" echo: a few early reflections and a soft
// tail of about 0.3 s (same every time: a seeded noise generator).
function cabinEcho(ctx) {
  const rate = ctx.sampleRate, len = Math.round(rate * 0.35);
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let seed = 7 + ch * 101;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < len; i++) d[i] = (rnd() * 2 - 1) * Math.exp(-i / (rate * 0.07)) * 0.35;
    [0.004, 0.009, 0.013, 0.021].forEach((s, k) => { d[Math.round(s * rate) + ch * 7] += (k % 2 ? -0.5 : 0.6) / (k + 1); });
  }
  return buf;
}

// Soft saturation curve; amount 0 = clean, 1 = strongly overdriven. Quiet
// sounds pass unchanged, loud peaks are rounded off (never louder).
function softClip(amount) {
  const n = 1024, curve = new Float32Array(n), k = 1 + amount * 8;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * x) / k;
  }
  return curve;
}
