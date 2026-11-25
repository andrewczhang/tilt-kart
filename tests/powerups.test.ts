import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getTrack, LENGTH, WIDTH } from '../src/circuit';
import { drive, grid, pose } from '../src/drive';
import {
  BOX_RESPAWN,
  BOX_SPOTS,
  PowerupState,
  ROULETTE_TIME,
  STAR_DURATION,
  rollPowerup,
  validItemEvent,
  type ItemEvent
} from '../src/powerups';
import { advance, driver, validPose } from '../src/rules';

test('a 15 fps turbo frame picks up a box crossed between its endpoints', () => {
  const state = new PowerupState();
  const box = state.boxes[0];
  state.boxes[1].cooldown = 1;
  const before = { s: box.s - 2.6 / LENGTH, lane: box.lane + .6 };
  const kart = { ...grid(0), s: box.s + .9 / LENGTH, lane: box.lane + 2.2, speed: 60 };
  const events: ItemEvent[] = [];
  state.step(1 / 15, 'p1', kart, [], 1, 1, true, { emit: event => events.push(event) }, () => .1, undefined, before);
  assert.deepEqual(events, [{ kind: 'pickup', box: box.id }]);
});

test('driving through an item box starts the roulette, awards an item, and respawns after cooldown', () => {
  const state = new PowerupState();
  const kart = grid(0);
  const spot = BOX_SPOTS[0];
  kart.s = spot.s;
  kart.lane = spot.lane;
  const events: ItemEvent[] = [];
  const sounds: string[] = [];

  state.step(1 / 60, 'p1', kart, [{ id: 'p1', name: 'P1', slot: 0, pose: pose(kart) }], 1, 1, true, {
    emit: e => events.push(e),
    sfx: s => sounds.push(s)
  }, () => 0.1);

  assert.equal(events.length, 1);
  assert.deepEqual(events[0], { kind: 'pickup', box: 0 });
  assert.ok(state.boxes[0].cooldown > BOX_RESPAWN - 0.1);
  assert.ok(state.rolling !== null);
  assert.equal(state.held, null);
  assert.ok(sounds.includes('pickup'));

  // Advance past roulette duration
  kart.s = spot.s + 0.05;
  for (let i = 0; i < 60; i++) {
    state.step(ROULETTE_TIME / 50, 'p1', kart, [{ id: 'p1', name: 'P1', slot: 0, pose: pose(kart) }], 1, 1, true, {
      sfx: s => sounds.push(s)
    });
  }
  assert.equal(state.rolling, null);
  assert.ok(state.held !== null);
  assert.ok(sounds.includes('ready'));

  // Advance past box respawn cooldown
  state.step(BOX_RESPAWN, 'p1', kart, [{ id: 'p1', name: 'P1', slot: 0, pose: pose(kart) }], 1, 1, true);
  assert.equal(state.boxes[0].cooldown, 0);
});

test('power-up odds rubber-band by race position and allow all items in solo', () => {
  // 1st place in multiplayer never rolls star or homing
  for (let r = 0; r < 1; r += 0.02) {
    const item = rollPowerup(1, 6, false, () => r);
    assert.ok(item === 'banana' || item === 'turbo' || item === 'shell');
  }
  // Last place in multiplayer can roll star and homing
  const backItems = new Set<string>();
  for (let r = 0; r < 1; r += 0.02) backItems.add(rollPowerup(6, 6, false, () => r));
  assert.ok(backItems.has('star'));
  assert.ok(backItems.has('homing'));
  // Solo can roll all 5 items
  const soloItems = new Set<string>();
  for (let r = 0; r < 1; r += 0.02) soloItems.add(rollPowerup(1, 1, true, () => r));
  assert.equal(soloItems.size, 5);
});

test('turbo boost accelerates past normal top speed and remains valid in server rules', () => {
  const state = new PowerupState();
  const kart = grid(0);
  kart.s = 0.05;
  kart.speed = 42;
  state.held = 'turbo';

  const used = state.useItem('p1', kart, [{ id: 'p1', name: 'P1', slot: 0, pose: pose(kart) }]);
  assert.equal(used, 'turbo');
  assert.equal(state.held, null);
  assert.ok(kart.boost >= 1.9);
  assert.ok(kart.speed >= 54);

  const d = driver('p1', 'P1', 0);
  d.pose = pose(kart);
  for (let i = 0; i < 20; i++) drive(kart, { steer: 0, brake: false, gas: true }, 1 / 60);
  const p = pose(kart);
  assert.ok(p[3] > 56 && p[3] <= 62);
  assert.ok(validPose(p));
  assert.ok(advance(d, p, 5000, 20 / 60));
});

