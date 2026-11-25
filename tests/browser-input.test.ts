import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Motor } from '../src/audio';
import { Controls } from '../src/controls';
import { readPreference, writePreference } from '../src/preferences';
import { RaceTiming } from '../src/timing';
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
    const controls = new Controls(() => {}, () => racing);
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

test('tilt waits for sensor data, reports denial or absence, and recovers on late data', async () => {
  const events = new EventTarget();
  let timeout = () => {};
  const window = {
    DeviceOrientationEvent: { requestPermission: async () => 'denied' },
    setTimeout: (fn: () => void) => { timeout = fn; return 1; },
    clearTimeout: () => { timeout = () => {}; },
  };
  await withAsyncGlobals({
    window: { configurable: true, value: window },
    screen: { configurable: true, value: { orientation: { angle: 90 } } },
    addEventListener: { configurable: true, value: events.addEventListener.bind(events) },
    matchMedia: { configurable: true, value: () => ({ matches: true }) },
  }, async () => {
    const controls = new Controls(() => {}, () => false);
    await controls.enableTilt();
    assert.equal(controls.tiltStatus, 'denied');
    window.DeviceOrientationEvent.requestPermission = async () => 'granted';
    await controls.enableTilt();
    assert.equal(controls.tiltStatus, 'waiting');
    timeout();
    assert.equal(controls.tiltStatus, 'unavailable');
    const orientation = (beta: number | null) => events.dispatchEvent(Object.assign(new Event('deviceorientation'), { beta, gamma: 0 }));
    orientation(null);
    assert.equal(controls.tiltStatus, 'unavailable');
    orientation(8);
    assert.equal(controls.tiltStatus, 'ready');
    assert.equal(controls.input().steer, -0);
    orientation(35);
    assert.ok(controls.input().steer < 0);
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

test('lap splits use interpolated crossings and finish time, and personal bests persist', () => {
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
    assert.deepEqual(timing.splits(30_000), [10_000, 9_000, 11_000]);
    assert.deepEqual(timing.records(30_000), { lap: 9_000, race: 30_000 });
    const retry = new RaceTiming();
    assert.deepEqual(retry.records(null), { lap: 9_000, race: 30_000 });
  });
});

test('rejoining mid-race does not invent lap splits before the first observed crossing', () => {
  const timing = new RaceTiming();
  timing.step(1.9, 2.1, 19_010, 20);
  assert.deepEqual(timing.splits(30_000), [undefined, undefined, 11_000]);
});
