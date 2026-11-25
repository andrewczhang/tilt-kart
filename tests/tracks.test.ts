import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Box3, Group, InstancedMesh, Matrix4, Vector3 } from 'three';
import { LocalRace } from '../src/bots';
import { getTrack, LAPS, SECTORS, SAMPLES, delta } from '../src/circuit';
import { bump, drive, grid, PAD_LENGTH, PAD_WIDTH, pose } from '../src/drive';
import { advance, checkpointAt, driver, validPose } from '../src/rules';
import { themedScenery } from '../src/track-art';
import { DEFAULT_TRACK, isTrackId, TRACK_IDS } from '../src/tracks';
import { centerSteer } from './steering';

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
    while (d.finish === null && kart.s < LAPS && updates++ < 10800) {
      const steer = centerSteer(kart, track);
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

test('scenery footprints clear the main road and branch on every circuit', () => {
  const matrix = new Matrix4(), point = new Vector3();
  for (const id of TRACK_IDS) {
    const track = getTrack(id), world = new Group();
    themedScenery(world, track);
    const bounds: Box3[] = [];
    for (const mesh of world.children) {
      if (!(mesh instanceof InstancedMesh)) continue;
      mesh.geometry.computeBoundingBox();
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, matrix);
        bounds.push(mesh.geometry.boundingBox!.clone().applyMatrix4(matrix));
      }
    }
    assert.ok(bounds.length > 0, id);
    for (let i = 0; i < SAMPLES; i++) {
      const s = i / SAMPLES, half = track.widthAt(s) / 2, branch = track.branchAt(s);
      const lanes = [-half - .5, -half / 2, 0, half / 2, half + .5];
      if (branch) lanes.push(branch.center, branch.center - branch.width / 2, branch.center + branch.width / 2);
      for (const lane of lanes) {
        point.copy(track.point(s, lane, .5));
        assert.equal(bounds.some(box => box.containsPoint(point)), false, `${id} at ${s}, lane ${lane}`);
      }
    }
  }
});

test('Apex Arena crosses itself at two separated heights', () => {
  const track = getTrack('arena');
  const frames = Array.from({ length: SAMPLES }, (_, i) => ({ s: i / SAMPLES, ...track.frame(i / SAMPLES) }));
  const crossing = frames.filter(p => Math.hypot(p.x, p.z) < 2);
  assert.ok(crossing.some(low => crossing.some(high => high.y - low.y > 18)));
  const pair = crossing.flatMap(low => crossing.map(high => ({ low, high }))).find(({ low, high }) =>
    high.y - low.y > 18 && Math.hypot(high.x - low.x, high.z - low.z) < 2.65);
  assert.ok(pair);
  const low = { ...grid(0, track), s: pair.low.s, lane: 0, speed: 25 };
  const high = { ...grid(1, track), s: pair.high.s, lane: 0, speed: 25 };
  const before = [{ ...low }, { ...high }];
  bump(low, high, track);
  assert.deepEqual([low, high], before);
});

test('split roads retain progression but disallow changing roads across the median', () => {
  for (const id of ['red-basin', 'switchyard', 'saltwater', 'cedar'] as const) {
    const track = getTrack(id), branch = track.branch!;
    const station = (branch.start + branch.end) / 2;
    const alt = track.branchAt(station)!;
    const midpoint = (track.widthAt(station) / 2 + Math.abs(alt.center) - alt.width / 2) / 2 * alt.side;
    assert.equal(validPose([station, midpoint, 0, 40, 0, 0], track), false, id);
    assert.equal(validPose([station, alt.center, 0, 40, 0, 0], track), true, id);
    const d = driver('branch', 'Driver', 0, track);
    const old = station - .002;
    d.pose = [old, track.branchAt(old)!.center, 0, 40, 0, 0];
    assert.equal(advance(d, [station, 0, 0, 40, 0, 0], 10_000, .08, track), false, id);
    assert.ok(advance(d, [station, alt.center, 0, 40, 0, 0], 10_000, .08, track), id);
    assert.equal(d.checkpoint, checkpointAt(station, track), id);
  }
});

test('ramps lift karts over open gaps and grip varies on ice and lava edges', () => {
  for (const id of ['frostline', 'saltwater', 'mesa'] as const) {
    const track = getTrack(id), { start, end, ramp } = track.jumps![0];
    const middle = (start + end) / 2;
    assert.equal(track.gapAt(start - .001), false, id);
    assert.equal(track.gapAt(middle), true, id);
    assert.equal(track.gapAt(end), false, id);
    assert.ok(track.airHeight(middle) > 3, id);
    assert.equal(track.airHeight(start - ramp), 0, id);
  }
  assert.ok(getTrack('frostline').surfaceAt(.32, 0) < .5);
  assert.equal(getTrack('cinder').surfaceAt(.60, 0), 1);
  assert.ok(getTrack('cinder').surfaceAt(.60, 6) < 1);
  assert.ok(getTrack('arena').widthAt(.62) > getTrack('arena').width + 5);
});

test('braking cannot strand a stopped kart over any jump gap', () => {
  for (const id of ['frostline', 'saltwater', 'mesa'] as const) {
    const track = getTrack(id), { start, end } = track.jumps![0];
    const kart = grid(0, track);
    Object.assign(kart, { s: start, lane: 0, speed: 0 });
    let frames = 0;
    while (track.gapAt(kart.s) && frames++ < 60) {
      drive(kart, { steer: 1, brake: true, gas: false }, 1 / 60, track);
    }
    assert.ok(kart.s >= end - 1e-10, id);
    assert.ok(frames >= 47 && frames <= 49, id);
    assert.equal(track.airHeight(kart.s), 0, id);
  }
});

test('power-up speeds and spin-outs stay valid on a split road', () => {
  const track = getTrack('saltwater');
  const k = grid(0, track);
  const s = .603, lane = track.branchAt(s)!.center;
  const d = driver('branch', 'Driver', 0, track);
  d.pose = [s - .001, lane, 0, 62, 0, 1.95];
  assert.ok(validPose(d.pose, track));
  assert.ok(advance(d, [s, lane, 0, 62, 0, 1.95], 14_000, .06, track));
  Object.assign(k, { s: .665, lane: -24, speed: 42, spin: 1.2 });
  for (let i = 0; i < 72; i++) {
    drive(k, {steer: 0, gas: true, brake: false}, 1 / 60, track);
    assert.ok(validPose(pose(k), track));
  }
});

test('a local race uses its selected track for every entrant', () => {
  const track = getTrack('cedar');
  const race = new LocalRace(8, 0, track);
  assert.equal(race.room.track, 'cedar');
  race.room.drivers.forEach(d => assert.deepEqual(d.pose, pose(grid(d.slot, track))));
  const dt = 1 / 60;
  for (let frame = 1; frame <= 7200 && !race.room.complete; frame++) {
    const steer = centerSteer(race.kart, track);
    race.step({ gas: true, brake: false, steer }, dt, frame * dt * 1000);
    race.room.drivers.forEach(d => {
      assert.ok(validPose(d.pose, track));
      assert.equal(d.checkpoint, checkpointAt(d.pose[0], track));
    });
  }
  assert.ok(race.room.complete);
  assert.ok(race.room.drivers.every(d => d.finish !== null));
});
