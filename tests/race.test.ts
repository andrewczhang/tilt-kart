import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LAPS, LENGTH, LIMIT, SECTORS, WIDTH, delta, frame, point } from '../src/circuit';
import { BOOST_SPEED, PADS, PAD_LENGTH, PAD_WIDTH, TOP_SPEED, bump, drive, grid, pose } from '../src/drive';
import { advance, driver, rank, validPose } from '../src/rules';
import { centerSteer } from './steering';

const gas = { steer: 0, brake: false, gas: true };
const dt = 1 / 60;

test('the elevated and banked track joins at the finish line', () => {
  assert.deepEqual(point(0).toArray(), point(1).toArray());
  assert.ok(Math.abs(delta(frame(-.0001).heading - frame(.0001).heading, Math.PI * 2)) < .02);
  assert.ok(frame(.58).y > frame(0).y + 5);
  const s = .1;
  assert.ok(Math.abs(point(s, WIDTH / 2).y - point(s, -WIDTH / 2).y) > .1);
});

test('holding brake while turning charges a boost, and releasing it accelerates', () => {
  const kart = grid(0);
  kart.speed = 34;
  for (let i = 0; i < 36; i++) drive(kart, { steer: .8, brake: true, gas: true }, 1 / 60);
  assert.ok(kart.drift > .34);
  const before = kart.speed;
  drive(kart, { steer: .15, brake: false, gas: true }, 1 / 60);
  assert.ok(kart.boost > .6);
  assert.ok(kart.speed > before);
  assert.equal(kart.drift, 0);
});

test('a boost accelerates a coasting kart without throttle', () => {
  const kart = grid(0);
  kart.speed = 35;
  const coast = { steer: 0, brake: false, gas: false };
  drive(kart, coast, 1 / 60);
  assert.ok(kart.speed < 35);
  const before = kart.speed;
  kart.boost = 1;
  drive(kart, coast, 1 / 60);
  assert.ok(kart.speed > before);
});

test('boost pads work only within their lane and the wall costs speed', () => {
  const pad = PADS[0], kart = grid(0);
  const approach = pad.s - (PAD_LENGTH / 2 + .1) / LENGTH;
  Object.assign(kart, { s: approach, lane: pad.lane, speed: 42 });
  drive(kart, { steer: 0, brake: false, gas: true }, 1 / 60);
  assert.ok(kart.boost > 1);
  Object.assign(kart, { s: approach, lane: 7.1, speed: 42, boost: 0, steer: 1 });
  drive(kart, { steer: 1, brake: false, gas: true }, 1 / 60);
  assert.equal(kart.boost, 0);
  assert.ok(kart.lane <= WIDTH / 2 - .85);
  assert.ok(kart.speed < 42);
});

test('a boost pad triggers on side entry past its center but not beyond its trailing edge', () => {
  const pad = PADS[0], kart = grid(0);
  const input = { steer: 1, brake: false, gas: true };
  const side = { lane: pad.lane - PAD_WIDTH / 2 - .02, speed: 32, steer: 1, yaw: .08 };
  Object.assign(kart, side, { s: pad.s + .5 / LENGTH });
  drive(kart, input, 1 / 60);
  const entering = kart.boost;
  assert.ok(entering > 1);
  drive(kart, input, 1 / 60);
  assert.ok(kart.boost < entering);
  Object.assign(kart, side, { s: pad.s + (PAD_LENGTH / 2 + .1) / LENGTH, boost: 0 });
  drive(kart, input, 1 / 60);
  assert.equal(kart.boost, 0);
});

test('throttle with a fixed heading changes lanes but does not complete a lap', () => {
  const kart = grid(0);
  const before = frame(kart.s).heading;
  for (let i = 0; i < 45; i++) drive(kart, gas, dt);
  assert.ok(Math.abs(delta(frame(kart.s).heading + kart.yaw - before, 2 * Math.PI)) < 1e-6);
  for (let i = 45; i < LIMIT / (dt * 1000); i++) {
    drive(kart, gas, dt);
    assert.ok(kart.s < 1);
  }
});

test('a shallow drift glances off a barrier while retaining most speed', () => {
  const border = WIDTH / 2 - .85;
  const kart = Object.assign(grid(0), { s: 0, lane: border - .01, yaw: .12, slipAngle: .04, steer: .3, speed: TOP_SPEED });
  const drift = { ...gas, brake: true, steer: .3 };
  drive(kart, drift, dt);
  assert.equal(kart.lane, border);
  assert.ok(kart.speed > TOP_SPEED * .9 && kart.speed < TOP_SPEED);
  drive(kart, drift, dt);
  assert.ok(kart.lane < border);
  assert.ok(kart.speed > TOP_SPEED * .9);
});