test('turbo, star, and item hits carry their speed effects through landing', () => {
  const track = getTrack('saltwater');
  const { start, end } = track.jumps![0];
  const initial = (start + end) / 2, dt = 1 / 60;
  const landing = (kart: ReturnType<typeof grid>) => {
    let frames = 0;
    while (track.gapAt(kart.s) && frames < 60) {
      drive(kart, { steer: 0, brake: false, gas: true }, dt, track);
      frames++;
    }
    assert.ok(kart.s >= end - 1e-10);
    return frames;
  };
  const normal = Object.assign(grid(0, track), { s: initial, lane: 0, speed: 42 });
  const airtime = landing(normal);
  for (const item of ['turbo', 'star'] as const) {
    const state = new PowerupState();
    const kart = Object.assign(grid(0, track), { s: initial, lane: 0, speed: 42 });
    state.held = item;
    assert.equal(state.useItem('p1', kart, [], {}, track), item);
    assert.equal(landing(kart), airtime);
    assert.ok(kart.speed > normal.speed + 8, item);
    drive(kart, { steer: 0, brake: false, gas: true }, dt, track);
    assert.ok(kart.speed > 50, item);
  }
  const state = new PowerupState();
  const hit = Object.assign(grid(0, track), { s: initial, lane: 0, speed: 42 });
  state.hazards.push({ id: 'peel', owner: 'p2', kind: 'banana', s: initial, lane: 0, age: 1, ttl: 20 });
  state.step(dt, 'p1', hit, [], 1, 2, false, {}, Math.random, track);
  assert.ok(hit.spin > 0 && hit.speed <= 14);
  assert.equal(landing(hit), airtime);
  assert.ok(hit.speed <= 14);
});

test('banana peel spins out a kart that drives over it unless starred', () => {
  const state = new PowerupState();
  const dropper = grid(0);
  dropper.s = 0.2;
  dropper.lane = 1.5;
  state.held = 'banana';
  const emitted: ItemEvent[] = [];
  state.useItem('p1', dropper, [], { emit: e => emitted.push(e) });
  assert.equal(state.hazards.length, 1);
  assert.equal(emitted[0]?.kind, 'drop');

  // Another kart hits the banana
  const victim = grid(1);
  victim.s = state.hazards[0].s;
  victim.lane = state.hazards[0].lane;
  victim.speed = 40;
  victim.boost = 1.0;
  state.step(1 / 60, 'p2', victim, [{ id: 'p2', name: 'P2', slot: 1, pose: pose(victim) }], 2, 2, false);
  assert.equal(state.hazards.length, 0);
  assert.ok(victim.spin > 0.9);
  assert.equal(victim.boost, 0);
  assert.ok(victim.speed <= 14);

  // During spin, drive slows the kart down
  const beforeSpinSpeed = victim.speed;
  drive(victim, { steer: 1, brake: false, gas: true }, 0.1);
  assert.ok(victim.speed < beforeSpinSpeed);

  // Starred kart is immune to banana
  state.hazards.push({ id: 'b2', owner: 'p1', kind: 'banana', s: 0.3, lane: 0, age: 1, ttl: 20 });
  const starred = grid(2);
  starred.s = 0.3;
  starred.lane = 0;
  starred.star = STAR_DURATION;
  starred.speed = 58;
  state.step(1 / 60, 'p3', starred, [{ id: 'p3', name: 'P3', slot: 2, pose: pose(starred) }], 1, 3, false);
  assert.equal(starred.spin, 0);
  assert.equal(state.hazards.length, 0);
});

