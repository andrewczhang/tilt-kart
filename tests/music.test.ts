import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { RaceMusic } from '../src/music';

function audioHarness() {
  const nodes: ReturnType<typeof makeSource>[] = [];
  const volumes: number[] = [];
  function makeSource() {
    return {
      context: { currentTime: 0 },
      connect: () => ({ connect() {} }),
      start() {},
      stop() { this.stopped = true; },
      stopped: false,
      loop: false,
    };
  }
  const ctx = {
    currentTime: 0,
    async decodeAudioData() { return {}; },
    createBufferSource() {
      const node = makeSource();
      nodes.push(node);
      return node;
    },
    createGain() {
      return { context: ctx, gain: { setTargetAtTime(value: number) { volumes.push(value); } } };
    },
  };
  return { ctx, nodes, volumes, music: new RaceMusic(() => ctx as unknown as AudioContext) };
}

const nextTurn = () => new Promise(resolve => setImmediate(resolve));
const mockDownload = (t: TestContext) => t.mock.method(globalThis, 'fetch',
  async (..._args: Parameters<typeof fetch>) => new Response('audio'));

test('race music loops the selected map and stops when the race ends', async t => {
  const downloads = mockDownload(t);
  const { music, nodes, volumes } = audioHarness();
  music.start('red-basin');
  await nextTurn();
  assert.equal(downloads.mock.calls[0].arguments[0], '/music/red-basin.mp3');
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].loop, true);
  assert.ok(volumes.at(-1)! > 0);

  music.stop();
  assert.equal(volumes.at(-1), 0);
  assert.equal(nodes[0].stopped, true);
});

test('music starts on unmute and remembers the preference without reloading the loop', async t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const prefs = new Map([['tilt-kart-music-muted', 'true']]);
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => prefs.get(key) ?? null,
    setItem: (key: string, value: string) => { prefs.set(key, value); },
  } });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  });
  const downloads = mockDownload(t);
  const { music, volumes } = audioHarness();
  music.start('red-basin');
  assert.equal(music.muted, true);
  assert.equal(downloads.mock.callCount(), 0);

  music.toggle();
  await nextTurn();
  assert.ok(volumes.at(-1)! > 0);
  assert.equal(prefs.get('tilt-kart-music-muted'), 'false');
  music.toggle();
  assert.equal(volumes.at(-1), 0);
  music.toggle();
  assert.equal(downloads.mock.callCount(), 1);
  music.stop();
});

test('a late audio decode cannot start music for a map that was exited', async t => {
  const downloads = mockDownload(t);
  const { ctx, music, nodes } = audioHarness();
  let completeDecode!: (buffer: object) => void;
  t.mock.method(ctx, 'decodeAudioData', () => new Promise<object>(resolve => { completeDecode = resolve; }));
  music.start('red-basin');
  await nextTurn();
  music.stop();
  assert.equal(downloads.mock.calls[0].arguments[1]?.signal?.aborted, true);
  completeDecode({});
  await nextTurn();
  assert.equal(nodes.length, 0);
});
