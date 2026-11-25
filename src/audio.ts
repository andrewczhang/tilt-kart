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
  }

  toggle() {
    this.muted = !this.muted;
    writePreference('tilt-kart-muted', String(this.muted));
    if (!this.muted) this.start();
  }

  update(kart?: Kart) {
    if (!this.ctx || !this.master || !this.motor || !this.skid) return;
    const now = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(!this.muted && kart ? .13 : 0, now, .11);
    if (kart) {
      this.motor.frequency.setTargetAtTime(42 + kart.speed * 2.65 + (kart.boost > 0 ? 16 : 0), now, .075);
      this.skid.gain.setTargetAtTime(kart.drift * .45, now, .12);
    }
  }
}
