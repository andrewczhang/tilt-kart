import { RED_BASIN, clamp, delta, wrap, type Circuit } from './circuit';
import { kartContactDistance, type Kart, type Pose } from './drive';

export type PowerupId = 'turbo' | 'banana' | 'shell' | 'homing' | 'star';

export type PowerupMeta = {
  id: PowerupId;
  label: string;
  color: string;
  svg: string;
};

export const POWERUPS: Record<PowerupId, PowerupMeta> = {
  turbo: {
    id: 'turbo',
    label: 'TURBO',
    color: '#f47b26',
    svg: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M18 3L7 18h8l-2 11 12-15h-8l1-11z" fill="currentColor"/></svg>'
  },
  banana: {
    id: 'banana',
    label: 'PEEL',
    color: '#f7d244',
    svg: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 4c1 5-1 10-8 16 5 1 9 0 12-3 2 3 5 5 8 4-5-5-8-10-9-17h-3z" fill="currentColor"/><path d="M10 21c-2 2-4 3-6 3 4 4 11 4 16 1-3-1-6-3-10-4z" fill="currentColor" opacity=".8"/></svg>'
  },
  shell: {
    id: 'shell',
    label: 'SHELL',
    color: '#46c266',
    svg: '<svg viewBox="0 0 32 32" aria-hidden="true"><polygon points="16,4 27,10 27,22 16,28 5,22 5,10" fill="currentColor"/><polygon points="16,9 22,12.5 22,19.5 16,23 10,19.5 10,12.5" fill="#202b31"/></svg>'
  },
  homing: {
    id: 'homing',
    label: 'HOMING',
    color: '#ec583b',
    svg: '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="10" fill="none" stroke="currentColor" stroke-width="3.2"/><circle cx="16" cy="16" r="4" fill="currentColor"/><path d="M16 2v5M16 25v5M2 16h5M25 16h5" stroke="currentColor" stroke-width="2.6"/></svg>'
  },
  star: {
    id: 'star',
    label: 'STAR',
    color: '#ffd633',
    svg: '<svg viewBox="0 0 32 32" aria-hidden="true"><polygon points="16,2 20,11 30,12 22.5,19 24.5,29 16,24 7.5,29 9.5,19 2,12 12,11" fill="currentColor"/></svg>'
  }
};

export const POWERUP_LIST: PowerupId[] = ['turbo', 'banana', 'shell', 'homing', 'star'];

export const BOX_RESPAWN = 6;
export const ROULETTE_TIME = 0.85;
export const STAR_DURATION = 5.5;
export const SPIN_DURATION = 1.15;

export const BOX_SPOTS: ReadonlyArray<{ s: number; lane: number }> = [
  0.09, 0.33, 0.66, 0.90
].flatMap(s => [-4.5, -1.5, 1.5, 4.5].map(lane => ({ s, lane })));

export type ItemBox = { id: number; s: number; lane: number; cooldown: number };
export type Hazard = { id: string; owner: string; kind: 'banana'; s: number; lane: number; age: number; ttl: number };
export type Projectile = {
  id: string; owner: string; kind: 'shell' | 'homing';
  s: number; lane: number; laneVel: number; speed: number; target?: string; age: number; ttl: number;
};
export type KartFx = { star: number; spin: number };

export type ItemEvent =
  | { kind: 'pickup'; box: number }
  | { kind: 'drop'; item: 'banana'; hid: string; s: number; lane: number; ttl?: number }
  | { kind: 'fire'; item: 'shell' | 'homing'; hid: string; s: number; lane: number; laneVel: number; target?: string }
  | { kind: 'star' }
  | { kind: 'hit'; target: string; hid?: string; item: 'banana' | 'shell' | 'homing' | 'star' };

export type PowerupCallbacks = {
  emit?: (event: ItemEvent) => void;
  sfx?: (kind: 'pickup' | 'roulette' | 'ready' | 'turbo' | 'fire' | 'drop' | 'hit' | 'star') => void;
  onActorHit?: (actorId: string, item: 'banana' | 'shell' | 'homing' | 'star') => void;
};

