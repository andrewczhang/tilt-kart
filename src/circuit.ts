import { CatmullRomCurve3, Vector3 } from 'three';
import { DEFAULT_TRACK, TRACKS, type Branch, type Section, type TrackId, type TrackSpec } from './tracks';

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
const FLIGHT_SECONDS = .8;
export const inSection = (s: number, section: Section) => {
  const station = s - Math.floor(s) + 1e-10;
  return station >= section.start && station < section.end;
};
const envelope = (s: number, section: Section) => Math.sin(Math.PI * (wrap(s) - section.start) / (section.end - section.start)) ** 2;

type Frame = { x: number; y: number; z: number; heading: number; bank: number };
export type Circuit = TrackSpec & {
  id: TrackId;
  length: number;
  frame(s: number): Frame;
  point(s: number, lane?: number, height?: number): Vector3;
  widthAt(s: number): number;
  branchAt(s: number): (Branch & { center: number }) | undefined;
  laneBounds(s: number, lane: number, previousS?: number, previousLane?: number): [number, number];
  surfaceAt(s: number, lane: number): number;
  airHeight(s: number): number;
  flightSpeed(s: number): number;
  gapAt(s: number): boolean;
  gradeAt(s: number): number;
  progressScale(s: number, lane: number): number;
  rumbleAt(s: number): number;
};

const circuits = new Map<TrackId, Circuit>();

export function getTrack(id: TrackId = DEFAULT_TRACK): Circuit {
  const cached = circuits.get(id);
  if (cached) return cached;
  const spec: TrackSpec = TRACKS[id];
  const spline = new CatmullRomCurve3(spec.anchors.map(([x, y, z]) => new Vector3(x, y, z)), true);
  spline.arcLengthDivisions = 2400;
  const length = spline.getLength();
  const profiles = spec.profile ?? [], surfaces = spec.surfaces ?? [], jumps = spec.jumps ?? [];
  function widthAt(s: number) {
    return profiles.reduce((width, p) => width + (inSection(s, p) ? (p.width ?? 0) * envelope(s, p) : 0), spec.width);
  }
  function branchAt(s: number) {
    const b = spec.branch;
    if (!b || !inSection(s, b)) return;
    return { ...b, center: b.side * (widthAt(s) / 2 - b.width / 2 + b.spread * envelope(s, b)) };
  }
  function laneBounds(s: number, lane: number, previousS = s, previousLane = lane): [number, number] {
    const edge = widthAt(s) / 2, branch = branchAt(s);
    if (!branch) return [-edge, edge];
    const near = Math.abs(branch.center) - branch.width / 2, far = near + branch.width;
    const asBounds = (a: number, b: number): [number, number] => branch.side > 0 ? [a, b] : [-b, -a];
    if (near <= edge) return asBounds(-edge, Math.max(edge, far));
    const from = branchAt(previousS);
    const previousEdge = widthAt(previousS) / 2;
    const previousNear = from ? Math.abs(from.center) - from.width / 2 : -Infinity;
    const onBranch = previousNear > previousEdge ? previousLane * branch.side >= (previousEdge + previousNear) / 2
      : lane * branch.side >= (edge + near) / 2;
    return onBranch ? asBounds(near, far) : [-edge, edge];
  }
  function surfaceAt(s: number, lane: number) {
    const zone = surfaces.find(p => inSection(s, p) && (!p.edge || Math.abs(lane) > widthAt(s) * .31));
    return (zone?.grip ?? 1) * (rumbleAt(s) ? .83 : 1);
  }
  const gapAt = (s: number) => jumps.some(j => inSection(s, j));
  function rampHeight(s: number) {
    s = wrap(s);
    for (const j of jumps) {
      if (s >= j.start - j.ramp && s < j.start) return j.rise * ((s - j.start + j.ramp) / j.ramp) ** 2;
      if (s >= j.start && s < j.end) return j.rise * (j.end - s) / (j.end - j.start);
    }
    return 0;
  }
  function flightSpeed(s: number) {
    const j = jumps.find(p => inSection(s, p));
    return j ? (j.end - j.start) * length / FLIGHT_SECONDS : 0;
  }
  function airHeight(s: number) {
    const j = jumps.find(p => inSection(s, p));
    if (!j) return 0;
    const t = (wrap(s) - j.start) / (j.end - j.start);
    return 4 * t * (1 - t) * j.arc;
  }
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
      const bank = profiles.reduce((b, p) => b + (inSection(t, p) ? (p.bank ?? 0) * envelope(t, p) : 0),
        clamp(curve * spec.width * .043 * spec.bank, -.21, .21));
      return { x, y, z, heading: headingAt(t), bank };
    });
    const ix = wrap(s) * SAMPLES;
    const i = Math.floor(ix);
    const a = frames[i], b = frames[(i + 1) % SAMPLES], t = ix - i;
    return {
      x: mix(a.x, b.x, t), y: mix(a.y, b.y, t) + rampHeight(s), z: mix(a.z, b.z, t),
      heading: a.heading + delta(b.heading - a.heading, Math.PI * 2) * t,
      bank: mix(a.bank, b.bank, t)
    };
  }
  function point(s: number, lane = 0, height = 0) {
    const f = frame(s);
    const bowl = profiles.find(p => p.bank !== undefined && inSection(s, p));
    const lip = bowl ? Math.max(0, Math.abs(lane) - spec.width * .30) ** 2 * .024 * envelope(s, bowl) : 0;
    return new Vector3(f.x + Math.cos(f.heading) * lane, f.y + lane * f.bank + height + lip, f.z - Math.sin(f.heading) * lane);
  }
  function gradeAt(s: number) {
    const d = 2 / length;
    return clamp((frame(s + d).y - frame(s - d).y) / 4, -.6, .6);
  }
  function progressScale(s: number, lane: number) {
    const branch = branchAt(s);
    if (!branch || lane * branch.side <= widthAt(s) / 2) return 1;
    const step = 2 / length;
    const offset = lane - branch.center;
    const a = point(s - step, (branchAt(s - step)?.center ?? branch.center) + offset);
    const b = point(s + step, (branchAt(s + step)?.center ?? branch.center) + offset);
    return clamp(4 / a.distanceTo(b), .75, 1.38);
  }
  function rumbleAt(s: number) {
    return spec.feature.kind === 'truss' && inSection(s, spec.feature) ? Math.sin(s * length * 2.8) : 0;
  }
  const track = { ...spec, id, length, frame, point, widthAt, branchAt, laneBounds, surfaceAt, airHeight, flightSpeed, gapAt, gradeAt, progressScale, rumbleAt };
  circuits.set(id, track);
  return track;
}

export const RED_BASIN = getTrack();
export const { width: WIDTH, length: LENGTH, frame, point } = RED_BASIN;
