import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LocalRace } from '../src/bots';
import { getTrack, LAPS, SECTORS, SAMPLES, delta } from '../src/circuit';
import { drive, grid, PAD_LENGTH, PAD_WIDTH, pose } from '../src/drive';
import { advance, checkpointAt, driver, validPose } from '../src/rules';
import { DEFAULT_TRACK, isTrackId, TRACK_IDS } from '../src/tracks';

test('eight circuits have separate drivable closed courses, checkpoints and pads', () => {
  assert.equal(getTrack().id, DEFAULT_TRACK);
  assert.equal(TRACK_IDS.length, 8);
  assert.equal(isTrackId('constructor'), false);
  assert.equal(new Set(TRACK_IDS.map(id => getTrack(id).width)).size, 8);
  for (const id of TRACK_IDS) {
    const track = getTrack(id);
    assert.deepEqual(track.point(0).toArray(), track.point(1).toArray(), id);
    for (let i = 0; i < SAMPLES; i++) {
      const a = track.frame(i / SAMPLES), b = track.frame((i + 6) / SAMPLES);
      const bend = Math.abs(delta(b.heading - a.heading, Math.PI * 2));
      assert.ok(bend < 1e-7 || track.length / 120 / bend > track.width / 2, `${id} turn fits the road`);
    }
    for (const pad of track.pads) {
      assert.ok(Math.abs(pad.lane) + PAD_WIDTH / 2 < track.width / 2 - .5, id);
      const k = grid(0, track);
      Object.assign(k, { s: pad.s - (PAD_LENGTH / 2 + .1) / track.length, lane: pad.lane, speed: 38 });
      drive(k, { steer: 0, brake: false, gas: true }, 1 / 60, track);
      assert.ok(k.boost > 1, `${id} pad ${pad.s}`);
    }
    const kart = grid(7, track), d = driver('x', 'Driver', 7, track);
    assert.equal(d.pose[0], pose(kart)[0], id);
    assert.ok(validPose(d.pose, track), id);
    assert.equal(validPose([.1, track.width / 2 + .1, 0, 42, 0, 0], track), false, id);
    for (let lap = 0; lap < LAPS; lap++) {
      for (const [i, s] of track.checkpoints.entries()) {
        assert.equal(checkpointAt(lap + s - .0001, track), lap * SECTORS + i, id);
        assert.equal(checkpointAt(lap + s, track), lap * SECTORS + i + 1, id);
      }
    }
    let updates = 0;
    while (kart.s < LAPS && updates++ < 10800) {
      const steer = Math.max(-1, Math.min(1, -kart.lane * .35));
      drive(kart, { steer, brake: false, gas: true }, 1 / 60, track);
      if (updates % 4 === 0 || kart.s >= LAPS) {
        const p = pose(kart);
        p[0] = Math.min(p[0], LAPS);
        assert.ok(validPose(p, track), id);
        assert.ok(advance(d, p, updates * 1000 / 60, 4 / 60, track), id);
      }
    }
    assert.equal(d.checkpoint, LAPS * SECTORS, id);
    assert.ok(d.finish !== null && d.finish < 110_000, id);
  }
});

test('Apex Arena crosses itself at two separated heights', () => {
  const track = getTrack('arena');
  const frames = Array.from({ length: SAMPLES }, (_, i) => track.frame(i / SAMPLES));
  const crossing = frames.filter(p => Math.hypot(p.x, p.z) < 2);
  assert.ok(crossing.some(low => crossing.some(high => high.y - low.y > 18)));
});

test('a local race uses its selected track for every entrant', () => {
  const track = getTrack('cedar');
  const race = new LocalRace(8, 0, track);
  assert.equal(race.room.track, 'cedar');
  race.room.drivers.forEach(d => assert.deepEqual(d.pose, pose(grid(d.slot, track))));
  const dt = 1 / 60;
  for (let frame = 1; frame <= 7200 && !race.room.complete; frame++) {
    const steer = Math.max(-1, Math.min(1, -race.kart.lane * .35));
    race.step({ gas: true, brake: false, steer }, dt, frame * dt * 1000);
    race.room.drivers.forEach(d => {
      assert.ok(validPose(d.pose, track));
      assert.equal(d.checkpoint, checkpointAt(d.pose[0], track));
    });
  }
  assert.ok(race.room.complete);
  assert.ok(race.room.drivers.every(d => d.finish !== null));
});
