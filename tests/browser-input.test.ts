import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Motor } from '../src/audio';
import { readPreference, writePreference } from '../src/preferences';

function withGlobals(globals: PropertyDescriptorMap, run: () => void) {
  const prior = Object.getOwnPropertyDescriptors(globalThis);
  Object.defineProperties(globalThis, globals);
  try { run(); } finally {
    for (const key of Object.keys(globals)) {
      if (prior[key]) Object.defineProperty(globalThis, key, prior[key]);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
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
