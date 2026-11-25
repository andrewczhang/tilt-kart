import type { Kart } from './drive';
import { readPreference, writePreference } from './preferences';

export class Motor {
  private ctx?: AudioContext;
  private master?: GainNode;
  private motor?: OscillatorNode;
  private skid?: GainNode;
  muted = readPreference('tilt-kart-muted') === 'true';

  start() {
    if (!this.ctx) {
      try {
        const Constructor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        const ctx = this.ctx = new Constructor();
        this.master = ctx.createGain();
        this.master.gain.value = 0;
        this.master.connect(ctx.destination);
        this.motor = ctx.createOscillator();
        this.motor.type = 'triangle';
        this.motor.frequency.value = 40;
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 260;
        this.motor.connect(filter).connect(this.master);
        this.motor.start();
        const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        const noise = ctx.createBufferSource();
        noise.buffer = buffer; noise.loop = true;
        const band = ctx.createBiquadFilter();
        band.type = 'bandpass'; band.frequency.value = 805;
        this.skid = ctx.createGain(); this.skid.gain.value = 0;
        noise.connect(band).connect(this.skid).connect(this.master);
        noise.start();
      } catch { return; }
    }
    void this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  toggle() {
    this.muted = !this.muted;
    writePreference('tilt-kart-muted', String(this.muted));
    if (!this.muted) this.start();
  }

  finish() {
    const ctx = this.ctx;
    if (!ctx || this.muted || ctx.state !== 'running') return;
    for (const [i, pitch] of [523.25, 659.25, 783.99, 1046.5].entries()) {
      const at = ctx.currentTime + i * .11;
      const note = ctx.createOscillator(), gain = ctx.createGain();
      note.type = 'triangle';
      note.frequency.value = pitch;
      gain.gain.setValueAtTime(.0001, at);
      gain.gain.exponentialRampToValueAtTime(.13, at + .02);
      gain.gain.exponentialRampToValueAtTime(.0001, at + .28);
      note.connect(gain).connect(ctx.destination);
      note.start(at);
      note.stop(at + .28);
    }
  }

  update(kart?: Kart) {
    if (!this.ctx || !this.master || !this.motor || !this.skid) return;
    const now = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(!this.muted && kart ? .13 : 0, now, .11);
    if (kart) {
      const pitch = 42 + kart.speed * 2.65 + (kart.boost > 0 ? 16 : 0) + (kart.star > 0 ? 22 : 0);
      this.motor.frequency.setTargetAtTime(pitch, now, .075);
      this.skid.gain.setTargetAtTime(kart.drift * .45, now, .12);
    }
  }

  sfx(kind: 'pickup' | 'roulette' | 'ready' | 'turbo' | 'fire' | 'drop' | 'hit' | 'star') {
    if (this.muted || !this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const tone = (freq: number, endFreq: number, dur: number, type: OscillatorType = 'triangle', gain = 0.14, delay = 0) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now + delay);
      osc.frequency.exponentialRampToValueAtTime(Math.max(30, endFreq), now + delay + dur);
      g.gain.setValueAtTime(0.001, now + delay);
      g.gain.linearRampToValueAtTime(gain, now + delay + 0.015);
      g.gain.exponentialRampToValueAtTime(0.001, now + delay + dur);
      osc.connect(g).connect(ctx.destination);
      osc.start(now + delay);
      osc.stop(now + delay + dur + 0.02);
    };
    if (kind === 'pickup') { tone(520, 780, 0.12, 'triangle', 0.14); tone(780, 1040, 0.14, 'triangle', 0.12, 0.08); }
    else if (kind === 'roulette') { tone(660, 720, 0.045, 'square', 0.05); }
    else if (kind === 'ready') { tone(784, 1175, 0.16, 'triangle', 0.15); }
    else if (kind === 'turbo') { tone(240, 880, 0.32, 'sawtooth', 0.14); }
    else if (kind === 'fire') { tone(440, 180, 0.16, 'square', 0.13); }
    else if (kind === 'drop') { tone(280, 120, 0.14, 'triangle', 0.13); }
    else if (kind === 'hit') { tone(460, 110, 0.36, 'sawtooth', 0.16); tone(320, 95, 0.32, 'square', 0.1, 0.08); }
    else if (kind === 'star') {
      [523, 659, 784, 1047].forEach((f, i) => tone(f, f * 1.03, 0.14, 'triangle', 0.13, i * 0.065));
    }
  }
}
