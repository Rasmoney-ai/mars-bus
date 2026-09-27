// Narration (speak) for the solo ride: one sound file per part of the ride
// (the welcome, each drive and each stop), named in src/route.js.
//
// The speak follows the ride time t, like everything else: at any t the
// file for that part plays from the matching position, so pause, seek and
// jumping between stops keep it in step. Nothing is queued frame by frame.
// In the shared ride (step 2) the teacher's computer plays the guide
// instead, and this is switched off.

import { NARRATION } from './config.js';

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
  }

  // Fetch all files in the background (small mp3 files).
  load() {
    for (const part of this.parts) {
      fetch(`${NARRATION.folder}${part.name}.mp3`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status))))
        .then((data) => { part.data = data; })
        .catch(() => { part.missing = true; });
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
    if (!this.out) {
      this.out = ctx.createGain();
      this.out.gain.value = NARRATION.volume;
      this.out.connect(this.sound.master);
    }

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
      // decodeAudioData detaches the data it is given, so pass a copy.
      ctx.decodeAudioData(part.data.slice(0))
        .then((buffer) => { part.buffer = buffer; })
        .catch(() => { part.missing = true; })
        .finally(() => { part.decoding = false; });
    });
  }

  _stop() {
    if (!this.playing) return;
    try { this.playing.source.stop(); } catch { /* already stopped */ }
    this.playing.source.disconnect();
    this.playing = null;
  }
}
