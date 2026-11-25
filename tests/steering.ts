import { RED_BASIN, clamp, delta } from '../src/circuit';
import type { Kart } from '../src/drive';

export function centerSteer(kart: Kart, { length, frame, point } = RED_BASIN) {
  const here = point(kart.s, kart.lane);
  const target = point(kart.s + (7 + kart.speed * .23) / length);
  const error = delta(Math.atan2(target.x - here.x, target.z - here.z) - frame(kart.s).heading - kart.yaw, 2 * Math.PI);
  return clamp(error * 3, -1, 1);
}
