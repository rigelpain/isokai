import { TAU } from './rng.js';

// A quiet drone whose pitch is your phase, plus small chimes.
export class Audio {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  start() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = (this.ctx = new Ctx());
    this.master = ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(ctx.destination);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 520;
    lp.Q.value = 2;
    lp.connect(this.master);
    this.lp = lp;
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0.05;
    this.droneGain.connect(lp);
    this.oscs = [1, 1.5, 2.003].map((m, i) => {
      const o = ctx.createOscillator();
      o.type = i === 1 ? 'triangle' : 'sine';
      o.frequency.value = 55 * m;
      const g = ctx.createGain();
      g.gain.value = [0.6, 0.25, 0.18][i];
      o.connect(g).connect(this.droneGain);
      o.start();
      return { o, m };
    });
  }

  toggle() {
    if (!this.ctx) return this.muted;
    this.muted = !this.muted;
    this.master.gain.setTargetAtTime(this.muted ? 0 : 0.5, this.ctx.currentTime, 0.1);
    return this.muted;
  }

  update(th, alt, tf) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const base = 48 * Math.pow(2, th / TAU) * (tf < 1 ? 0.94 : tf > 1 ? 1.06 : 1);
    for (const { o, m } of this.oscs) o.frequency.setTargetAtTime(base * m, t, 0.25);
    this.lp.frequency.setTargetAtTime(380 + Math.min(alt, 120) * 9, t, 0.4);
  }

  chime(freq = 660, dur = 0.6, vol = 0.12, type = 'sine') {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  discover() {
    [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.chime(f, 1.4, 0.09), i * 140));
  }
}