export type RaceActor = { id: string; name: string; slot: number; pose: Pose; online?: boolean; finish?: number | null };
export type LocalItemRacer = { id: string; kart: Kart; place: number; before?: TrackPosition };
type LocalItemField = { playerActive: boolean; bots: readonly LocalItemRacer[] };
type HitItem = 'banana' | 'shell' | 'homing' | 'star';
type Inventory = {
  held: PowerupId | null;
  rolling: { timer: number; tick: number; display: PowerupId; final: PowerupId } | null;
};

const HID = /^[a-zA-Z0-9_-]{1,24}$/;

export function validItemEvent(value: unknown, track: Circuit = RED_BASIN): value is ItemEvent {
  if (!value || typeof value !== 'object') return false;
  const e = value as Record<string, unknown>;
  if (e.kind === 'pickup') {
    return typeof e.box === 'number' && Number.isInteger(e.box) && e.box >= 0 && e.box < BOX_SPOTS.length;
  }
  if (e.kind === 'drop') {
    return e.item === 'banana'
      && typeof e.hid === 'string' && HID.test(e.hid)
      && typeof e.s === 'number' && Number.isFinite(e.s) && e.s >= -0.05 && e.s <= 4
      && typeof e.lane === 'number' && Number.isFinite(e.lane) && Math.abs(e.lane) <= track.width / 2
      && e.ttl === undefined;
  }
  if (e.kind === 'fire') {
    return (e.item === 'shell' || e.item === 'homing')
      && typeof e.hid === 'string' && HID.test(e.hid)
      && typeof e.s === 'number' && Number.isFinite(e.s) && e.s >= -0.05 && e.s <= 4
      && typeof e.lane === 'number' && Number.isFinite(e.lane) && Math.abs(e.lane) <= track.width / 2
      && typeof e.laneVel === 'number' && Number.isFinite(e.laneVel) && Math.abs(e.laneVel) <= 20
      && (e.target === undefined || (typeof e.target === 'string' && HID.test(e.target)));
  }
  if (e.kind === 'star') return true;
  if (e.kind === 'hit') {
    return typeof e.target === 'string' && HID.test(e.target)
      && (e.hid === undefined || (typeof e.hid === 'string' && HID.test(e.hid)))
      && (e.item === 'banana' || e.item === 'shell' || e.item === 'homing' || e.item === 'star');
  }
  return false;
}

export function rollPowerup(place: number, total: number, solo: boolean, rand: () => number = Math.random): PowerupId {
  const weights: [PowerupId, number][] = solo || total <= 1
    ? [['turbo', 28], ['banana', 20], ['shell', 22], ['homing', 14], ['star', 16]]
    : place <= 1
      ? [['banana', 42], ['turbo', 33], ['shell', 25]]
      : place >= Math.max(2, total - 1)
        ? [['star', 30], ['homing', 32], ['turbo', 28], ['shell', 10]]
        : [['turbo', 28], ['shell', 24], ['homing', 24], ['banana', 16], ['star', 8]];

  const sum = weights.reduce((acc, [, w]) => acc + w, 0);
  let pick = rand() * sum;
  for (const [id, w] of weights) {
    pick -= w;
    if (pick <= 0) return id;
  }
  return weights[weights.length - 1][0];
}

function trackDistance(sA: number, sB: number, length: number) {
  return Math.abs(delta(wrap(sA) - wrap(sB))) * length;
}

type TrackPosition = Pick<Kart, 's' | 'lane'>;

function crossesBox(from: TrackPosition, to: TrackPosition, box: TrackPosition, length: number) {
  const travel = (to.s - from.s) * length;
  const start = delta((from.s + to.s) / 2 - box.s) * length - travel / 2;
  const axis = (offset: number, movement: number, halfWidth: number) => {
    if (movement === 0) return Math.abs(offset) < halfWidth ? [0, 1] : [1, 0];
    const a = (-halfWidth - offset) / movement;
    const b = (halfWidth - offset) / movement;
    return [Math.min(a, b), Math.max(a, b)];
  };
  const [enterS, exitS] = axis(start, travel, 2.2);
  const [enterLane, exitLane] = axis(from.lane - box.lane, to.lane - from.lane, 1.85);
  return Math.max(0, enterS, enterLane) < Math.min(1, exitS, exitLane);
}

