import assert from 'node:assert/strict';
import { register } from 'node:module';
import { test } from 'node:test';
import { LAPS, LIMIT } from '../src/circuit';
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

test('racers resume their saved kart, late arrivals watch, and the host can start a rematch in the same room', async t => {
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

  const host = await join('Host');
  const guest = await join('Guest');
  await send(host.socket, 'start');
  const { start } = host.socket.take('room').room;
  assert.ok(start);
  now = start + 5000;
  const progress: Pose = [.25, 1, 0, 42, 0, 0];
  await send(guest.socket, progress);
  assert.deepEqual(host.socket.take('state').pose, progress);

  await room.webSocketClose(ws(guest.socket), 1000, '');
  const offline = host.socket.take('room').room;
  const saved = offline.drivers.find(d => d.id === guest.welcome.id)!;
  assert.deepEqual(saved.pose, progress);
  assert.equal(saved.checkpoint, 1);
  assert.equal(saved.online, false);
  assert.ok(!JSON.stringify(offline).includes(guest.token));

  room = new Room(ctx, {} as never);
  await ready;
  const watcher = await join('Guest');
  assert.notEqual(watcher.welcome.id, guest.welcome.id);
  assert.ok(!watcher.welcome.room.drivers.some(d => d.id === watcher.welcome.id));
  await send(watcher.socket, progress);
  now = start + LIMIT - 1000;
  await send(host.socket, [LAPS, 0, 0, 42, 0, 0]);
  const returned = await join('NewName', guest.token);
  assert.equal(returned.welcome.room.complete, false);
  assert.equal(returned.welcome.id, guest.welcome.id);
  assert.deepEqual(returned.welcome.room.drivers.find(d => d.id === returned.welcome.id), { ...saved, online: true });

  now = start + LIMIT;
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
});
