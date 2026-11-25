import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LAPS, LENGTH, SECTORS, WIDTH, delta, frame, point } from '../src/circuit';
import { PADS, drive, grid, pose } from '../src/drive';
import { advance, driver, rank, validPose } from '../src/rules';

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

test('boost pads work only within their lane and the wall costs speed', () => {
  const pad = PADS[0], kart = grid(0);
  Object.assign(kart, { s: pad.s - .0001, lane: pad.lane, speed: 42 });
  drive(kart, { steer: 0, brake: false, gas: true }, 1 / 60);
  assert.ok(kart.boost > 1);
  Object.assign(kart, { s: pad.s - .0001, lane: 7.1, speed: 42, boost: 0, steer: 1 });
  drive(kart, { steer: 1, brake: false, gas: true }, 1 / 60);
  assert.equal(kart.boost, 0);
  assert.ok(kart.lane <= WIDTH / 2 - .85);
  assert.ok(kart.speed < 42);
});

test('room judges from the ordered checkpoints and rejects implausible poses', () => {
  const d = driver('a', 'Test', 0);
  assert.ok(validPose(d.pose));
  assert.equal(validPose([0, NaN, 0, 56, 0, 0]), false);
  assert.equal(advance(d, [1, 0, 0, 42, 0, 0], 60, .06), false);
  const k = grid(0);
  let frames = 0;
  while (k.s < LAPS && frames++ < 10_800) {
    const steer = Math.max(-1, Math.min(1, -k.lane * .35));
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
