import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Motor } from '../src/audio';
import { Controls } from '../src/controls';
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
