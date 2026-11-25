import type { TrackId } from './tracks';

export const CUPS = {
  'summit': { name: 'Summit Cup', tracks: ['red-basin', 'cedar', 'frostline', 'mesa'] },
  'afterburn': { name: 'Afterburn Cup', tracks: ['saltwater', 'switchyard', 'cinder', 'arena'] },
} as const satisfies Record<string, { name: string; tracks: readonly [TrackId, TrackId, TrackId, TrackId] }>;

export type CupId = keyof typeof CUPS;
export const CUP_IDS = Object.keys(CUPS) as CupId[];
export const CUP_POINTS = [15, 12, 10, 8, 6, 4, 2, 1] as const;

type Result = { id: string; name: string; slot: number; place: number | null };
type Entrant = Omit<Result, 'place'> & { finish: number | null };
export type Cup = { id: CupId; round: number; results: Result[][] };

export function isCupId(id: string): id is CupId {
  return Object.hasOwn(CUPS, id);
}

export function newCup(id: CupId): Cup {
  return { id, round: 0, results: [] };
}

export function cupTrack(cup: Cup): TrackId {
  return CUPS[cup.id].tracks[cup.round];
}

export function nextRound(cup: Cup): Cup | undefined {
  if (cup.results.length !== cup.round + 1 || cup.results.length === CUPS[cup.id].tracks.length) return;
  return { ...cup, round: cup.round + 1 };
}

export function scoreRound(cup: Cup, entrants: Entrant[]): Cup {
  if (cup.results.length !== cup.round) return cup;
  const ranked = [...entrants].sort((a, b) => (a.finish ?? Infinity) - (b.finish ?? Infinity) || a.slot - b.slot);
  const result = ranked.map(({ id, name, slot, finish }, i) => ({ id, name, slot, place: finish === null ? null : i + 1 }));
  return { ...cup, results: [...cup.results, result] };
}

export function cupStandings(cup: Cup) {
  const table = new Map<string, Omit<Result, 'place'> & { total: number; points: number[]; places: number[] }>();
  cup.results.forEach((result, round) => {
    for (const { id, name, slot, place } of result) {
      const entry = table.get(id) ?? { id, name, slot, total: 0, points: cup.results.map(() => 0), places: CUP_POINTS.map(() => 0) };
      if (place !== null) {
        entry.points[round] = CUP_POINTS[place - 1] ?? 0;
        entry.total += entry.points[round];
        entry.places[place - 1]++;
      }
      table.set(id, entry);
    }
  });
  return [...table.values()].sort((a, b) => {
    if (a.total !== b.total) return b.total - a.total;
    for (const [i, count] of a.places.entries()) if (count !== b.places[i]) return b.places[i] - count;
    return a.slot - b.slot;
  });
}
