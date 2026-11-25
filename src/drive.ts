import { clamp, delta, mix, RED_BASIN, type Circuit } from './circuit';
import type { BoostPad } from './tracks';

export type Kart = { s: number; lane: number; yaw: number; slipAngle: number; recovery: number; speed: number; drift: number; boost: number; steer: number; brakeHeld: boolean; spin: number; star: number; turbo: number };
export type Input = { steer: number; brake: boolean; gas: boolean; maxProgress?: number };
export type Pose = [s: number, lane: number, yaw: number, speed: number, drift: number, boost: number];
type RemoteVelocity = { x: number; z: number };
export type RemoteSample = { pose: Pose; receivedAt: number; velocity?: RemoteVelocity };
type ContactPoint = { x: number; y: number; z: number };
type RemoteContact = ContactPoint & { velocity: RemoteVelocity | undefined };
export const PADS = RED_BASIN.pads;
export const PAD_WIDTH = 3.3;
export const PAD_LENGTH = 4.4;
export const MAX_BOOST_SPEED = 56;
export const TOP_SPEED = 42;
export const BOOST_SPEED = TOP_SPEED * 1.15;
const TURN = 2 * Math.PI;
const STEP = 1 / 60;
const KART_DIAMETER = 2.65;

export function grid(slot: number, track = RED_BASIN): Kart {
  return { s: -(5 + Math.floor(slot / 2) * 5) / track.length, lane: slot % 2 ? 2.2 : -2.2, yaw: 0, slipAngle: 0, recovery: 0, speed: 0, drift: 0, boost: 0, steer: 0, brakeHeld: false, spin: 0, star: 0, turbo: 0 };
}

export function pose(k: Kart): Pose {
  const rest = [k.lane, k.yaw, k.speed, k.drift, k.boost].map(n => Math.round(n * 10000) / 10000);
  return [Math.floor(k.s * 10000) / 10000, ...rest] as Pose;
}

function entersPad(pad: BoostPad, previous: number, previousLane: number, k: Kart, track: Circuit) {
  const forwards = k.s >= previous;
  const start = delta((forwards ? previous : k.s) - pad.s) * track.length;
  const travel = Math.abs(k.s - previous) * track.length;
  const halfLength = PAD_LENGTH / 2, halfWidth = PAD_WIDTH / 2;
  const lane = (forwards ? previousLane : k.lane) - pad.lane;
  const endLane = (forwards ? k.lane : previousLane) - pad.lane;
  if (Math.abs(delta(previous - pad.s) * track.length) <= halfLength && Math.abs(previousLane - pad.lane) <= halfWidth) return false;
  if (start > halfLength || start + travel < -halfLength) return false;
  const enter = travel > 0 ? Math.max(0, (-halfLength - start) / travel) : 0;
  const exit = travel > 0 ? Math.min(1, (halfLength - start) / travel) : 1;
  const a = mix(lane, endLane, enter);
  const b = mix(lane, endLane, exit);
  return Math.min(a, b) <= halfWidth && Math.max(a, b) >= -halfWidth;
}

function activatePads(k: Kart, previous: number, previousLane: number, track: Circuit) {
  for (const p of track.pads) {
    if (entersPad(p, previous, previousLane, k, track)) k.boost = Math.max(k.boost, 1.38);
  }
}

export function substep(dt: number, step: (dt: number) => void) {
  const count = Math.ceil(dt / STEP - 1e-9);
  for (let i = 0; i < count; i++) step(dt / count);
}

export function drive(k: Kart, input: Input, dt: number, track = RED_BASIN, mode: 'race' | 'time-trial' = 'race') {
  substep(dt, step => integrate(k, input, step, track, mode === 'race'));
}