test('green shell bounces off track walls and red homing shell steers toward the leader ahead', () => {
  const state = new PowerupState();
  const shooter = grid(0);
  shooter.s = 0.25;
  shooter.lane = WIDTH / 2 - 1.2;
  shooter.steer = 1;
  state.held = 'shell';
  state.useItem('p1', shooter, []);
  assert.equal(state.projectiles.length, 1);
  const initialLaneVel = state.projectiles[0].laneVel;
  assert.ok(initialLaneVel > 0);

  // Step until wall bounce
  for (let i = 0; i < 15; i++) {
    state.step(1 / 30, 'p1', shooter, [{ id: 'p1', name: 'P1', slot: 0, pose: pose(shooter) }], 2, 2, false);
  }
  assert.ok(state.projectiles[0].laneVel < 0);

  // Red homing shell locks onto leader ahead
  const leader = grid(1);
  leader.s = 0.35;
  leader.lane = -3.8;
  shooter.s = 0.30;
  shooter.lane = 3.2;
  state.held = 'homing';
  const actors = [
    { id: 'p1', name: 'P1', slot: 0, pose: pose(shooter) },
    { id: 'p2', name: 'P2', slot: 1, pose: pose(leader) }
  ];
  state.useItem('p1', shooter, actors);
  const homing = state.projectiles.find(p => p.kind === 'homing')!;
  assert.equal(homing.target, 'p2');
  const startLane = homing.lane;
  for (let i = 0; i < 15; i++) state.step(1 / 30, 'p1', shooter, actors, 2, 2, false);
  assert.ok(homing.lane < startLane - 1);
});

test('item event validation and remote sync work for multiplayer rooms', () => {
  assert.equal(validItemEvent({ kind: 'pickup', box: 0 }), true);
  assert.equal(validItemEvent({ kind: 'pickup', box: 999 }), false);
  assert.equal(validItemEvent({ kind: 'drop', item: 'banana', hid: 'b1', s: 0.4, lane: 1.2 }), true);
  assert.equal(validItemEvent({ kind: 'drop', item: 'banana', hid: 'bad id!', s: 0.4, lane: 1.2 }), false);
  assert.equal(validItemEvent({ kind: 'fire', item: 'homing', hid: 's1', s: 0.5, lane: 0, laneVel: 0, target: 'p2' }), true);
  assert.equal(validItemEvent({ kind: 'star' }), true);
  assert.equal(validItemEvent({ kind: 'hit', target: 'p2', hid: 's1', item: 'homing' }), true);

  const remote = new PowerupState();
  remote.applyRemote('p1', { kind: 'drop', item: 'banana', hid: 'b9', s: 0.5, lane: 0 });
  assert.equal(remote.hazards.length, 1);
  remote.applyRemote('p1', { kind: 'star' });
  assert.ok(remote.fxOf('p1').star > 5);
  remote.applyRemote('p2', { kind: 'hit', target: 'p2', hid: 'b9', item: 'banana' });
  assert.equal(remote.hazards.length, 0);
  assert.ok(remote.fxOf('p2').spin > 1);
});

test('starred opponent bumps local kart into a spin-out', () => {
  const state = new PowerupState();
  state.applyRemote('p2', { kind: 'star' });
  const local = grid(0);
  local.s = 0.4;
  local.lane = 0;
  local.speed = 40;
  const rival = grid(1);
  rival.s = 0.4 + 1 / LENGTH;
  rival.lane = 0.5;
  state.step(1 / 60, 'p1', local, [
    { id: 'p1', name: 'P1', slot: 0, pose: pose(local) },
    { id: 'p2', name: 'P2', slot: 1, pose: pose(rival) }
  ], 1, 2, false);
  assert.ok(local.spin > 1);
});

test('a starred kart spins out a bot on side contact inside the bump radius', () => {
  const state = new PowerupState();
  const kart = { ...grid(0), s: .4, lane: 0, star: STAR_DURATION };
  const bot = { ...grid(1), s: kart.s, lane: 2.2 };
  const hits: string[] = [];
  state.step(1 / 60, 'p1', kart, [
    { id: 'bot', name: 'Bot', slot: 1, pose: pose(bot) }
  ], 1, 2, false, { onActorHit: id => hits.push(id) });
  assert.deepEqual(hits, ['bot']);
});