test('successive drift boosts refresh the timer without stacking speed or duration', () => {
  const kart = grid(0);
  kart.speed = TOP_SPEED;
  for (let i = 0; i < 5; i++) {
    Object.assign(kart, { drift: 1, brakeHeld: true });
    for (let j = 0; j < 32; j++) {
      drive(kart, { ...gas, steer: centerSteer(kart) }, dt);
      assert.ok(kart.speed <= BOOST_SPEED && kart.boost <= 1.47);
    }
  }
  assert.equal(kart.speed, BOOST_SPEED);
});

test('a rear-end bump separates both karts and transfers speed to the leading kart', () => {
  const rear = Object.assign(grid(0), { s: -.8 / LENGTH, lane: 0, speed: 38 });
  const lead = Object.assign(grid(1), { s: .8 / LENGTH, lane: 0, speed: 24 });
  bump(rear, lead);
  assert.ok(point(rear.s, rear.lane).distanceTo(point(lead.s, lead.lane)) > 2.6);
  assert.ok(rear.speed > 24 && rear.speed < 38);
  assert.ok(lead.speed > rear.speed && lead.speed < 38);
  const speeds = [rear.speed, lead.speed];
  bump(rear, lead);
  assert.deepEqual([rear.speed, lead.speed], speeds);
});

test('an online kart bumps away from a remote snapshot without changing it', () => {
  const local = Object.assign(grid(0), { s: 0, lane: -.85, yaw: .3, speed: 38 });
  const remote = pose(Object.assign(grid(1), { s: 0, lane: .85, speed: 38 }));
  const before = [...remote];
  bump(local, remote);
  assert.deepEqual(remote, before);
  assert.ok(local.lane < -1.5);
  assert.ok(local.slipAngle < -.3);
  assert.ok(local.speed > 34);
});

test('room judges from the ordered checkpoints and rejects implausible poses', () => {
  const d = driver('a', 'Test', 0);
  assert.ok(validPose(d.pose));
  assert.equal(validPose([0, NaN, 0, 56, 0, 0]), false);
  assert.equal(advance(d, [1, 0, 0, 42, 0, 0], 60, .06), false);
  const k = grid(0);
  let frames = 0;
  while (k.s < LAPS && frames++ < 10_800) {
    const steer = centerSteer(k);
    drive(k, { steer, brake: false, gas: true }, 1 / 60);
    if (frames % 4 === 0 || k.s >= LAPS) {
      const p = pose(k);
      p[0] = Math.min(p[0], LAPS);
      assert.ok(validPose(p));
      assert.ok(advance(d, p, frames * 1000 / 60, 4 / 60));
    }
  }
  assert.equal(d.checkpoint, LAPS * SECTORS);
  assert.ok(d.finish !== null && d.finish > 3 * LENGTH / 56 * 1000);
  assert.equal(advance(d, d.pose, frames * 1000 / 60 + 10, .06), false);
  const other = driver('b', 'Second', 1);
  other.finish = d.finish + 10;
  assert.deepEqual(rank([other, d, driver('c', 'DNF', 2)]).map(p => p.id), ['a', 'b', 'c']);
});

test('the server accepts backward travel without losing earned checkpoints', () => {
  const d = driver('a', 'Test', 0);
  d.pose[0] = .251;
  d.checkpoint = 1;
  const back: typeof d.pose = [.249, 0, 3.1416, 25, 0, 0];
  assert.ok(validPose(back));
  assert.ok(advance(d, back, 7000, .08));
  assert.equal(d.pose[0], .249);
  assert.equal(d.checkpoint, 1);
  assert.equal(advance(d, [-1, 0, 0, 42, 0, 0], 7060, .06), false);
});

test('a delayed pose credits each checkpoint through the finish line', () => {
  const d = driver('a', 'Test', 0);
  const beforeTwoCrossings = 1 / SECTORS - .01;
  const afterTwoCrossings = 2 / SECTORS + .01;
  const timeFor = (distance: number) => distance * LENGTH / 45;
  assert.ok(advance(d, [beforeTwoCrossings, 0, 0, 45, 0, 0], 5000, timeFor(beforeTwoCrossings - d.pose[0])));
  assert.equal(d.checkpoint, 0);
  assert.ok(advance(d, [afterTwoCrossings, 0, 0, 45, 0, 0], 10000, timeFor(afterTwoCrossings - beforeTwoCrossings)));
  assert.equal(d.checkpoint, 2);
  assert.equal(d.finish, null);
  assert.ok(advance(d, [LAPS, 0, 0, 45, 0, 0], 70000, timeFor(LAPS - afterTwoCrossings)));
  assert.equal(d.checkpoint, LAPS * SECTORS);
  assert.equal(d.finish, 70000);
});
