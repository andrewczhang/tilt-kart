import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getTrack } from '../src/circuit';
import { BOOST_SPEED, drive, MAX_BOOST_SPEED, type Pose } from '../src/drive';
import { newDriverId } from '../src/driver-id';
import { decodeGhost, encodeGhost, ghostPose, ghostTimeAt, GHOST_INTERVAL, MAX_LAP_MS } from '../src/ghost';
import { TimeTrial } from '../src/time-trial';
import { courseLayoutKey, TRACK_IDS } from '../src/tracks';
import { timeTrialRequest, validSubmission } from '../worker/time-trial';
import { centerSteer } from './steering';

const input = { gas: true, steer: 0, brake: false };
const uuid = '00000000-0000-4000-8000-000000000000';

function runLap(id = TRACK_IDS[0]) {
  const trial = new TimeTrial(getTrack(id), 0);
  trial.step(input, trial.start - 1);
  assert.equal(trial.kart.s, 0);
  for (let t = trial.start + 16; !trial.finished; t += 16) {
    trial.step({ ...input, steer: centerSteer(trial.kart, trial.track) }, t);
  }
  assert.ok(trial.replay);
  return trial.replay;
}

test('replays round trip quantized poses and interpolate a partial final interval', () => {
  const poses: Pose[] = [
    [0, -.14, -.04, 30.14, .01, .77],
    [.6, -.1, 0, 25, .021, .6],
    [1, .1, .1, 23, .04, .57],
  ];
  const encoded = encodeGhost(poses);
  assert.equal(encoded.length, 48);
  const ghost = decodeGhost(75, encoded);
  assert.ok(ghost);
  assert.deepEqual(ghost.poses, poses);
  assert.equal(ghostPose(ghost, 62.5)[0], .8);
  assert.ok(Math.abs(ghostTimeAt(ghost, .8) - 62.5) < .0001);
  assert.deepEqual(ghostPose(ghost, 100), poses[2]);
  assert.equal(decodeGhost(101, encoded), null);
  assert.equal(decodeGhost(75, '!' + encoded.slice(1)), null);
});

test('every track produces a server-valid flying lap with the real driving model', () => {
  for (const id of TRACK_IDS) {
    const replay = runLap(id);
    assert.deepEqual(validSubmission({ ...replay, name: '  Driver  ', driverId: uuid }, id), {
      ...replay, name: 'Driver', driverId: uuid,
    }, id);
  }
});

test('accepts a Twin Mesa replay that steers hard across the jump', () => {
  const trial = new TimeTrial(getTrack('mesa'), 0);
  for (let t = trial.start + 16; !trial.finished; t += 16) {
    const { s } = trial.kart;
    const brake = s >= .4322 && s < .4584;
    const steer = brake ? .375 : s >= .4634 && s < .4811 ? -1 : centerSteer(trial.kart, trial.track);
    trial.step({ ...input, brake, steer }, t);
  }
  assert.ok(trial.replay);
  const submission = { ...trial.replay, name: 'Driver', driverId: uuid };
  assert.deepEqual(validSubmission(submission, trial.track.id), submission);
});

test('a time trial can submit a UUID generated without crypto.randomUUID', () => {
  const driverId = newDriverId({ getRandomValues: crypto.getRandomValues.bind(crypto) });
  assert.ok(validSubmission({ ...runLap(), name: 'LAN Driver', driverId }, TRACK_IDS[0]));
});

test('drift release keeps the standard boost speed cap in time trials', () => {
  const track = getTrack();
  const trial = new TimeTrial(track, 0);
  Object.assign(trial.kart, { speed: BOOST_SPEED, drift: 1, brakeHeld: true });
  const racer = { ...trial.kart, speed: 56, turbo: 1.95 };
  drive(racer, input, .016, track);
  trial.step(input, trial.start + 16);
  assert.ok(trial.kart.boost > 1.45);
  assert.equal(trial.kart.speed, BOOST_SPEED);
  assert.ok(racer.speed > MAX_BOOST_SPEED);
});

test('runs time out at the wall-clock limit without a replay', () => {
  const trial = new TimeTrial(getTrack(), 0);
  for (let t = trial.start + 50; !trial.finished && t <= trial.start + MAX_LAP_MS + 50; t += 50) {
    trial.step({ ...input, gas: false }, t);
  }
  assert.equal(trial.elapsed, MAX_LAP_MS);
  assert.equal(trial.finished, true);
  assert.equal(trial.replay, undefined);
});

