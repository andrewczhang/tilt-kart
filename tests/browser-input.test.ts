import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Motor } from '../src/audio';
import { Controls } from '../src/controls';
import { encodeGhost } from '../src/ghost';
import { readPreference, writePreference } from '../src/preferences';
import { personalGhost, savePersonalGhost } from '../src/time-trial';
import { RaceTiming } from '../src/timing';
import { courseLayoutKey } from '../src/tracks';
import { RaceWakeLock } from '../src/wake';

function setGlobals(globals: PropertyDescriptorMap) {
  const prior = Object.getOwnPropertyDescriptors(globalThis);
  Object.defineProperties(globalThis, globals);
  return () => {
    for (const key of Object.keys(globals)) {
      if (prior[key]) Object.defineProperty(globalThis, key, prior[key]);
      else Reflect.deleteProperty(globalThis, key);
    }
  };
}

function withGlobals(globals: PropertyDescriptorMap, run: () => void) {
  const restore = setGlobals(globals);
  try { run(); } finally { restore(); }
}

async function withAsyncGlobals(globals: PropertyDescriptorMap, run: () => void | Promise<void>) {
  const restore = setGlobals(globals);
  try { await run(); } finally { restore(); }
}

test('blocked local storage does not prevent loading or changing preferences', () => {
  withGlobals({ localStorage: { configurable: true, get() { throw new DOMException('Blocked', 'SecurityError'); } } }, () => {
    const motor = new Motor();
    assert.equal(motor.muted, false);
    motor.toggle();
    assert.equal(motor.muted, true);
    assert.equal(readPreference('tilt-kart-name'), null);
    assert.doesNotThrow(() => writePreference('tilt-kart-name', 'Ari'));
  });
});

test('time trial personal bests ignore old-clock ghosts and retain wall-clock ghosts', () => {
  const track = 'frostline';
  const replay = { lapMs: 50, ghost: encodeGhost([[0, 0, 0, 42, 0, 0], [1, 0, 0, 42, 0, 0]]) };
  const oldKey = `tilt-kart-trial-best-${courseLayoutKey(track)}`;
  const oldReplay = JSON.stringify({ ...replay, lapMs: 49 });
  const storage = new Map([[oldKey, oldReplay]]);
  withGlobals({ localStorage: { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  } } }, () => {
    assert.equal(personalGhost(track), undefined);
    savePersonalGhost(track, replay);
    assert.deepEqual(personalGhost(track)?.replay, replay);
    assert.equal(storage.get(oldKey), oldReplay);
    assert.equal(personalGhost('mesa'), undefined);
  });
});

test('space activates menu buttons but brakes during a race regardless of focus', () => {
  const events = new EventTarget();
  class Button {}
  class InputField {}
  withGlobals({
    addEventListener: { configurable: true, value: events.addEventListener.bind(events) },
    matchMedia: { configurable: true, value: () => ({ matches: false }) },
    HTMLButtonElement: { configurable: true, value: Button },
    HTMLInputElement: { configurable: true, value: InputField }
  }, () => {
    let racing = false;
    const controls = new Controls(() => racing);
    const space = (type: string, target: object) => {
      const event = new Event(type, { cancelable: true });
      Object.defineProperties(event, { key: { value: ' ' }, target: { value: target } });
      return events.dispatchEvent(event);
    };
    assert.equal(space('keydown', new Button()), true);
    assert.equal(controls.input().brake, false);
    racing = true;
    assert.equal(space('keydown', new Button()), false);
    assert.equal(controls.input().brake, true);
    space('keyup', new Button());
    assert.equal(space('keydown', new InputField()), false);
    assert.equal(controls.input().brake, true);
    space('keyup', new InputField());
    assert.equal(space('keydown', {}), false);
    assert.equal(controls.input().brake, true);
    space('keyup', {});
    assert.equal(controls.input().brake, false);
  });
});

