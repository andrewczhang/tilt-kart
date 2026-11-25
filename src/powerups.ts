import { RED_BASIN, clamp, delta, wrap, type Circuit } from './circuit';
import type { Kart, Pose } from './drive';

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
  rolling: { timer: number; tick: number; display: PowerupId; final: PowerupId } | null = null;
  banner: { text: string; color: string; timer: number } | null = null;
  readonly effects = new Map<string, KartFx>();

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
    track: Circuit = RED_BASIN
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
    if (local.star > 0 || local.spin > 0) {
      this.effects.set(localId, { star: local.star, spin: local.spin });
    } else {
      this.effects.delete(localId);
    }

    if (this.rolling) {
      this.rolling.timer -= dt;
      this.rolling.tick -= dt;
      if (this.rolling.timer <= 0) {
        this.held = this.rolling.final;
        this.rolling = null;
        cb.sfx?.('ready');
      } else if (this.rolling.tick <= 0) {
        const idx = (POWERUP_LIST.indexOf(this.rolling.display) + 1) % POWERUP_LIST.length;
        this.rolling.display = POWERUP_LIST[idx];
        this.rolling.tick = 0.085;
        cb.sfx?.('roulette');
      }
    }

    // Box pickup check for local kart
    for (const b of this.boxes) {
      if (b.cooldown > 0) continue;
      if (trackDistance(local.s, b.s, track.length) < 2.2 && Math.abs(local.lane - b.lane) < 1.85) {
        b.cooldown = BOX_RESPAWN;
        cb.emit?.({ kind: 'pickup', box: b.id });
        if (!this.held && !this.rolling) {
          const final = rollPowerup(place, total, solo, rand);
          this.rolling = { timer: ROULETTE_TIME, tick: 0.07, display: POWERUP_LIST[0], final };
          cb.sfx?.('pickup');
        }
        break;
      }
    }

    // Update hazards
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i];
      h.age += dt;
      h.ttl -= dt;
      if (h.ttl <= 0) {
        this.hazards.splice(i, 1);
        continue;
      }
      if (!(h.owner === localId && h.age < 0.65) && trackDistance(local.s, h.s, track.length) < 2.1 && Math.abs(local.lane - h.lane) < 1.55) {
        this.hazards.splice(i, 1);
        this.hitLocal(localId, local, 'banana', h.id, cb);
        continue;
      }
      if (cb.onActorHit) {
        for (const a of actors) {
          if (a.id === localId || a.online === false || a.finish != null || (h.owner === a.id && h.age < 0.65)) continue;
          if (trackDistance(a.pose[0], h.s, track.length) < 2.1 && Math.abs(a.pose[1] - h.lane) < 1.55) {
            this.hazards.splice(i, 1);
            this.effects.set(a.id, { star: 0, spin: SPIN_DURATION });
            cb.onActorHit(a.id, 'banana');
            cb.sfx?.('hit');
            break;
          }
        }
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

      // Check collision with local kart
      if (!(p.owner === localId && p.age < 0.4) && trackDistance(local.s, p.s, track.length) < 2.4 && Math.abs(local.lane - p.lane) < 1.65) {
        this.projectiles.splice(i, 1);
        this.hitLocal(localId, local, p.kind, p.id, cb);
        continue;
      }
      if (cb.onActorHit) {
        for (const a of actors) {
          if (a.id === localId || a.online === false || a.finish != null || (p.owner === a.id && p.age < 0.4)) continue;
          if (trackDistance(a.pose[0], p.s, track.length) < 2.4 && Math.abs(a.pose[1] - p.lane) < 1.65) {
            this.projectiles.splice(i, 1);
            this.effects.set(a.id, { star: 0, spin: SPIN_DURATION });
            cb.onActorHit(a.id, p.kind);
            cb.sfx?.('hit');
            break;
          }
        }
      }
    }

    // Star-powered bump check (local starred bumps bots; remote starred bumps local)
    if (local.star > 0 && cb.onActorHit) {
      for (const a of actors) {
        if (a.id === localId || a.online === false || a.finish != null) continue;
        if (this.fxOf(a.id).spin > 0) continue;
        if (trackDistance(local.s, a.pose[0], track.length) < 2.6 && Math.abs(local.lane - a.pose[1]) < 1.9) {
          this.effects.set(a.id, { star: 0, spin: SPIN_DURATION });
          cb.onActorHit(a.id, 'star');
          cb.sfx?.('hit');
        }
      }
    } else if (local.star <= 0 && local.spin <= 0) {
      for (const a of actors) {
        if (a.id === localId || a.online === false) continue;
        const fx = this.effects.get(a.id);
        if (!fx || fx.star <= 0) continue;
        if (trackDistance(local.s, a.pose[0], track.length) < 2.6 && Math.abs(local.lane - a.pose[1]) < 1.9) {
          this.hitLocal(localId, local, 'star', undefined, cb);
          break;
        }
      }
    }
  }

  private hitLocal(localId: string, local: Kart, item: 'banana' | 'shell' | 'homing' | 'star', hid: string | undefined, cb: PowerupCallbacks) {
    if (local.star > 0) {
      if (hid) cb.emit?.({ kind: 'hit', target: localId, hid, item });
      return;
    }
    if (local.spin > 0) return;
    local.spin = SPIN_DURATION;
    local.boost = 0;
    local.turbo = 0;
    local.drift = 0;
    local.speed = Math.min(local.speed, 14);
    const label = item === 'banana' ? 'SLIPPED ON PEEL' : item === 'homing' ? 'HIT BY HOMING SHELL' : item === 'star' ? 'BUMPED BY STAR' : 'HIT BY SHELL';
    this.announce(label, '#ec583b', 1.5);
    cb.sfx?.('hit');
    cb.emit?.({ kind: 'hit', target: localId, hid, item });
  }

  useItem(localId: string, local: Kart, actors: RaceActor[], cb: PowerupCallbacks = {}, track: Circuit = RED_BASIN): PowerupId | null {
    if (this.rolling || !this.held || local.spin > 0) return null;
    const item = this.held;
    this.held = null;

    if (item === 'turbo') {
      local.turbo = 1.95;
      local.boost = Math.max(local.boost, local.turbo);
      local.speed = Math.max(local.speed, 54);
      this.announce('TURBO BOOST', POWERUPS.turbo.color, 1.2);
      cb.sfx?.('turbo');
      return item;
    }

    if (item === 'star') {
      local.star = STAR_DURATION;
      local.spin = 0;
      local.boost = Math.max(local.boost, 1.4);
      local.speed = Math.max(local.speed, 52);
      this.effects.set(localId, { star: STAR_DURATION, spin: 0 });
      this.announce('STAR POWER', POWERUPS.star.color, 1.6);
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