function findAheadTarget(localId: string, localS: number, actors: RaceActor[]): string | undefined {
  let bestId: string | undefined;
  let bestGap = Infinity;
  for (const a of actors) {
    if (a.id === localId || a.online === false || a.finish != null) continue;
    const forward = wrap(a.pose[0] - localS);
    if (forward > 0.004 && forward < 0.65 && forward < bestGap) {
      bestGap = forward;
      bestId = a.id;
    }
  }
  return bestId;
}

let seq = 0;
function nextHid(prefix: string) {
  return `${prefix}${++seq}_${Math.floor(Math.random() * 1e5).toString(36)}`;
}

export class PowerupState {
  boxes: ItemBox[] = [];
  hazards: Hazard[] = [];
  projectiles: Projectile[] = [];
  held: PowerupId | null = null;
  rolling: Inventory['rolling'] = null;
  banner: { text: string; color: string; timer: number } | null = null;
  readonly effects = new Map<string, KartFx>();
  private readonly botItems = new Map<string, Inventory>();

  constructor() {
    this.reset();
  }

  reset() {
    this.boxes = BOX_SPOTS.map((b, id) => ({ id, s: b.s, lane: b.lane, cooldown: 0 }));
    this.hazards = [];
    this.projectiles = [];
    this.held = null;
    this.rolling = null;
    this.banner = null;
    this.effects.clear();
    this.botItems.clear();
  }

  get displayItem(): PowerupId | null {
    return this.rolling ? this.rolling.display : this.held;
  }

  announce(text: string, color: string, duration = 1.6) {
    this.banner = { text, color, timer: duration };
  }

  fxOf(id: string): KartFx {
    return this.effects.get(id) ?? { star: 0, spin: 0 };
  }

  botInventory(id: string): Readonly<Inventory> | undefined {
    return this.botItems.get(id);
  }

