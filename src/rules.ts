import { LAPS, LENGTH, SECTORS, WIDTH } from './circuit';
import { grid, pose, type Pose } from './drive';

export type Driver = {
  id: string; name: string; slot: number; pose: Pose; checkpoint: number; finish: number | null; online: boolean;
};
export type RoomState = { host: string; start: number | null; complete: boolean; drivers: Driver[] };
export type ServerMessage =
  | { type: 'welcome'; id: string; now: number; room: RoomState }
  | { type: 'room'; room: RoomState }
  | { type: 'state'; id: string; pose: Pose; checkpoint: number; finish: number | null }
  | { type: 'error'; reason: string };

export function driver(id: string, name: string, slot: number): Driver {
  return { id, name, slot, pose: pose(grid(slot)), checkpoint: -1, finish: null, online: true };
}

export function rank(drivers: Driver[]) {
  return [...drivers].sort((a, b) => {
    if (a.finish !== null || b.finish !== null) return (a.finish ?? Infinity) - (b.finish ?? Infinity);
    if (a.online !== b.online) return Number(b.online) - Number(a.online);
    return b.pose[0] - a.pose[0] || a.slot - b.slot;
  });
}

export function validPose(value: unknown): value is Pose {
  if (!Array.isArray(value) || value.length !== 6 || !value.every(Number.isFinite)) return false;
  const [s, lane, yaw, speed, drift, boost] = value;
  return s >= -.05 && s <= LAPS + .01 && Math.abs(lane) <= WIDTH / 2 && Math.abs(yaw) <= 1
    && speed >= 0 && speed <= 56 && drift >= 0 && drift <= 1 && boost >= 0 && boost <= 1.5;
}

export function advance(d: Driver, p: Pose, elapsed: number, dt: number) {
  if (d.finish !== null || p[0] < d.pose[0] || p[0] - d.pose[0] > 59 * (dt + .14) / LENGTH) return false;
  d.pose = p;
  const checkpoint = Math.min(LAPS * SECTORS, Math.floor(p[0] * SECTORS));
  if (checkpoint > d.checkpoint) d.checkpoint = checkpoint;
  if (d.checkpoint === LAPS * SECTORS) d.finish = elapsed;
  return true;
}
