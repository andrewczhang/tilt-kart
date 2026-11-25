import { CatmullRomCurve3, Vector3 } from 'three';

export const WIDTH = 15;
export const LAPS = 3;
export const SECTORS = 4;
export const COUNTDOWN = 3500;
export const LIMIT = 180_000;
export const COLORS = ['#f7d244', '#fe704c', '#75d5f9', '#fbb2d2', '#a7e06d', '#eaa666', '#dedfd1', '#ab9dff'];
export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
export const wrap = (n: number, period = 1) => ((n % period) + period) % period;
export const delta = (n: number, period = 1) => wrap(n + period / 2, period) - period / 2;
export const mix = (a: number, b: number, t: number) => a + (b - a) * t;

const anchors = [
  [-35, 1, 100], [-83, 1, 92], [-124, 3, 59], [-125, 7, 9],
  [-93, 9, -25], [-48, 6, -25], [-20, 3, -47], [-32, 2, -86],
  [0, 4, -122], [63, 11, -129], [111, 10, -96], [115, 6, -48],
  [80, 6, -17], [57, 4, 5], [74, 2, 39], [60, 1, 84], [13, 1, 101]
];
const spline = new CatmullRomCurve3(anchors.map(([x, y, z]) => new Vector3(x, y, z)), true);
spline.arcLengthDivisions = 2400;
export const LENGTH = spline.getLength();
export const SAMPLES = 720;
const frames = Array.from({ length: SAMPLES }, (_, i) => {
  const t = i / SAMPLES;
  const p = spline.getPointAt(t);
  const d = spline.getTangentAt(t);
  const a = spline.getTangentAt(wrap(t - .007));
  const b = spline.getTangentAt(wrap(t + .007));
  return { x: p.x, y: p.y, z: p.z, heading: Math.atan2(d.x, d.z), bank: clamp(delta(Math.atan2(b.x, b.z) - Math.atan2(a.x, a.z), Math.PI * 2) * WIDTH * .043, -.21, .21) };
});

export function frame(s: number) {
  const ix = wrap(s) * SAMPLES;
  const i = Math.floor(ix);
  const a = frames[i], b = frames[(i + 1) % SAMPLES], t = ix - i;
  return {
    x: mix(a.x, b.x, t), y: mix(a.y, b.y, t), z: mix(a.z, b.z, t),
    heading: a.heading + delta(b.heading - a.heading, Math.PI * 2) * t,
    bank: mix(a.bank, b.bank, t)
  };
}

export function point(s: number, lane = 0, height = 0) {
  const f = frame(s);
  return new Vector3(f.x + Math.cos(f.heading) * lane, f.y + lane * f.bank + height, f.z - Math.sin(f.heading) * lane);
}