function project(k: Kart, x: number, z: number, heading: number, track: Circuit, maxProgress = Infinity) {
  const previous = k.s, previousLane = k.lane;
  // Project into the nearby track frame, not onto a different leg of the loop.
  for (let i = 0; i < 4; i++) {
    const f = track.frame(k.s);
    k.s += ((x - f.x) * Math.sin(f.heading) + (z - f.z) * Math.cos(f.heading)) / track.length;
  }
  k.s = Math.min(k.s, maxProgress);
  const next = track.frame(k.s);
  const lane = (x - next.x) * Math.cos(next.heading) - (z - next.z) * Math.sin(next.heading);
  const [left, right] = track.laneBounds(k.s, lane, previous, previousLane);
  k.lane = clamp(lane, left + .85, right - .85);
  k.yaw = delta(heading - next.heading, TURN);
  return { lane, heading: next.heading };
}

function nudge(k: Kart, x: number, z: number, heading: number, vx: number, vz: number, impulse: number, track: Circuit) {
  const previous = k.s, previousLane = k.lane;
  project(k, x, z, heading, track);
  activatePads(k, previous, previousLane, track);
  if (impulse > 0) {
    k.speed = Math.min(Math.max(BOOST_SPEED, k.speed), Math.hypot(vx, vz));
    k.slipAngle = k.speed ? delta(Math.atan2(vx, vz) - heading, TURN) : 0;
    k.recovery = .09;
  }
}

export function sampleRemote(pose: Pose, receivedAt: number, previous?: RemoteSample, track = RED_BASIN): RemoteSample {
  const sample: RemoteSample = { pose, receivedAt };
  if (!previous) return sample;
  const dt = (receivedAt - previous.receivedAt) / 1000;
  if (dt < .025 || dt > .25) return sample;
  const from = track.point(previous.pose[0], previous.pose[1]);
  const to = track.point(pose[0], pose[1]);
  const dx = to.x - from.x, dz = to.z - from.z;
  const speedLimit = Math.max(BOOST_SPEED, pose[3], previous.pose[3]);
  const scale = Math.min(1 / dt, speedLimit / Math.hypot(dx, dz));
  sample.velocity = { x: dx * scale, z: dz * scale };
  return sample;
}

export function remoteContact({ pose: [s, lane], receivedAt, velocity }: RemoteSample, now: number, track = RED_BASIN): RemoteContact {
  const p = track.point(s, lane);
  const age = clamp((now - receivedAt) / 1000, 0, .1);
  return { x: p.x + (velocity?.x ?? 0) * age, y: p.y, z: p.z + (velocity?.z ?? 0) * age, velocity };
}

export function kartContactDistance(a: ContactPoint, b: ContactPoint) {
  if (Math.abs(a.y - b.y) > 2.5) return null;
  const distance = Math.hypot(a.x - b.x, a.z - b.z);
  return distance < KART_DIAMETER ? distance : null;
}

export function bump(a: Kart, b: Kart | RemoteContact, track = RED_BASIN) {
  const remote = 'velocity' in b;
  const aFrame = track.frame(a.s);
  const p = track.point(a.s, a.lane), q = remote ? b : track.point(b.s, b.lane);
  const distance = kartContactDistance(p, q);
  if (distance === null) return;
  const dx = p.x - q.x, dz = p.z - q.z;
  const nx = distance > 1e-6 ? dx / distance : Math.cos(aFrame.heading);
  const nz = distance > 1e-6 ? dz / distance : -Math.sin(aFrame.heading);
  const aHeading = aFrame.heading + a.yaw, bHeading = remote ? 0 : track.frame(b.s).heading + b.yaw;
  const av = aHeading + a.slipAngle, bv = bHeading + (remote ? 0 : b.slipAngle);
  const ax = Math.sin(av) * a.speed, az = Math.cos(av) * a.speed;
  const velocity = remote ? b.velocity : { x: Math.sin(bv) * b.speed, z: Math.cos(bv) * b.speed };
  const fraction = remote ? 1 : .5;
  const correction = (KART_DIAMETER - distance) * fraction;
  const impulse = velocity ? Math.max(0, ((velocity.x - ax) * nx + (velocity.z - az) * nz) * 1.32 * fraction) : 0;
  nudge(a, p.x + nx * correction, p.z + nz * correction, aHeading, ax + nx * impulse, az + nz * impulse, impulse, track);
  if (!remote && velocity) nudge(b, q.x - nx * correction, q.z - nz * correction, bHeading, velocity.x - nx * impulse, velocity.z - nz * impulse, impulse, track);
}

