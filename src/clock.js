// Clock sources. The timeline only ever asks a clock for the ride time t,
// so the source can be swapped without touching anything else:
//
//   step 1: LocalClock  - this device's own clock (below)
//   step 2: a shared clock from the server (network.js), same interface
//   step 4: the soundtrack's playback time, same interface
//
// Interface:
//   getTime()  -> ride time t in seconds (0 .. duration)
//   playing    -> true while the ride time advances
//   play(), pause(), seek(t)  (a shared clock may ignore these and follow
//                              the teacher's commands instead)

export class LocalClock {
  constructor(duration) {
    this.duration = duration;
    this.playing = false;
    this._base = 0;       // ride time when last started/paused/seeked
    this._startedAt = 0;  // performance.now() when last started
  }

  getTime() {
    if (!this.playing) return this._base;
    const t = this._base + (performance.now() - this._startedAt) / 1000;
    if (t >= this.duration) {
      // The ride is over: stop at the end.
      this._base = this.duration;
      this.playing = false;
      return this.duration;
    }
    return t;
  }

  play() {
    if (this.playing) return;
    if (this._base >= this.duration) this._base = 0;
    this._startedAt = performance.now();
    this.playing = true;
  }

  pause() {
    if (!this.playing) return;
    this._base = this.getTime();
    this.playing = false;
  }

  seek(t) {
    this._base = Math.min(Math.max(t, 0), this.duration);
    this._startedAt = performance.now();
  }

  restart() {
    this.seek(0);
    this.play();
  }
}
