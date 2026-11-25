import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BotPilot, DIFFICULTIES, LocalRace, MAX_RACERS } from '../src/bots';
import { LAPS, LIMIT, RED_BASIN, SECTORS, WIDTH, clamp, getTrack } from '../src/circuit';
import { drive, grid } from '../src/drive';
import { driver, rank, validPose } from '../src/rules';
import { TRACK_IDS } from '../src/tracks';

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

test('all difficulties finish every track, with Hard recording the quickest lap times', () => {
  for (const id of TRACK_IDS) {
    const track = getTrack(id);
    const times = DIFFICULTIES.map(level => {
      const race = new LocalRace(2, 0, track, undefined, level);
      const [bot] = race.room.drivers;
      for (let elapsed = dt * 1000; elapsed < LIMIT && bot.finish === null; elapsed += dt * 1000) {
        race.step(idle, dt, elapsed);
      }
      assert.ok(bot.finish !== null, `${id}/${level} did not finish`);
      assert.equal(bot.checkpoint, LAPS * SECTORS);
      return bot.finish / LAPS;
    });
    assert.ok(times[2] < times[1] && times[1] < times[0], `${id}: ${times}`);
  }
});

test('a Hard bot earns corner drift boosts without any boost pads', () => {
  const track = { ...RED_BASIN, pads: [] };
  const race = new LocalRace(2, 0, track, undefined, 'Hard');
  const [bot] = race.room.drivers;
  let charged = false, boosted = false;
  for (let elapsed = dt * 1000; elapsed < LIMIT && bot.pose[0] < 1; elapsed += dt * 1000) {
    race.step(idle, dt, elapsed);
    charged ||= bot.pose[4] > .34;
    boosted ||= bot.pose[5] > 0;
  }
  assert.ok(charged);
  assert.ok(boosted);
});

test('a bot picks a clear side, then passes a slower kart without contact', () => {
  const track = RED_BASIN;
  const kart = { ...grid(0, track), s: .31, lane: 0, speed: 38 };
  const opponent = driver('lead', 'Lead', 1, track);
  opponent.pose = [kart.s + 17 / track.length, 0, 0, 24, 0, 0];
  const pilot = new BotPilot(track, 0, 'Hard');
  let alongside = false;
  for (let elapsed = dt * 1000; elapsed < 5000 && kart.s < opponent.pose[0] + 5 / track.length; elapsed += dt * 1000) {
    drive(kart, pilot.input(kart, elapsed, [opponent]), dt, track);
    opponent.pose[0] += opponent.pose[3] * dt / track.length;
    if (Math.abs(kart.s - opponent.pose[0]) * track.length < 2) {
      alongside = true;
      assert.ok(Math.abs(kart.lane - opponent.pose[1]) > 1.6);
    }
  }
  assert.ok(alongside);
  assert.ok(kart.s > opponent.pose[0]);
});

test('Hard defends earlier against a closing rival but does not cut off a kart alongside', () => {
  const track = RED_BASIN;
  const kart = { ...grid(0, track), s: .015, lane: 0, speed: 33 };
  const rival = driver('chaser', 'Chaser', 1, track);
  rival.pose = [kart.s - 16 / track.length, 2.7, 0, 43, 0, 0];
  const open = new BotPilot(track, 0, 'Hard').input(kart, 5000, []);
  const defend = new BotPilot(track, 0, 'Hard').input(kart, 5000, [rival]);
  const adjacent = driver('adjacent', 'Adjacent', 2, track);
  adjacent.pose = [kart.s, 1.8, 0, 33, 0, 0];
  const occupied = new BotPilot(track, 0, 'Hard').input(kart, 5000, [rival, adjacent]);
  assert.ok(defend.steer > open.steer + .25);
  assert.ok(occupied.steer < defend.steer - .25);
});
