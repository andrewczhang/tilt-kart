import { readPreference, writePreference } from './preferences';
import type { TrackId } from './tracks';

const MUTE_KEY = 'tilt-kart-music-muted';
const VOLUME = .55;

export class RaceMusic {
  private track?: TrackId;
  private request?: AbortController;
  private playing?: { source: AudioBufferSourceNode; gain: GainNode };
  muted: boolean;

  constructor(private getContext: () => AudioContext | undefined, legacyMute = false) {
    const saved = readPreference(MUTE_KEY);
    this.muted = saved === null ? legacyMute : saved === 'true';
    if (saved === null) writePreference(MUTE_KEY, String(this.muted));
  }

  start(track: TrackId) {
    this.stop();
    this.track = track;
    if (!this.muted) void this.play();
  }

  toggle() {
    this.muted = !this.muted;
    writePreference(MUTE_KEY, String(this.muted));
    if (this.playing) {
      if (!this.muted) this.getContext();
      const { gain } = this.playing;
      gain.gain.setTargetAtTime(this.muted ? 0 : VOLUME, gain.context.currentTime, .02);
    } else if (!this.muted) {
      void this.play();
    }
  }

  stop() {
    this.track = undefined;
    this.request?.abort();
    this.request = undefined;
    if (!this.playing) return;
    const { source, gain } = this.playing;
    const now = source.context.currentTime;
    gain.gain.setTargetAtTime(0, now, .015);
    source.stop(now + .075);
    this.playing = undefined;
  }

  private async play() {
    if (!this.track || this.request) return;
    const ctx = this.getContext();
    if (!ctx) return;
    const request = this.request = new AbortController();
    try {
      const res = await fetch(`/music/${this.track}.mp3`, { signal: request.signal });
      if (!res.ok) return;
      const bytes = await res.arrayBuffer();
      if (request.signal.aborted) return;
      const buffer = await ctx.decodeAudioData(bytes);
      if (request.signal.aborted) return;
      const source = ctx.createBufferSource();
      const gain = ctx.createGain();
      source.buffer = buffer;
      source.loop = true;
      gain.gain.value = 0;
      source.connect(gain).connect(ctx.destination);
      source.onended = () => { source.disconnect(); gain.disconnect(); };
      gain.gain.setTargetAtTime(this.muted ? 0 : VOLUME, ctx.currentTime, .025);
      source.start();
      this.playing = { source, gain };
    } catch {
      // Music is optional: a failed download or decoder must not stop the race.
    } finally {
      if (this.request === request) this.request = undefined;
    }
  }
}