test('Frostline Pass uses wall time and the same replay at 60 and 15 FPS', () => {
  const track = getTrack('frostline');
  const regular = new TimeTrial(track, 17_321);
  const slowFrames = new TimeTrial(track, 17_321);
  let controls = input;
  let wall = 0;
  for (let i = 0; !slowFrames.finished; i++) {
    const now = regular.start + i * 1000 / 60;
    wall = now - regular.start;
    assert.ok(wall <= MAX_LAP_MS);
    if (i % 4 === 0) controls = { ...input, steer: centerSteer(slowFrames.kart, track) };
    regular.step(controls, now);
    if (i % 4 === 0) {
      slowFrames.step(controls, now);
      if (!slowFrames.finished) assert.equal(slowFrames.elapsed, wall);
      assert.equal(slowFrames.kart.s, regular.kart.s);
    }
  }
  assert.ok(regular.replay);
  assert.deepEqual(slowFrames.replay, regular.replay);
  assert.ok(regular.replay.lapMs <= wall && regular.replay.lapMs > wall - 1000 / 15 - 10);
  assert.ok(validSubmission({ ...slowFrames.replay, name: 'Driver', driverId: uuid }, track.id));
});

test('a frame gap longer than one second interrupts the lap without creating a replay', () => {
  const trial = new TimeTrial(getTrack(), 0);
  trial.step(input, trial.start + 800);
  assert.equal(trial.elapsed, 800);
  assert.ok(trial.kart.s > 0);
  trial.step(input, trial.start + 1801);
  assert.equal(trial.interrupted, true);
  assert.equal(trial.finished, true);
  assert.equal(trial.replay, undefined);
});

test('rejects implausible or malformed submissions', () => {
  const id = TRACK_IDS[0];
  const replay = runLap(id);
  const good = { ...replay, name: 'Driver', driverId: uuid };
  const decoded = decodeGhost(replay.lapMs, replay.ghost)!;
  decoded.poses[1][0] = .5;
  for (const bad of [
    null, { ...good, name: '   ' }, { ...good, name: 'ab'.repeat(11) }, { ...good, driverId: '' },
    { ...good, lapMs: 1000 }, { ...good, lapMs: replay.lapMs + 100 },
    { ...good, lapMs: MAX_LAP_MS + 1 }, { ...good, ghost: encodeGhost(decoded.poses) },
  ]) assert.equal(validSubmission(bad, id), null);
  const jumped = decodeGhost(replay.lapMs, replay.ghost)!;
  const split = Math.floor(jumped.poses.length / 2);
  for (let i = split; i < jumped.poses.length - 1; i++) {
    jumped.poses[i][0] = .2 + .8 * jumped.poses[i][0];
  }
  assert.equal(validSubmission({ ...good, ghost: encodeGhost(jumped.poses) }, id), null);
});

test('rejects a large request without a Content-Length before touching D1', async () => {
  const req = new Request('https://example.test/api/tt', {
    method: 'POST',
    body: JSON.stringify({ ghost: 'A'.repeat(100_000) }),
  });
  assert.equal(req.headers.has('Content-Length'), false);
  assert.equal((await timeTrialRequest(req, {} as D1Database, TRACK_IDS[0])).status, 400);
});

test('time trial reads, writes, and ranks all use the current layout key', async () => {
  const track = TRACK_IDS[0];
  const bindings: unknown[][] = [];
  const db = {
    prepare() {
      return {
        bind(...values: unknown[]) {
          bindings.push(values);
          return { all: async () => ({ results: [] }), first: async () => null };
        },
      };
    },
    batch: async () => [null, { results: [{ rank: 1 }] }],
  } as unknown as D1Database;
  const url = `https://example.test/api/tt/${courseLayoutKey(track)}`;
  await timeTrialRequest(new Request(`${url}/leaderboard`), db, track, 'leaderboard');
  await timeTrialRequest(new Request(`${url}/ghost`), db, track, 'ghost');
  await timeTrialRequest(new Request(url, {
    method: 'POST',
    body: JSON.stringify({ ...runLap(track), name: 'Driver', driverId: uuid }),
  }), db, track);
  assert.deepEqual(bindings.map(([key]) => key), Array(4).fill(`${track}-v2`));
});

test('rejects a lap and a single sample that exceed the boosted distance limit', () => {
  const track = getTrack();
  const lapAt = (speed: number) => Math.ceil(track.length / speed * 1000 / GHOST_INTERVAL) * GHOST_INTERVAL;
  const submission = (lapMs: number, firstStep = 0) => {
    const intervals = lapMs / GHOST_INTERVAL;
    const poses = Array.from({ length: intervals + 1 }, (_, i): Pose => {
      const s = firstStep && i ? firstStep + (1 - firstStep) * (i - 1) / (intervals - 1) : i / intervals;
      return [s, 0, 0, MAX_BOOST_SPEED, 0, 1];
    });
    return { lapMs, name: 'Driver', driverId: uuid, ghost: encodeGhost(poses) };
  };
  assert.equal(validSubmission(submission(lapAt(60)), track.id), null);
  const legalTime = lapAt(50);
  assert.ok(validSubmission(submission(legalTime), track.id));
  assert.equal(validSubmission(submission(legalTime, 60 * GHOST_INTERVAL / 1000 / track.length), track.id), null);
});