  stepSpectator(dt: number, actors: RaceActor[], track: Circuit = RED_BASIN) {
    for (const b of this.boxes) {
      if (b.cooldown > 0) b.cooldown = Math.max(0, b.cooldown - dt);
    }
    if (this.banner) {
      this.banner.timer -= dt;
      if (this.banner.timer <= 0) this.banner = null;
    }
    for (const [id, fx] of this.effects) {
      fx.star = Math.max(0, fx.star - dt);
      fx.spin = Math.max(0, fx.spin - dt);
      if (fx.star === 0 && fx.spin === 0) this.effects.delete(id);
    }
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i];
      h.age += dt;
      h.ttl -= dt;
      if (h.ttl <= 0) this.hazards.splice(i, 1);
    }
    const wall = track.width / 2 - 1.05;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.age += dt;
      p.ttl -= dt;
      if (p.ttl <= 0) {
        this.projectiles.splice(i, 1);
        continue;
      }
      p.s += (p.speed * dt) / track.length;
      if (p.kind === 'homing') {
        let target = p.target ? actors.find(a => a.id === p.target && a.online !== false && a.finish == null) : undefined;
        if (!target) {
          const aheadId = findAheadTarget(p.owner, p.s, actors);
          if (aheadId) {
            p.target = aheadId;
            target = actors.find(a => a.id === aheadId);
          }
        }
        if (target) {
          const diff = target.pose[1] - p.lane;
          p.lane += clamp(diff * 5.2, -14, 14) * dt;
        }
      } else {
        p.lane += p.laneVel * dt;
        if (Math.abs(p.lane) > wall) {
          p.lane = clamp(p.lane, -wall, wall);
          p.laneVel = -p.laneVel;
        }
      }
      p.lane = clamp(p.lane, -wall, wall);
    }
  }

  step(
    dt: number,
    localId: string,
    local: Kart,
    actors: RaceActor[],
    place: number,
    total: number,
    solo: boolean,
    cb: PowerupCallbacks = {},
    rand: () => number = Math.random,
    track: Circuit = RED_BASIN,
    before: TrackPosition = local,
    field?: LocalItemField
  ) {
    for (const b of this.boxes) {
      if (b.cooldown > 0) b.cooldown = Math.max(0, b.cooldown - dt);
    }

    if (this.banner) {
      this.banner.timer -= dt;
      if (this.banner.timer <= 0) this.banner = null;
    }

    for (const [id, fx] of this.effects) {
      fx.star = Math.max(0, fx.star - dt);
      fx.spin = Math.max(0, fx.spin - dt);
      if (fx.star === 0 && fx.spin === 0) this.effects.delete(id);
    }
    const participants: LocalItemRacer[] = field?.playerActive === false ? [] : [{ id: localId, kart: local, place, before }];
    participants.push(...field?.bots ?? []);
    for (const racer of participants) {
      const { id, kart } = racer;
      if (kart.star > 0 || kart.spin > 0) this.effects.set(id, { star: kart.star, spin: kart.spin });
      else this.effects.delete(id);
      const isPlayer = id === localId;
      let inventory = isPlayer ? this : this.botItems.get(id);
      if (!inventory) {
        inventory = { held: null, rolling: null };
        this.botItems.set(id, inventory);
      }
      this.stepInventory(inventory, racer, dt, total, solo, rand, track, isPlayer ? cb : {});
    }
    const targets: { id: string; s: number; lane: number; kart?: Kart }[] =
      participants.map(({ id, kart }) => ({ id, s: kart.s, lane: kart.lane, kart }));
    if (!field && cb.onActorHit) {
      for (const actor of actors) {
        if (actor.id !== localId && actor.online !== false && actor.finish == null) {
          targets.push({ id: actor.id, s: actor.pose[0], lane: actor.pose[1], kart: undefined });
        }
      }
    }
    const hit = (target: (typeof targets)[number], item: HitItem, owner: string, hid?: string) => {
      if (target.id === localId) this.hitLocal(localId, local, item, hid, cb);
      else if (target.kart) {
        if (this.hitKart(target.id, target.kart) && owner === localId) cb.sfx?.('hit');
      }
      else {
        this.effects.set(target.id, { star: 0, spin: SPIN_DURATION });
        cb.onActorHit?.(target.id, item);
        cb.sfx?.('hit');
      }
    };

    // Update hazards
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i];
      h.age += dt;
      h.ttl -= dt;
      if (h.ttl <= 0) {
        this.hazards.splice(i, 1);
        continue;
      }
      const target = targets.find(a => !(h.owner === a.id && h.age < 0.65)
        && trackDistance(a.s, h.s, track.length) < 2.1 && Math.abs(a.lane - h.lane) < 1.55);
      if (target) {
        this.hazards.splice(i, 1);
        hit(target, 'banana', h.owner, h.id);
      }
    }

    // Update projectiles
    const wall = track.width / 2 - 1.05;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.age += dt;
      p.ttl -= dt;
      if (p.ttl <= 0) {
        this.projectiles.splice(i, 1);
        continue;
      }
      p.s += (p.speed * dt) / track.length;

      if (p.kind === 'homing') {
        let target = p.target ? actors.find(a => a.id === p.target && a.online !== false && a.finish == null) : undefined;
        if (!target) {
          const aheadId = findAheadTarget(p.owner, p.s, actors);
          if (aheadId) {
            p.target = aheadId;
            target = actors.find(a => a.id === aheadId);
          }
        }
        if (target) {
          const diff = target.pose[1] - p.lane;
          p.lane += clamp(diff * 5.2, -14, 14) * dt;
        }
      } else {
        p.lane += p.laneVel * dt;
        if (Math.abs(p.lane) > wall) {
          p.lane = clamp(p.lane, -wall, wall);
          p.laneVel = -p.laneVel;
        }
      }
      p.lane = clamp(p.lane, -wall, wall);

      const target = targets.find(a => !(p.owner === a.id && p.age < 0.4)
        && trackDistance(a.s, p.s, track.length) < 2.4 && Math.abs(a.lane - p.lane) < 1.65);
      if (target) {
        this.projectiles.splice(i, 1);
        hit(target, p.kind, p.owner, p.id);
      }
    }

    const stars = field ? targets.filter(a => (a.kart?.star ?? 0) > 0)
      : local.star > 0 ? targets.filter(a => a.id === localId)
      : actors.filter(a => a.id !== localId && a.online !== false && a.finish == null && this.fxOf(a.id).star > 0)
        .map(a => ({ id: a.id, s: a.pose[0], lane: a.pose[1] }));
    if (!stars.length) return;
    const starPoints = stars.map(a => ({ id: a.id, point: track.point(a.s, a.lane) }));
    for (const target of targets) {
      if ((!field && local.star <= 0 && target.id !== localId) || this.fxOf(target.id).spin > 0) continue;
      const point = track.point(target.s, target.lane);
      const source = starPoints.find(a => a.id !== target.id && kartContactDistance(point, a.point) !== null);
      if (source) hit(target, 'star', source.id);
    }
  }

  private stepInventory(inventory: Inventory, racer: LocalItemRacer, dt: number, total: number, solo: boolean,
    rand: () => number, track: Circuit, cb: PowerupCallbacks) {
    const { kart, place, before = kart } = racer;
    if (inventory.rolling) {
      const roll = inventory.rolling;
      roll.timer -= dt;
      roll.tick -= dt;
      if (roll.timer <= 0) {
        inventory.held = roll.final;
        inventory.rolling = null;
        cb.sfx?.('ready');
      } else if (roll.tick <= 0) {
        roll.display = POWERUP_LIST[(POWERUP_LIST.indexOf(roll.display) + 1) % POWERUP_LIST.length];
        roll.tick = .085;
        cb.sfx?.('roulette');
      }
    }
    const box = this.boxes.find(b => b.cooldown <= 0 && crossesBox(before, kart, b, track.length));
    if (!box) return;
    box.cooldown = BOX_RESPAWN;
    cb.emit?.({ kind: 'pickup', box: box.id });
    if (!inventory.held && !inventory.rolling) {
      inventory.rolling = { timer: ROULETTE_TIME, tick: .07, display: POWERUP_LIST[0], final: rollPowerup(place, total, solo, rand) };
      cb.sfx?.('pickup');
    }
  }

  private hitKart(id: string, kart: Kart) {
    if (kart.star > 0 || kart.spin > 0) return false;
    kart.spin = SPIN_DURATION;
    kart.boost = 0;
    kart.turbo = 0;
    kart.drift = 0;
    kart.speed = Math.min(kart.speed, 14);
    this.effects.set(id, { star: 0, spin: kart.spin });
    return true;
  }

  private hitLocal(localId: string, local: Kart, item: HitItem, hid: string | undefined, cb: PowerupCallbacks) {
    if (local.star > 0) {
      if (hid) cb.emit?.({ kind: 'hit', target: localId, hid, item });
      return;
    }
    if (!this.hitKart(localId, local)) return;
    const label = item === 'banana' ? 'SLIPPED ON PEEL' : item === 'homing' ? 'HIT BY HOMING SHELL' : item === 'star' ? 'BUMPED BY STAR' : 'HIT BY SHELL';
    this.announce(label, '#ec583b', 1.5);
    cb.sfx?.('hit');
    cb.emit?.({ kind: 'hit', target: localId, hid, item });
  }

  useItem(localId: string, local: Kart, actors: RaceActor[], cb: PowerupCallbacks = {}, track: Circuit = RED_BASIN): PowerupId | null {
    return this.useInventory(localId, local, this, actors, cb, track);
  }

  useBotItem(id: string, kart: Kart, actors: RaceActor[], track: Circuit): PowerupId | null {
    const inventory = this.botItems.get(id);
    return inventory ? this.useInventory(id, kart, inventory, actors, {}, track) : null;
  }

  private useInventory(localId: string, local: Kart, inventory: Inventory, actors: RaceActor[], cb: PowerupCallbacks, track: Circuit): PowerupId | null {
    if (inventory.rolling || !inventory.held || local.spin > 0) return null;
    const item = inventory.held;
    inventory.held = null;

    if (item === 'turbo') {
      local.turbo = 1.95;
      local.boost = Math.max(local.boost, local.turbo);
      local.speed = Math.max(local.speed, 54);
      if (inventory === this) this.announce('TURBO BOOST', POWERUPS.turbo.color, 1.2);
      cb.sfx?.('turbo');
      return item;
    }

    if (item === 'star') {
      local.star = STAR_DURATION;
      local.spin = 0;
      local.boost = Math.max(local.boost, 1.4);
      local.speed = Math.max(local.speed, 52);
      this.effects.set(localId, { star: STAR_DURATION, spin: 0 });
      if (inventory === this) this.announce('STAR POWER', POWERUPS.star.color, 1.6);
      cb.sfx?.('star');
      cb.emit?.({ kind: 'star' });
      return item;
    }

    if (item === 'banana') {
      const hid = nextHid('b');
      const s = wrap(local.s - 3.2 / track.length);
      const lane = clamp(local.lane, -(track.width / 2 - 1.1), track.width / 2 - 1.1);
      this.hazards.push({ id: hid, owner: localId, kind: 'banana', s, lane, age: 0, ttl: 45 });
      if (this.hazards.length > 24) this.hazards.shift();
      cb.sfx?.('drop');
      cb.emit?.({ kind: 'drop', item: 'banana', hid, s, lane });
      return item;
    }

    if (item === 'shell' || item === 'homing') {
      const hid = nextHid('s');
      const s = wrap(local.s + 2.8 / track.length);
      const lane = clamp(local.lane, -(track.width / 2 - 1.1), track.width / 2 - 1.1);
      const laneVel = item === 'shell' ? clamp(local.steer * 6.5, -6, 6) : 0;
      const target = item === 'homing' ? findAheadTarget(localId, local.s, actors) : undefined;
      const speed = item === 'homing' ? 74 : 72;
      this.projectiles.push({ id: hid, owner: localId, kind: item, s, lane, laneVel, speed, target, age: 0, ttl: 6.5 });
      if (this.projectiles.length > 16) this.projectiles.shift();
      cb.sfx?.('fire');
      cb.emit?.({ kind: 'fire', item, hid, s, lane, laneVel, target });
      return item;
    }

    return item;
  }

  applyRemote(from: string, event: ItemEvent) {
    if (event.kind === 'pickup') {
      const box = this.boxes[event.box];
      if (box) box.cooldown = BOX_RESPAWN;
      return;
    }
    if (event.kind === 'drop') {
      this.hazards.push({ id: event.hid, owner: from, kind: 'banana', s: event.s, lane: event.lane, age: 0, ttl: event.ttl ?? 45 });
      if (this.hazards.length > 24) this.hazards.shift();
      return;
    }
    if (event.kind === 'fire') {
      const speed = event.item === 'homing' ? 74 : 72;
      this.projectiles.push({
        id: event.hid, owner: from, kind: event.item,
        s: event.s, lane: event.lane, laneVel: event.laneVel,
        speed, target: event.target, age: 0, ttl: 6.5
      });
      if (this.projectiles.length > 16) this.projectiles.shift();
      return;
    }
    if (event.kind === 'star') {
      const cur = this.effects.get(from) ?? { star: 0, spin: 0 };
      cur.star = STAR_DURATION;
      cur.spin = 0;
      this.effects.set(from, cur);
      return;
    }
    if (event.kind === 'hit') {
      if (event.hid) {
        this.hazards = this.hazards.filter(h => h.id !== event.hid);
        this.projectiles = this.projectiles.filter(p => p.id !== event.hid);
      }
      const cur = this.effects.get(event.target) ?? { star: 0, spin: 0 };
      if (cur.star <= 0) {
        cur.spin = SPIN_DURATION;
        this.effects.set(event.target, cur);
      }
    }
  }
}
