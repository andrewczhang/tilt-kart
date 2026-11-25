import { LAPS, RED_BASIN, SECTORS } from './circuit';
import { grid, pose, type Pose } from './drive';
import type { TrackId } from './tracks';

export type Driver = {
  id: string; name: string; slot: number; pose: Pose; checkpoint: number; finish: number | null; online: boolean;
};
export type RoomState = { host: string; start: number | null; complete: boolean; drivers: Driver[]; track?: TrackId };
export type ServerMessage =
  | { type: 'welcome'; id: string; now: number; room: RoomState }
  | { type: 'room'; room: RoomState }
  | { type: 'state'; id: string; pose: Pose; checkpoint: number; finish: number | null }
  | { type: 'error'; reason: string };

export function driver(id: string, name: string, slot: number, track = RED_BASIN): Driver {
  return { id, name, slot, pose: pose(grid(slot, track)), checkpoint: -1, finish: null, online: true };
}

export function rank(drivers: Driver[]) {
  return [...drivers].sort((a, b) => {
    if (a.finish !== null || b.finish !== null) return (a.finish ?? Infinity) - (b.finish ?? Infinity);
    if (a.online !== b.online) return Number(b.online) - Number(a.online);
    return b.pose[0] - a.pose[0] || a.slot - b.slot;
  });
}

export function validPose(value: unknown, track = RED_BASIN): value is Pose {
  if (!Array.isArray(value) || value.length !== 6 || !value.every(Number.isFinite)) return false;
  const [s, lane, yaw, speed, drift, boost] = value;
  return s >= -.05 && s <= LAPS + .01 && Math.abs(lane) <= track.width / 2 && Math.abs(yaw) <= 1
    && speed >= 0 && speed <= 56 && drift >= 0 && drift <= 1 && boost >= 0 && boost <= 1.5;
}

export function checkpointAt(s: number, track = RED_BASIN) {
  if (s < 0) return -1;
  if (s >= LAPS) return LAPS * SECTORS;
  const lap = Math.floor(s);
  let checkpoint = lap * SECTORS;
  for (const boundary of track.checkpoints) if (s >= lap + boundary) checkpoint++;
  return checkpoint;
}

export function advance(d: Driver, p: Pose, elapsed: number, dt: number, track = RED_BASIN) {
  if (d.finish !== null || p[0] < d.pose[0] || p[0] - d.pose[0] > 59 * (dt + .14) / track.length) return false;
  d.pose = p;
  const checkpoint = checkpointAt(p[0], track);
  if (checkpoint > d.checkpoint) d.checkpoint = checkpoint;
  if (d.checkpoint === LAPS * SECTORS) d.finish = elapsed;
  return true;
}
