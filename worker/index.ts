import { DurableObject } from 'cloudflare:workers';
import { COUNTDOWN, LIMIT, delta, getTrack, wrap, type Circuit } from '../src/circuit';
import { cupTrack, isCupId, newCup, nextRound, scoreRound, type Cup } from '../src/cups';
import { BOX_RESPAWN, BOX_SPOTS, validItemEvent, type ItemEvent } from '../src/powerups';
import { advance, driver, validPose, type Driver, type RoomState, type ServerMessage } from '../src/rules';
import { DEFAULT_TRACK, isTrackId, type TrackId } from '../src/tracks';

type Env = { ASSETS: Fetcher; ROOMS: DurableObjectNamespace<Room> };
type Away = Driver & { token?: string };
type Meta = { created: number; host: string; start: number | null; complete: boolean; gone: Away[]; track?: TrackId; cup?: Cup };
type Attachment = { driver: Driver; last: number; token?: string; watching?: boolean; hasItem?: boolean };
const CODE = /^[A-Z0-9]{8}$/;
const TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
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
  private boxReady = new Map<number, number>();
  private activeItems = new Map<string, { kind: 'banana' | 'shell' | 'homing'; owner: string; s: number; lane: number; expires: number }>();
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
    const protocol = req.headers.get('Sec-WebSocket-Protocol');
    const token = protocol && TOKEN.test(protocol) ? protocol : undefined;
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    const upgrade = () => new Response(null, { status: 101, webSocket: pair[0], headers: token ? { 'Sec-WebSocket-Protocol': token } : undefined });
    const deny = (reason: string) => {
      this.send(pair[1], { type: 'error', reason });
      pair[1].close(1008, reason);
      return upgrade();
    };
    if (!meta || Date.now() - meta.created > IDLE_LIMIT) return deny('Room link has expired.');
    const previous = token ? sockets.find(s => this.data(s)!.token === token) : undefined;
    const away = token ? meta.gone.findIndex(d => d.token === token) : -1;
    const name = url.searchParams.get('name')?.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 20) || 'Driver';
    let data: Attachment;
    if (previous) {
      data = { ...this.data(previous)!, hasItem: false };
      previous.serializeAttachment(null);
      previous.close(4001, 'Rejoined in another tab.');
    } else if (away >= 0) {
      const [{ token: resumeToken, ...saved }] = meta.gone.splice(away, 1);
      data = { driver: { ...saved, online: true }, last: Date.now(), token: resumeToken };
    } else {
      if (sockets.length + meta.gone.length >= 8) return deny('That room is full.');
      const watching = meta.start !== null;
      const slots = new Set(sockets.map(s => this.data(s)!.driver.slot));
      let slot = 0;
      while (slots.has(slot)) slot++;
      data = { driver: driver(crypto.randomUUID().slice(0, 8), name, watching ? 0 : slot, getTrack(this.trackId(meta))), last: 0, token, watching };
    }
    const { id } = data.driver;
    pair[1].serializeAttachment(data);
    const hostChanged = !sockets.length && meta.host !== id;
    if (hostChanged) meta.host = id;
    const now = Date.now();
    const completed = this.maybeComplete(meta, now);
    const saved = hostChanged || away >= 0 || completed ? this.save() : undefined;
    const room = this.snapshot(meta);
    this.send(pair[1], { type: 'welcome', id, now, room });
    if (meta.start !== null && !meta.complete) {
      for (const [hid, item] of this.activeItems) {
        if (item.expires > now && item.kind === 'banana') {
          const ttl = Math.round(((item.expires - now) / 1000) * 10) / 10;
          if (ttl > 0) this.send(pair[1], { type: 'item', from: item.owner, event: { kind: 'drop', item: 'banana', hid, s: item.s, lane: item.lane, ttl } });
        }
      }
    }
    this.broadcast({ type: 'room', room }, pair[1]);
    await saved;
    return upgrade();
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    const meta = this.meta, data = this.data(ws);
    if (!meta || !data || typeof raw !== 'string' || raw.length > 256) return;
    const now = Date.now();
    if (now - meta.created > IDLE_LIMIT) { ws.close(1008, 'Room link has expired.'); return; }
    if (raw === 'rematch') {
      if (data.driver.id !== meta.host || !meta.complete || (meta.cup && nextRound(meta.cup))) return;
      meta.start = null;
      meta.complete = false;
      meta.gone = [];
      if (meta.cup) meta.cup = newCup(meta.cup.id);
      this.resetGrid(meta, true);
      await this.publish(meta);
      return;
    }
    if (raw.startsWith('next:')) {
      if (data.driver.id !== meta.host || !meta.complete || !meta.cup || raw !== `next:${meta.cup.round}`) return;
      const cup = nextRound(meta.cup);
      if (!cup) return;
      meta.cup = cup;
      meta.start = now + COUNTDOWN;
      meta.complete = false;
      this.resetGrid(meta);
      await this.publish(meta);
      return;
    }
    if (raw.startsWith('cup:')) {
      const id = raw.slice(4);
      if (data.driver.id !== meta.host || meta.start !== null || (id !== 'single' && !isCupId(id))) return;
      if (id === (meta.cup?.id ?? 'single')) return;
      meta.cup = isCupId(id) ? newCup(id) : undefined;
      this.resetGrid(meta);
      await this.publish(meta);
      return;
    }
    if (raw.startsWith('track:')) {
      const id = raw.slice(6);
      if (data.driver.id !== meta.host || meta.start !== null || meta.cup || !isTrackId(id) || id === (meta.track ?? DEFAULT_TRACK)) return;
      meta.track = id;
      this.resetGrid(meta);
      await this.publish(meta);
      return;
    }
    if (raw === 'start') {
      if (data.driver.id !== meta.host || meta.start !== null) return;
      meta.start = now + COUNTDOWN;
      this.boxReady.clear();
      this.activeItems.clear();
      await this.publish(meta);
      return;
    }
    if (meta.start === null || now < meta.start || meta.complete) return;
    if (now - meta.start >= LIMIT) {
      if (this.maybeComplete(meta, now)) await this.publish(meta);
      return;
    }
    if (data.watching || raw === 'status' || data.driver.finish !== null) return;
    let p: unknown;
    try { p = JSON.parse(raw); } catch { return; }
    const track = getTrack(this.trackId(meta));
    if (p && typeof p === 'object' && !Array.isArray(p)) {
      const msg = p as { type?: unknown; event?: unknown };
      if (msg.type === 'item' && validItemEvent(msg.event, track) && this.acceptItem(ws, data, msg.event, now, track)) {
        this.broadcast({ type: 'item', from: data.driver.id, event: msg.event }, ws);
      }
      return;
    }
    if (now - data.last < 42) return;
    if (!validPose(p, track) || !advance(data.driver, p, now - meta.start, (now - (data.last || meta.start)) / 1000, track)) return;
    data.last = now;
    ws.serializeAttachment(data);
    const { id, checkpoint, finish } = data.driver;
    if (finish !== null) this.send(ws, { type: 'state', id, pose: p, checkpoint, finish });
    this.broadcast({ type: 'state', id, pose: p, checkpoint, finish }, ws);
    if (finish !== null && this.maybeComplete(meta, now)) await this.publish(meta);
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    const meta = this.meta, data = this.data(ws);
    ws.serializeAttachment(null);
    try { ws.close(code === 1006 ? 1000 : code, reason); } catch {}
    if (!meta || !data) return;
    const wentAway = meta.start !== null && !data.watching;
    if (wentAway) meta.gone.push({ ...data.driver, token: data.token, online: false });
    const hostChanged = meta.host === data.driver.id;
    if (hostChanged) meta.host = this.sockets().map(s => this.data(s)!.driver)[0]?.id ?? '';
    const completed = this.maybeComplete(meta, Date.now());
    if (wentAway || hostChanged || completed) await this.publish(meta);
    else if (!data.watching) this.broadcast({ type: 'room', room: this.snapshot(meta) });
  }

  webSocketError(ws: WebSocket) {
    return this.webSocketClose(ws, 1011, 'Connection interrupted');
  }

  private acceptItem(ws: WebSocket, data: Attachment, event: ItemEvent, now: number, track: Circuit) {
    const near = (s: number) => Math.abs(delta(wrap(data.driver.pose[0]) - wrap(s))) * track.length <= 28;
    if (event.kind === 'pickup') {
      const spot = BOX_SPOTS[event.box];
      if (!spot || now < (this.boxReady.get(event.box) ?? 0) || !near(spot.s)) return false;
      this.boxReady.set(event.box, now + BOX_RESPAWN * 1000);
      data.hasItem = true;
      ws.serializeAttachment(data);
      return true;
    }
    if (event.kind === 'drop' || event.kind === 'fire' || event.kind === 'star') {
      if (!data.hasItem) return false;
      if ((event.kind === 'drop' || event.kind === 'fire') && !near(event.s)) return false;
      data.hasItem = false;
      ws.serializeAttachment(data);
      if (event.kind === 'drop' || event.kind === 'fire') {
        if (this.activeItems.size > 40) {
          for (const [k, v] of this.activeItems) if (v.expires < now) this.activeItems.delete(k);
        }
        this.activeItems.set(event.hid, {
          kind: event.item, owner: data.driver.id, s: event.s, lane: event.lane,
          expires: now + (event.kind === 'drop' ? 45_000 : 7_000)
        });
      }
      return true;
    }
    if (event.kind === 'hit') {
      if (event.target !== data.driver.id) return false;
      if (event.hid !== undefined) {
        const active = this.activeItems.get(event.hid);
        if (!active || active.expires < now) return false;
        if (active.kind === 'banana' && !near(active.s)) return false;
        this.activeItems.delete(event.hid);
      }
      return true;
    }
    return false;
  }

  private data(ws: WebSocket) { return ws.deserializeAttachment() as Attachment | null; }
  private sockets() { return this.ctx.getWebSockets().filter(s => this.data(s)); }
  private trackId(meta: Meta) { return meta.cup ? cupTrack(meta.cup) : meta.track ?? DEFAULT_TRACK; }
  private resetGrid(meta: Meta, promoteWatchers = false) {
    const track = getTrack(this.trackId(meta));
    this.boxReady.clear();
    this.activeItems.clear();
    const entries = this.sockets().map(s => ({ s, data: this.data(s)! }));
    const slots = new Set(entries.filter(e => !e.data.watching).map(e => e.data.driver.slot));
    for (const { s, data } of entries) {
      let { id, name, slot } = data.driver;
      if (data.watching) {
        if (!promoteWatchers) continue;
        while (slots.has(slot)) slot++;
        slots.add(slot);
      }
      s.serializeAttachment({ driver: driver(id, name, slot, track), last: 0, token: data.token } satisfies Attachment);
    }
    meta.gone = meta.gone.map(({ id, name, slot, token }) => ({ ...driver(id, name, slot, track), token, online: false }));
  }

  private save() { return this.ctx.storage.put('room', this.meta!); }
  private publish(meta: Meta) {
    const saved = this.save();
    this.broadcast({ type: 'room', room: this.snapshot(meta) });
    return saved;
  }
  private snapshot(meta: Meta): RoomState {
    return {
      host: meta.host, start: meta.start, complete: meta.complete, track: this.trackId(meta), cup: meta.cup,
      drivers: [...this.sockets().map(s => this.data(s)!).filter(d => !d.watching).map(d => d.driver),
        ...meta.gone.map(({ token: _token, ...d }) => d)]
    };
  }
  private send(ws: WebSocket, msg: ServerMessage) {
    try { ws.send(JSON.stringify(msg)); } catch {}
  }
  private broadcast(msg: ServerMessage, except?: WebSocket) {
    const packet = JSON.stringify(msg);
    for (const s of this.sockets()) if (s !== except) try { s.send(packet); } catch {}
  }
  private maybeComplete(meta: Meta, now: number) {
    if (meta.start === null || now < meta.start || meta.complete) return false;
    const { drivers } = this.snapshot(meta);
    if (now - meta.start < LIMIT && drivers.some(d => d.finish === null && (!meta.cup || d.online))) return false;
    meta.complete = true;
    if (meta.cup) meta.cup = scoreRound(meta.cup, drivers);
    return true;
  }
}
