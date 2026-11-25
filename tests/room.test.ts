import assert from 'node:assert/strict';
import { register } from 'node:module';
import { test, type TestContext } from 'node:test';
import { COUNTDOWN, LAPS, LIMIT, getTrack } from '../src/circuit';
import { CUPS, cupStandings } from '../src/cups';
import { type Pose } from '../src/drive';
import { driver, type ServerMessage } from '../src/rules';

register(`data:text/javascript,${encodeURIComponent(`
  export function resolve(name, context, next) {
    if (name === 'cloudflare:workers') return {
      url: 'data:text/javascript,export class DurableObject { constructor(ctx) { this.ctx = ctx } }',
      shortCircuit: true
    };
    return next(name, context);
  }
`)}`);
const { Room } = await import('../worker/index');

class Socket {
  private attachment: unknown;
  private messages: ServerMessage[] = [];
  serializeAttachment(value: unknown) { this.attachment = structuredClone(value); }
  deserializeAttachment() { return structuredClone(this.attachment); }
  send(raw: string) { this.messages.push(JSON.parse(raw)); }
  close() {}
  take<T extends ServerMessage['type']>(type: T) {
    const message = this.messages.filter(m => m.type === type).at(-1);
    this.messages.length = 0;
    assert.ok(message?.type === type, `Expected ${type}`);
    return message as Extract<ServerMessage, { type: T }>;
  }
}

async function setupRoom(t: TestContext) {
  const sockets: Socket[] = [];
  let stored: unknown;
  let ready: Promise<unknown> | undefined;
  const ctx = {
    storage: {
      get: async () => structuredClone(stored),
      put: async (_key: string, value: unknown) => { stored = structuredClone(value); }
    },
    blockConcurrencyWhile: (load: () => Promise<unknown>) => { ready = load(); },
    setWebSocketAutoResponse: () => {},
    getWebSockets: () => sockets,
    acceptWebSocket: (socket: Socket) => { sockets.push(socket); }
  } as unknown as DurableObjectState;
  const restore = (key: string, value: unknown) => {
    const old = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => old ? Object.defineProperty(globalThis, key, old) : Reflect.deleteProperty(globalThis, key));
  };
  restore('WebSocketPair', class { 0 = new Socket(); 1 = new Socket(); });
  restore('WebSocketRequestResponsePair', class {});
  restore('Response', class extends Response {
    constructor(body?: BodyInit | null, options?: ResponseInit) {
      super(body, options?.status === 101 ? { ...options, status: 200 } : options);
    }
  });
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);

  let room = new Room(ctx, {} as never);
  await ready;
  const invite = 'https://kart.test/api/rooms/TESTROOM';
  assert.equal((await room.fetch(new Request('https://kart.test/create', { method: 'POST' }))).status, 201);
  async function join(name: string, token = crypto.randomUUID()) {
    await room.fetch(new Request(`${invite}?name=${name}`, {
      headers: { Upgrade: 'websocket', 'Sec-WebSocket-Protocol': token }
    }));
    const socket = sockets.at(-1)!;
    return { socket, token, welcome: socket.take('welcome') };
  }
  const ws = (s: Socket) => s as unknown as WebSocket;
  const send = (s: Socket, raw: string | Pose) => room.webSocketMessage(ws(s), typeof raw === 'string' ? raw : JSON.stringify(raw));
  return {
    join, send, ws,
    get room() { return room; },
    get now() { return now; },
    set now(value: number) { now = value; },
    async wake() { room = new Room(ctx, {} as never); await ready; }
  };
}

