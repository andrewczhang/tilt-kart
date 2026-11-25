import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LocalRace, MAX_RACERS } from '../src/bots';
import { LAPS, LIMIT, SECTORS, WIDTH, clamp } from '../src/circuit';
import { rank, validPose } from '../src/rules';

const idle = { gas: false, brake: false, steer: 0 };
const dt = 1 / 60;

test('a full local grid waits for the countdown, then bots drive distinct lines and finish', () => {
  const race = new LocalRace(MAX_RACERS, 3500);
  const bots = race.room.drivers.filter(entry => entry !== race.human);
  assert.equal(bots.length, 7);
  assert.equal(new Set(race.room.drivers.map(entry => entry.slot)).size, MAX_RACERS);
  const grid = bots.map(bot => bot.pose);
  race.step(idle, dt, -50);
  assert.deepEqual(bots.map(bot => bot.pose), grid);

  let elapsed = 0;
  while (elapsed < 5000) {
    elapsed += dt * 1000;
    race.step(idle, dt, elapsed);
  }
  assert.ok(bots.every(bot => bot.pose[3] > 20));
  assert.ok(new Set(bots.map(bot => bot.pose[1])).size > 1);
  assert.ok(new Set(bots.map(bot => bot.pose[3])).size > 1);
  while (elapsed < LIMIT && bots.some(bot => bot.finish === null)) {
    elapsed += dt * 1000;
    race.step(idle, dt, elapsed);
    assert.ok(bots.every(bot => validPose(bot.pose) && Math.abs(bot.pose[1]) < WIDTH / 2 - .85));
  }
  assert.ok(bots.every(bot => bot.checkpoint === LAPS * SECTORS && bot.finish !== null));
  assert.equal(new Set(bots.map(bot => bot.finish)).size, bots.length);
  assert.equal(race.room.complete, false);
  assert.equal(rank(race.room.drivers).at(-1), race.human);

  assert.equal(race.step(idle, dt, LIMIT), true);
  assert.equal(race.room.complete, true);
  assert.equal(race.human.finish, null);
});

test('bots keep racing after the player finishes and results keep the player first', () => {
  const race = new LocalRace(2, 0);
  const bot = race.room.drivers[0];
  let elapsed = 0;
  while (elapsed < LIMIT && race.human.finish === null) {
    elapsed += dt * 1000;
    race.step({ gas: true, brake: false, steer: clamp(-race.kart.lane * .35, -1, 1) }, dt, elapsed);
  }
  const finish = race.human.finish;
  assert.ok(finish !== null);
  assert.equal(bot.finish, null);
  assert.equal(race.room.complete, false);
  while (elapsed < LIMIT && !race.room.complete) {
    elapsed += dt * 1000;
    race.step(idle, dt, elapsed);
  }
  assert.ok(bot.finish !== null && bot.finish > finish);
  assert.equal(race.human.finish, finish);
  assert.equal(race.room.complete, true);
  assert.deepEqual(rank(race.room.drivers), [race.human, bot]);
});
