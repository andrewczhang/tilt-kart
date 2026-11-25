import { LAPS, mix } from './circuit';
import { readPreference, writePreference } from './preferences';
import { courseLayoutKey, DEFAULT_TRACK, type TrackId } from './tracks';

export function formatTime(ms: number) {
  if (!Number.isFinite(ms)) return '—';
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}.${String(Math.floor(ms % 1000 / 10)).padStart(2, '0')}`;
}

export class RaceTiming {
  private crossings: (number | undefined)[] = [0];

  constructor(private track: TrackId = DEFAULT_TRACK) {}

  step(before: number, after: number, elapsed: number, duration: number, localFinish?: number) {
    for (let lap = Math.max(1, Math.floor(before) + 1); lap <= LAPS && after >= lap; lap++) {
      this.crossings[lap] ??= (lap === LAPS ? localFinish : undefined)
        ?? mix(Math.max(0, elapsed - duration), elapsed, (lap - before) / (after - before));
    }
  }

  splits(finished: boolean) {
    const end = finished ? LAPS : Math.min(LAPS - 1, this.crossings.length - 1);
    return Array.from({ length: end }, (_, i) => {
      const start = this.crossings[i], crossing = this.crossings[i + 1];
      return start != null && crossing != null ? crossing - start : undefined;
    });
  }

  records(finish: number | null) {
    const best = (key: string, time: number) => {
      key += `-${courseLayoutKey(this.track)}`;
      const stored = Number(readPreference(key));
      const previous = Number.isFinite(stored) && stored > 0 ? stored : Infinity;
      if (time > 0 && time < previous) writePreference(key, String(time));
      return time > 0 ? Math.min(time, previous) : previous;
    };
    return {
      lap: best('tilt-kart-best-lap', Math.min(...this.splits(finish !== null).filter(time => time !== undefined))),
      race: best('tilt-kart-best-time', finish ?? Infinity),
    };
  }
}
