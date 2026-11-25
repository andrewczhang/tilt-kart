import { clamp, delta, mix, RED_BASIN, type Circuit } from './circuit';
import type { BoostPad } from './tracks';

export type Kart = { s: number; lane: number; yaw: number; speed: number; drift: number; boost: number; steer: number; brakeHeld: boolean; spin: number; star: number };
export type Input = { steer: number; brake: boolean; gas: boolean };
export type Pose = [s: number, lane: number, yaw: number, speed: number, drift: number, boost: number];
export const PADS = RED_BASIN.pads;
export const PAD_WIDTH = 3.3;
export const PAD_LENGTH = 4.4;
export const MAX_BOOST_SPEED = 56;

export function grid(slot: number, track = RED_BASIN): Kart {
  return { s: -(5 + Math.floor(slot / 2) * 5) / track.length, lane: slot % 2 ? 2.2 : -2.2, yaw: 0, speed: 0, drift: 0, boost: 0, steer: 0, brakeHeld: false, spin: 0, star: 0 };
}

export function pose(k: Kart): Pose {
  return [k.s, k.lane, k.yaw, k.speed, k.drift, k.boost].map(n => Math.round(n * 10000) / 10000) as Pose;
}

function entersPad(pad: BoostPad, previous: number, previousLane: number, k: Kart, track: Circuit) {
  const start = delta(previous - pad.s) * track.length;
  const travel = (k.s - previous) * track.length;
  const halfLength = PAD_LENGTH / 2, halfWidth = PAD_WIDTH / 2;
  const lane = previousLane - pad.lane;
  if (Math.abs(start) <= halfLength && Math.abs(lane) <= halfWidth) return false;
  if (start > halfLength || start + travel < -halfLength) return false;
  const enter = travel > 0 ? Math.max(0, (-halfLength - start) / travel) : 0;
  const exit = travel > 0 ? Math.min(1, (halfLength - start) / travel) : 1;
  const a = mix(lane, k.lane - pad.lane, enter);
  const b = mix(lane, k.lane - pad.lane, exit);
  return Math.min(a, b) <= halfWidth && Math.max(a, b) >= -halfWidth;
}

export function drive(k: Kart, input: Input, dt: number, track = RED_BASIN, mode: 'race' | 'time-trial' = 'race') {
  const items = mode === 'race';
  k.star = Math.max(0, k.star - dt);
  if (items && k.spin > 0) {
    k.spin = Math.max(0, k.spin - dt);
    k.drift = 0;
    k.boost = 0;
    k.brakeHeld = input.brake;
    k.speed = Math.max(6, k.speed - 24 * dt);
    k.s += k.speed * dt / track.length;
    k.yaw += (0 - k.yaw) * Math.min(1, dt * 8);
    return;
  }
  k.steer += (input.steer - k.steer) * Math.min(1, dt * 10);
  const slip = input.brake && Math.abs(k.steer) > .26 && k.speed > 15;
  if (slip) k.drift = clamp(k.drift + dt * .86, 0, 1);
  if (!input.brake && k.brakeHeld) {
    if (k.drift > .34) k.boost = Math.max(k.boost, .35 + k.drift * 1.12);
    k.drift = 0;
  }
  k.brakeHeld = input.brake;
  const starred = items && k.star > 0;
  const boosting = k.boost > 0;
  const max = starred ? 62 : boosting ? (items && k.boost > 1.45 ? 60 : MAX_BOOST_SPEED) : slip ? 35 : input.brake ? 12 : 42;
  const accel = input.brake && !slip ? -27 : starred ? 32 - k.speed * .25 : boosting || input.gas || slip ? 24 - k.speed * .29 : -8;
  k.speed = clamp(k.speed + accel * dt, 0, Math.max(0, k.speed - (slip ? 9 : 15) * dt, max));
  k.boost = Math.max(0, k.boost - dt);
  const previous = k.s, previousLane = k.lane;
  const gain = slip ? 1.27 : .91;
  k.lane += k.steer * gain * Math.min(k.speed, 37) * .31 * dt;
  const ahead = track.frame(k.s + .004), now = track.frame(k.s);
  const bend = clamp(delta(ahead.heading - now.heading, Math.PI * 2) / .21, -1, 1);
  k.lane -= bend * Math.pow(k.speed / 42, 2) * (slip ? 2 : 4.0) * dt;
  const border = track.width / 2 - .85;
  if (Math.abs(k.lane) >= border) {
    k.lane = clamp(k.lane, -border, border);
    if (!starred) k.speed = Math.max(0, k.speed - (Math.sign(k.steer) === Math.sign(k.lane) ? 41 : 15) * dt);
  }
  k.s += k.speed * (1 - Math.abs(k.steer) * (slip ? .055 : .10)) * dt / track.length;
  for (const p of track.pads) {
    if (entersPad(p, previous, previousLane, k, track)) k.boost = Math.max(k.boost, 1.38);
  }
  k.yaw += (k.steer * (slip ? .58 : .32) - k.yaw) * Math.min(1, dt * 9);
}