test('racers resume their saved kart, late arrivals watch, and the host can start a rematch in the same room', async t => {
  const world = await setupRoom(t);
  const { join, send, ws } = world;
  const host = await join('Host');
  const guest = await join('Guest');
  await send(host.socket, 'start');
  const { start } = host.socket.take('room').room;
  assert.ok(start);
  world.now = start + 5000;
  const progress: Pose = [.25, 1, 0, 42, 0, 0];
  await send(guest.socket, progress);
  assert.deepEqual(host.socket.take('state').pose, progress);

  await world.room.webSocketClose(ws(guest.socket), 1000, '');
  const offline = host.socket.take('room').room;
  const saved = offline.drivers.find(d => d.id === guest.welcome.id)!;
  assert.deepEqual(saved.pose, progress);
  assert.equal(saved.checkpoint, 1);
  assert.equal(saved.online, false);
  assert.ok(!JSON.stringify(offline).includes(guest.token));

  await world.wake();
  const watcher = await join('Guest');
  assert.notEqual(watcher.welcome.id, guest.welcome.id);
  assert.ok(!watcher.welcome.room.drivers.some(d => d.id === watcher.welcome.id));
  await send(watcher.socket, progress);
  world.now = start + LIMIT - 1000;
  await send(host.socket, [LAPS, 0, 0, 42, 0, 0]);
  const returned = await join('NewName', guest.token);
  assert.equal(returned.welcome.room.complete, false);
  assert.equal(returned.welcome.id, guest.welcome.id);
  assert.deepEqual(returned.welcome.room.drivers.find(d => d.id === returned.welcome.id), { ...saved, online: true });

  world.now = start + LIMIT;
  await send(watcher.socket, 'status');
  const final = returned.socket.take('room').room;
  assert.equal(final.complete, true);
  assert.ok(final.drivers.find(d => d.id === host.welcome.id)?.finish);
  await send(watcher.socket, 'rematch');
  await send(host.socket, 'rematch');
  const grid = watcher.socket.take('room').room;
  assert.equal(grid.start, null);
  assert.equal(grid.complete, false);
  assert.deepEqual(grid.drivers, [driver(host.welcome.id, 'Host', 0), driver(watcher.welcome.id, 'Guest', 2), driver(returned.welcome.id, 'Guest', 1)]);
  await send(host.socket, 'start');
  assert.ok(watcher.socket.take('room').room.start);

  world.now += LIMIT + 4000;
  await send(host.socket, 'status');
  await send(host.socket, 'rematch');
  await send(watcher.socket, 'track:mesa');
  const track = getTrack('cedar');
  await send(host.socket, 'track:cedar');
  const selected = watcher.socket.take('room').room;
  assert.equal(selected.track, 'cedar');
  for (const d of selected.drivers) assert.deepEqual(d.pose, driver(d.id, d.name, d.slot, track).pose);
  const cedarGuest = await join('Cedar guest');
  assert.equal(cedarGuest.welcome.room.track, 'cedar');
  await send(host.socket, 'start');
  world.now += 9000;
  const cedarPose: Pose = [.23, 1, 0, 42, 0, 0];
  await send(cedarGuest.socket, cedarPose);
  assert.equal(host.socket.take('state').checkpoint, 1);
  await world.room.webSocketClose(ws(cedarGuest.socket), 1000, '');
  const resumed = await join('Cedar guest', cedarGuest.token);
  assert.equal(resumed.welcome.room.track, 'cedar');
  assert.deepEqual(resumed.welcome.room.drivers.find(d => d.id === resumed.welcome.id)?.pose, cedarPose);
  world.now += LIMIT;
  await send(host.socket, 'status');
  await send(host.socket, 'rematch');
  const nextGrid = resumed.socket.take('room').room;
  assert.equal(nextGrid.start, null);
  assert.equal(nextGrid.track, 'cedar');
  for (const d of nextGrid.drivers) assert.deepEqual(d.pose, driver(d.id, d.name, d.slot, track).pose);
});

test('only the host advances a four-round cup; scores and reserved grid slots survive hibernation', async t => {
  const world = await setupRoom(t);
  const { join, send, ws } = world;
  const host = await join('Host');
  let guest = await join('Guest');
  await send(guest.socket, 'cup:summit');
  await send(host.socket, 'track:cedar');
  assert.equal(host.socket.take('room').room.cup, undefined);
  await send(host.socket, 'cup:afterburn');
  assert.equal(guest.socket.take('room').room.track, 'saltwater');
  await send(host.socket, 'track:mesa');
  await send(host.socket, 'start');
  let active = host.socket.take('room').room;
  const watcher = await join('Spectator');
  assert.ok(!watcher.welcome.room.drivers.some(d => d.id === watcher.welcome.id));
  const endPose: Pose = [LAPS, 0, 0, 42, 0, 0];

  for (const [round, track] of CUPS.afterburn.tracks.entries()) {
    assert.equal(active.track, track);
    assert.equal(active.cup?.round, round);
    assert.equal(active.cup?.results.length, round);
    assert.equal(active.start, world.now + COUNTDOWN);
    for (const d of active.drivers) assert.deepEqual(d.pose, driver(d.id, d.name, d.slot, getTrack(track)).pose);
    await send(host.socket, `next:${round}`);
    world.now = active.start! + 100_000;
    await send(host.socket, endPose);
    world.now += 1000;
    if (round === 0) await world.room.webSocketClose(ws(guest.socket), 1000, '');
    else await send(guest.socket, endPose);
    const complete = watcher.socket.take('room').room;
    assert.equal(complete.complete, true);
    assert.equal(complete.cup?.results.length, round + 1);
    assert.deepEqual(cupStandings(complete.cup!).map(d => d.total), [(round + 1) * 15, round * 12]);
    await send(watcher.socket, `next:${round}`);
    await world.wake();
    if (round < 3) {
      await send(host.socket, 'rematch');
      await send(host.socket, `next:${round}`);
      active = watcher.socket.take('room').room;
      if (round === 0) {
        guest = await join('Not a new driver', guest.token);
        const returning = guest.welcome.room.drivers.find(d => d.id === guest.welcome.id)!;
        assert.equal(returning.name, 'Guest');
        assert.equal(returning.finish, null);
        assert.deepEqual(returning.pose, driver(returning.id, 'Guest', 1, getTrack('switchyard')).pose);
      }
    }
  }
  await send(host.socket, 'next:3');
  await send(host.socket, 'rematch');
  const lobby = watcher.socket.take('room').room;
  assert.equal(lobby.start, null);
  assert.equal(lobby.cup?.results.length, 0);
  assert.equal(lobby.track, 'saltwater');
  assert.equal(lobby.drivers.length, 3);
  await send(host.socket, 'cup:single');
  const single = watcher.socket.take('room').room;
  assert.equal(single.cup, undefined);
  assert.equal(single.track, 'cedar');
});