function integrate(k: Kart, input: Input, dt: number, track: Circuit, items: boolean) {
  const flight = track.flightSpeed(k.s);
  k.star = Math.max(0, k.star - dt);
  if (items && k.spin > 0) {
    k.spin = Math.max(0, k.spin - dt);
    k.drift = 0;
    k.boost = 0;
    k.turbo = 0;
    k.slipAngle = 0;
    k.recovery = 0;
    k.brakeHeld = input.brake;
    k.speed = Math.max(6, k.speed - 24 * dt);
    const next = k.s + (flight || k.speed * track.progressScale(k.s, k.lane)) * dt / track.length;
    const [left, right] = track.laneBounds(next, k.lane, k.s, k.lane);
    k.lane = clamp(k.lane, left + .85, right - .85);
    k.s = next;
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
  const max = starred ? 62 : items && k.turbo > 0 ? (k.turbo > 1.45 ? 60 : MAX_BOOST_SPEED) : boosting && !input.brake ? BOOST_SPEED : slip ? 35 : input.brake ? 12 : TOP_SPEED;
  const surface = flight ? .22 : track.surfaceAt(k.s, k.lane);
  const slope = flight ? 0 : track.gradeAt(k.s);
  const accel = input.brake && !slip ? -27 * surface : starred ? 32 - k.speed * .25 : boosting || input.gas || slip ? 24 - k.speed * .29 : -8;
  k.speed = clamp(k.speed + (accel - slope * 18) * dt, 0, Math.min(items ? Infinity : BOOST_SPEED, Math.max(k.speed - (slip ? 9 : 15) * dt, max)));
  k.turbo = Math.max(0, k.turbo - dt);
  k.boost = Math.max(0, k.boost - dt);
  const previous = k.s, previousLane = k.lane;
  const here = track.frame(previous);
  const turn = k.steer * Math.min(1, k.speed / 10) * (slip ? 3.6 : 3.1) * dt;
  const grip = 1 - Math.exp(-dt * surface * (k.recovery > 0 ? 2.5 : slip ? 5 : 28));
  k.recovery = Math.max(0, k.recovery - dt);
  const heading = here.heading + k.yaw + turn;
  const travelHeading = heading + (k.slipAngle - turn) * (1 - grip);
  if (flight) {
    k.s += flight * dt / track.length;
    const lane = previousLane + Math.sin(travelHeading - here.heading) * k.speed * dt;
    const [left, right] = track.laneBounds(k.s, lane, previous, previousLane);
    k.lane = clamp(lane, left + .85, right - .85);
    k.yaw = delta(heading - track.frame(k.s).heading, TURN);
    k.slipAngle = travelHeading - heading;
    return;
  }
  const x = here.x + Math.cos(here.heading) * k.lane + Math.sin(travelHeading) * k.speed * dt;
  const z = here.z - Math.sin(here.heading) * k.lane + Math.cos(travelHeading) * k.speed * dt;

  const next = project(k, x, z, heading, track, input.maxProgress);
  k.slipAngle = travelHeading - heading;
  if (next.lane !== k.lane) {
    const side = Math.sign(next.lane - k.lane);
    const relative = delta(travelHeading - next.heading, TURN);
    const normal = Math.sin(relative) * k.speed;
    if (normal * side > 0) {
      const tangent = Math.cos(relative) * k.speed;
      const incidence = Math.abs(normal) / k.speed;
      const rebound = -normal * mix(.48, .68, incidence);
      const along = tangent * (1 - .12 * incidence);
      const reflected = Math.atan2(rebound, along);
      if (!starred) k.speed = Math.hypot(along, rebound);
      k.yaw = delta(k.yaw + delta(reflected - k.yaw, TURN) * clamp((incidence - .5) * 2, 0, 1), TURN);
      k.slipAngle = delta(reflected - k.yaw, TURN);
      k.recovery = Math.sin(k.yaw) * side < .45 ? .07 : 0;
    }
  }
  activatePads(k, previous, previousLane, track);
}
