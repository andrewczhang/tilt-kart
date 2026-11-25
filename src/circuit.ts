import { CatmullRomCurve3, Vector3 } from 'three';
import { DEFAULT_TRACK, TRACKS, type TrackId, type TrackSpec } from './tracks';

export const LAPS = 3;
export const SECTORS = 4;
export const COUNTDOWN = 3500;
export const LIMIT = 180_000;
export const COLORS = ['#f7d244', '#fe704c', '#75d5f9', '#fbb2d2', '#a7e06d', '#eaa666', '#dedfd1', '#ab9dff'];
export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
export const wrap = (n: number, period = 1) => ((n % period) + period) % period;
export const delta = (n: number, period = 1) => wrap(n + period / 2, period) - period / 2;
export const mix = (a: number, b: number, t: number) => a + (b - a) * t;
export const SAMPLES = 720;

type Frame = { x: number; y: number; z: number; heading: number; bank: number };
export type Circuit = TrackSpec & {
  id: TrackId;
  length: number;
  frame(s: number): Frame;
  point(s: number, lane?: number, height?: number): Vector3;
};

const circuits = new Map<TrackId, Circuit>();

export function getTrack(id: TrackId = DEFAULT_TRACK): Circuit {
  const cached = circuits.get(id);
  if (cached) return cached;
  const spec = TRACKS[id];
  const spline = new CatmullRomCurve3(spec.anchors.map(([x, y, z]) => new Vector3(x, y, z)), true);
  spline.arcLengthDivisions = 2400;
  const length = spline.getLength();
  let frames: Frame[] | undefined;
  const headingAt = (t: number) => {
    const d = spline.getTangentAt(wrap(t));
    return Math.atan2(d.x, d.z);
  };
  function frame(s: number) {
    frames ??= Array.from({ length: SAMPLES }, (_, i) => {
      const t = i / SAMPLES;
      const { x, y, z } = spline.getPointAt(t);
      const curve = delta(headingAt(t + .007) - headingAt(t - .007), Math.PI * 2);
      return { x, y, z, heading: headingAt(t), bank: clamp(curve * spec.width * .043 * spec.bank, -.21, .21) };
    });
    const ix = wrap(s) * SAMPLES;
    const i = Math.floor(ix);
    const a = frames[i], b = frames[(i + 1) % SAMPLES], t = ix - i;
    return {
      x: mix(a.x, b.x, t), y: mix(a.y, b.y, t), z: mix(a.z, b.z, t),
      heading: a.heading + delta(b.heading - a.heading, Math.PI * 2) * t,
      bank: mix(a.bank, b.bank, t)
    };
  }
  function point(s: number, lane = 0, height = 0) {
    const f = frame(s);
    return new Vector3(f.x + Math.cos(f.heading) * lane, f.y + lane * f.bank + height, f.z - Math.sin(f.heading) * lane);
  }
  const track = { ...spec, id, length, frame, point };
  circuits.set(id, track);
  return track;
}

export const RED_BASIN = getTrack();
export const { width: WIDTH, length: LENGTH, frame, point } = RED_BASIN;