test('phone buttons steer and brake together without motion data', () => {
  const events = new EventTarget();
  const button = () => Object.assign(new EventTarget(), { setPointerCapture: () => {} });
  const buttons = { left: button(), right: button(), brake: button() };
  const press = (id: keyof typeof buttons, type: string, pointerId: number) =>
    buttons[id].dispatchEvent(Object.assign(new Event(type, { cancelable: true }), { pointerId }));
  withGlobals({
    document: { configurable: true, value: { getElementById: (id: keyof typeof buttons) => buttons[id] } },
    addEventListener: { configurable: true, value: events.addEventListener.bind(events) },
    matchMedia: { configurable: true, value: () => ({ matches: true }) },
  }, () => {
    const controls = new Controls(() => true);
    controls.bindTouch();
    assert.deepEqual(controls.input(), { steer: 0, brake: false, gas: true });
    events.dispatchEvent(Object.assign(new Event('deviceorientation'), { beta: 40, gamma: 40 }));
    assert.equal(controls.input().steer, 0);
    assert.equal(press('left', 'pointerdown', 1), false);
    press('brake', 'pointerdown', 2);
    assert.deepEqual(controls.input(), { steer: 1, brake: true, gas: true });
    press('left', 'pointerup', 1);
    press('right', 'pointerdown', 3);
    assert.deepEqual(controls.input(), { steer: -1, brake: true, gas: true });
    press('right', 'pointercancel', 3);
    assert.deepEqual(controls.input(), { steer: 0, brake: true, gas: true });
    press('brake', 'lostpointercapture', 2);
    assert.deepEqual(controls.input(), { steer: 0, brake: false, gas: true });
  });
});

test('race wake lock is acquired, restored on visibility, and released on exit', async () => {
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  class Lock extends EventTarget {
    released = false;
    async release() { this.released = true; this.dispatchEvent(new Event('release')); }
  }
  const locks: Lock[] = [];
  await withAsyncGlobals({
    document: { configurable: true, value: document },
    navigator: { configurable: true, value: { wakeLock: { request: async () => {
      const lock = new Lock(); locks.push(lock); return lock;
    } } } },
  }, async () => {
    const wake = new RaceWakeLock();
    wake.setActive(true);
    await Promise.resolve();
    assert.equal(locks.length, 1);
    document.visibilityState = 'hidden';
    await locks[0].release();
    document.dispatchEvent(new Event('visibilitychange'));
    assert.equal(locks.length, 1);
    document.visibilityState = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
    assert.equal(locks.length, 2);
    wake.setActive(false);
    assert.equal(locks[1].released, true);
  });
});

test('all lap splits use client crossings even when the official finish is later', () => {
  const values = new Map<string, string>();
  withGlobals({
    localStorage: { configurable: true, value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    } },
  }, () => {
    const timing = new RaceTiming();
    timing.step(.9, 1.1, 10_010, 20);
    timing.step(1.9, 2.1, 19_010, 20);
    timing.step(2.9, 3.1, 30_010, 20);
    assert.deepEqual(timing.splits(true), [10_000, 9_000, 11_000]);
    assert.deepEqual(timing.splits(false), [10_000, 9_000]);
    assert.deepEqual(timing.records(30_800), { lap: 9_000, race: 30_800 });
    const retry = new RaceTiming();
    assert.deepEqual(retry.records(null), { lap: 9_000, race: 30_800 });
  });
});

test('rejoining mid-race does not invent lap splits before the first observed crossing', () => {
  const timing = new RaceTiming();
  timing.step(1.9, 2.1, 19_010, 20);
  timing.step(2.9, 3.1, 30_010, 20);
  assert.deepEqual(timing.splits(true), [undefined, undefined, 11_000]);
});

test('a clamped local finish uses the crossing time instead of the end of the frame', () => {
  const timing = new RaceTiming();
  timing.step(1.9, 2.1, 19_010, 20);
  timing.step(2.9, 3, 30_020, 40, 30_005);
  assert.deepEqual(timing.splits(true), [undefined, undefined, 11_005]);
});

test('personal bests are separate for each circuit', () => {
  const values = new Map([
    ['tilt-kart-best-lap', '1'],
    ['tilt-kart-best-time', '1'],
    ['tilt-kart-best-lap-arena', '1'],
    ['tilt-kart-best-time-arena', '1'],
  ]);
  withGlobals({
    localStorage: { configurable: true, value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    } },
  }, () => {
    const basin = new RaceTiming();
    assert.deepEqual(basin.records(null), { lap: Infinity, race: Infinity });
    basin.step(.9, 1.1, 10_010, 20);
    assert.deepEqual(basin.records(30_000), { lap: 10_000, race: 30_000 });
    const arena = new RaceTiming('arena');
    assert.deepEqual(arena.records(null), { lap: Infinity, race: Infinity });
    arena.step(.9, 1.1, 20_010, 20);
    assert.deepEqual(arena.records(50_000), { lap: 20_000, race: 50_000 });
    assert.deepEqual(new RaceTiming().records(null), { lap: 10_000, race: 30_000 });
  });
});