test('fresh peels hit pursuing bots, spin-outs preserve held items, and homing skips finished racers', () => {
  const state = new PowerupState();
  const player = grid(0);
  player.s = 0.3;
  player.lane = 0;
  state.held = 'banana';
  state.useItem('p1', player, []);

  // Pursuing bot hits fresh peel immediately (< 0.65s)
  const bot = grid(1);
  bot.s = state.hazards[0].s;
  bot.lane = state.hazards[0].lane;
  const hitBots: string[] = [];
  state.step(1 / 60, 'p1', player, [
    { id: 'p1', name: 'P1', slot: 0, pose: pose(player), finish: null },
    { id: 'bot-0', name: 'Comet (bot)', slot: 1, pose: pose(bot), finish: null }
  ], 1, 2, false, { onActorHit: id => hitBots.push(id) });
  assert.deepEqual(hitBots, ['bot-0']);

  // Holding turbo while spinning out does not waste the item
  state.held = 'turbo';
  player.spin = 0.8;
  assert.equal(state.useItem('p1', player, []), null);
  assert.equal(state.held, 'turbo');
  player.spin = 0;

  // Homing shell ignores finished racer and targets active racer ahead
  const finished = grid(1);
  finished.s = 0.33;
  const active = grid(2);
  active.s = 0.38;
  state.held = 'homing';
  state.useItem('p1', player, [
    { id: 'p1', name: 'P1', slot: 0, pose: pose(player), finish: null },
    { id: 'bot-0', name: 'Finished', slot: 1, pose: pose(finished), finish: 95000 },
    { id: 'bot-1', name: 'Active', slot: 2, pose: pose(active), finish: null }
  ]);
  assert.equal(state.projectiles[0].target, 'bot-1');
});

test('spectator stepping advances projectiles, box cooldowns, and effects', () => {
  const state = new PowerupState();
  state.applyRemote('p1', { kind: 'pickup', box: 0 });
  state.applyRemote('p1', { kind: 'star' });
  state.applyRemote('p1', { kind: 'fire', item: 'shell', hid: 's1', s: 0.2, lane: 0, laneVel: 2 });
  const initialS = state.projectiles[0].s;
  state.stepSpectator(0.5, []);
  assert.ok(state.projectiles[0].s > initialS);
  assert.ok(state.boxes[0].cooldown < 6);
  assert.ok(state.fxOf('p1').star < 5.5);
});

test('the same player peel spins an unprotected bot like a human but cannot hurt a starred bot', () => {
  for (const victimId of ['human', 'bot-0']) {
    for (const star of [0, 3]) {
      const state = new PowerupState();
      const victim = { ...grid(1), s: .4, lane: 0, star, speed: 40, boost: 1, turbo: 1, drift: .5 };
      const attacker = { ...grid(0), s: .4 + 3.2 / LENGTH, lane: 0 };
      state.held = 'banana';
      state.useItem('attacker', attacker, []);
      const botVictim = victimId === 'bot-0';
      const player = botVictim ? attacker : victim;
      state.step(1 / 60, botVictim ? 'attacker' : victimId, player, [], 1, 2, false, {}, () => 0,
        undefined, undefined, { playerActive: true, bots: botVictim ? [{ id: victimId, kart: victim, place: 2 }] : [] });
      assert.equal(state.hazards.length, 0);
      assert.deepEqual([victim.spin, victim.speed, victim.boost, victim.turbo, victim.drift], star ? [0, 40, 1, 1, .5] : [1.15, 14, 0, 0, 0]);
      assert.equal(state.fxOf(victimId).star, star);
      assert.equal(state.fxOf(victimId).spin, victim.spin);
    }
  }
});

test('a starred bot bumps the player and other bots but not another starred kart', () => {
  const state = new PowerupState();
  const player = { ...grid(0), s: .4, lane: 0, speed: 38 };
  const star = { ...player, star: 3 };
  const bot = { ...player, lane: .5 };
  const protectedBot = { ...player, lane: -.5, star: 2 };
  const bots = [star, bot, protectedBot].map((kart, i) => ({ id: `bot-${i}`, kart, place: i + 2 }));
  state.step(1 / 60, 'player', player, [], 1, 4, false, {}, () => 0, undefined, undefined, { playerActive: true, bots });
  assert.equal(player.spin, 1.15);
  assert.equal(bot.spin, 1.15);
  assert.equal(star.spin, 0);
  assert.equal(protectedBot.spin, 0);
  assert.equal(state.banner?.text, 'BUMPED BY STAR');
});
