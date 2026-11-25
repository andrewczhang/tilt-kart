import { DurableObject } from 'cloudflare:workers';
import { COUNTDOWN, LIMIT } from '../src/circuit';
import { advance, driver, validPose, type Driver, type RoomState, type ServerMessage } from '../src/rules';

type Env = { ASSETS: Fetcher; ROOMS: DurableObjectNamespace<Room> };
type Meta = { created: number; host: string; start: number | null; complete: boolean; gone: Driver[] };
type Attachment = { driver: Driver; last: number };
const CODE = /^[A-Z0-9]{8}$/;
const IDLE_LIMIT = 12 * 60 * 60 * 1000;

export default {
  async fetch(req: Request, env: Env) {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/') && req.headers.has('Origin') && req.headers.get('Origin') !== url.origin) {
      return new Response('Origin not allowed', { status: 403 });
    }
    if (url.pathname === '/api/rooms' && req.method === 'POST') {
      const code = crypto.randomUUID().slice(0, 8).toUpperCase();
      const response = await env.ROOMS.getByName(code).fetch(new Request(new URL('/create', url), { method: 'POST' }));
      if (!response.ok) return response;
      return Response.json({ code });
    }
    if (url.pathname.startsWith('/api/rooms/')) {
      const code = url.pathname.split('/').pop()!;
      if (CODE.test(code)) return env.ROOMS.getByName(code).fetch(req);
      return new Response('Unknown room', { status: 404 });
    }
    if (url.pathname.startsWith('/api/')) return new Response('Not found', { status: 404 });
    return env.ASSETS.fetch(req);
  }
} satisfies ExportedHandler<Env>;

export class Room extends DurableObject<Env> {
  private meta?: Meta;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    void ctx.blockConcurrencyWhile(async () => {
      this.meta = await ctx.storage.get<Meta>('room');
    });
  }

  async fetch(req: Request) {
    const url = new URL(req.url);
    if (url.pathname === '/create' && req.method === 'POST') {
      if (this.meta) return new Response('Try creating another room', { status: 409 });
      this.meta = { created: Date.now(), host: '', start: null, complete: false, gone: [] };
      await this.save();
      return new Response(null, { status: 201 });
    }
    if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('WebSocket required', { status: 426 });
    }
    const sockets = this.sockets();
    const meta = this.meta;
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    const deny = (reason: string) => {
      this.send(pair[1], { type: 'error', reason });
      pair[1].close(1008, reason);
      return new Response(null, { status: 101, webSocket: pair[0] });
    };
    if (!meta || Date.now() - meta.created > IDLE_LIMIT) return deny('Room link has expired.');
    if (meta.start !== null) return deny('That race already started. Create a new room to race again.');
    if (sockets.length >= 8) return deny('That room is full.');
    const name = url.searchParams.get('name')?.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 20) || 'Driver';
    const id = crypto.randomUUID().slice(0, 8);
    const slots = new Set(sockets.map(s => this.data(s)!.driver.slot));
    let slot = 0;
    while (slots.has(slot)) slot++;
    pair[1].serializeAttachment({ driver: driver(id, name, slot), last: 0 } satisfies Attachment);
    if (!sockets.length) { meta.host = id; await this.save(); }
    const room = this.snapshot(meta);
    this.send(pair[1], { type: 'welcome', id, now: Date.now(), room });
    this.broadcast({ type: 'room', room }, pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    const meta = this.meta, data = this.data(ws);
    if (!meta || !data || typeof raw !== 'string' || raw.length > 160) return;
    const now = Date.now();
    if (now - meta.created > IDLE_LIMIT) { ws.close(1008, 'Room link has expired.'); return; }
    if (raw === 'start') {
      if (data.driver.id !== meta.host || meta.start !== null) return;
      meta.start = now + COUNTDOWN;
      await this.save();
      this.broadcast({ type: 'room', room: this.snapshot(meta) });
      return;
    }
    if (meta.start === null || now < meta.start || meta.complete) return;
    if (now - meta.start >= LIMIT) {
      await this.maybeComplete(meta, now);
      return;
    }
    if (now - data.last < 42 || data.driver.finish !== null) return;
    let p: unknown;
    try { p = JSON.parse(raw); } catch { return; }
    if (!validPose(p) || !advance(data.driver, p, now - meta.start, (now - (data.last || meta.start)) / 1000)) return;
    data.last = now;
    ws.serializeAttachment(data);
    const { id, checkpoint, finish } = data.driver;
    if (finish !== null) this.send(ws, { type: 'state', id, pose: p, checkpoint, finish });
    this.broadcast({ type: 'state', id, pose: p, checkpoint, finish }, ws);
    if (finish !== null) await this.maybeComplete(meta, now);
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    const meta = this.meta, data = this.data(ws);
    ws.serializeAttachment(null);
    try { ws.close(code === 1006 ? 1000 : code, reason); } catch {}
    if (!meta || !data) return;
    if (meta.start !== null) {
      meta.gone.push({ ...data.driver, online: false });
      if (await this.maybeComplete(meta, Date.now())) return;
      await this.save();
    } else if (meta.host === data.driver.id) {
      meta.host = this.sockets().map(s => this.data(s)!.driver)[0]?.id ?? '';
      await this.save();
    }
    this.broadcast({ type: 'room', room: this.snapshot(meta) });
  }

  webSocketError(ws: WebSocket) {
    return this.webSocketClose(ws, 1011, 'Connection interrupted');
  }

  private data(ws: WebSocket) { return ws.deserializeAttachment() as Attachment | null; }
  private sockets() { return this.ctx.getWebSockets().filter(s => this.data(s)); }
  private save() { return this.ctx.storage.put('room', this.meta!); }
  private snapshot(meta: Meta): RoomState {
    return {
      host: meta.host, start: meta.start, complete: meta.complete,
      drivers: [...this.sockets().map(s => this.data(s)!.driver), ...meta.gone]
    };
  }
  private send(ws: WebSocket, msg: ServerMessage) {
    try { ws.send(JSON.stringify(msg)); } catch {}
  }
  private broadcast(msg: ServerMessage, except?: WebSocket) {
    const packet = JSON.stringify(msg);
    for (const s of this.sockets()) if (s !== except) try { s.send(packet); } catch {}
  }
  private async maybeComplete(meta: Meta, now: number) {
    if (meta.complete) return false;
    const room = this.snapshot(meta);
    if (now - meta.start! < LIMIT && room.drivers.some(d => d.online && d.finish === null)) return false;
    meta.complete = true;
    await this.save();
    this.broadcast({ type: 'room', room: { ...room, complete: true } });
    return true;
  }
}
