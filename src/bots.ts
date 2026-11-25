import { COLORS, LAPS, LIMIT, RED_BASIN, clamp, delta, getTrack, mix, wrap, type Circuit } from './circuit';
import { bump, drive, grid, pose, substep, type Input, type Kart } from './drive';
import { cupTrack, scoreRound, type Cup } from './cups';
import { advance, driver, type Driver, type RoomState } from './rules';

export const MAX_RACERS = COLORS.length;
export const DIFFICULTIES = ['Easy', 'Normal', 'Hard'] as const;
export type Difficulty = typeof DIFFICULTIES[number];
const tuning = {
  Easy: { pace: 32, line: .53, error: 1.25, reaction: .42, drift: .70, pads: .1 },
  Normal: { pace: 38, line: .83, error: .65, reaction: .21, drift: .52, pads: .57 },
  Hard: { pace: 42.5, line: 1, error: .23, reaction: .10, drift: .40, pads: 1 },
} satisfies Record<Difficulty, Record<string, number>>;
const names = ['Comet', 'Dusty', 'Nitro', 'Swerve', 'Blaze', 'Dash', 'Drift'];
const CREEP_CLEARANCE = 2.5;

type LineSample = { bend: number; lane: number };
const lines = new WeakMap<Circuit, LineSample[]>();

function racingLine(track: Circuit) {
  const cached = lines.get(track);
  if (cached) return cached;
  const size = Math.ceil(track.length / 2);
  const turn = (s: number) => delta(track.frame(s + 9 / track.length).heading - track.frame(s - 9 / track.length).heading, 2 * Math.PI) / .47;
  const line = Array.from({ length: size }, (_, i) => {
    const s = i / size;
    const bend = turn(s);
    const shoulders = turn(s - 22 / track.length) + turn(s + 22 / track.length);
    return { bend, lane: track.width * .29 * clamp(1.85 * bend - .76 * shoulders, -1, 1) };
  });
  lines.set(track, line);
  return line;
}

function lineAt(line: LineSample[], s: number) {
  const x = wrap(s) * line.length;
  const i = Math.floor(x) % line.length;
  const a = line[i], b = line[(i + 1) % line.length];
  return { bend: mix(a.bend, b.bend, x % 1), lane: mix(a.lane, b.lane, x % 1) };
}

type Rival = { id: string; gap: number; lane: number; speed: number };
type Maneuver = { kind: 'pass' | 'defend'; rival: string; lane: number; until: number };

export class BotPilot {
  private readonly skill;
  private readonly line;
  private readonly phase;
  private readonly safeLane;
  private driftUntil = 0;
  private driftReady = 0;
  private driftSign = 0;
  private maneuver?: Maneuver;
  private decideAt = 0;
  private defendAt = 0;
  private defended?: string;

  constructor(private readonly track: Circuit, private readonly slot: number, readonly difficulty: Difficulty) {
    this.skill = tuning[difficulty];
    this.line = racingLine(track);
    this.phase = slot * 2.4;
    this.safeLane = track.width / 2 - 1.65;
  }

  private traffic(kart: Kart, racers: Driver[]) {
    return racers.filter(racer => racer.slot !== this.slot && racer.finish === null && racer.online)
      .map(racer => ({ id: racer.id, gap: delta(racer.pose[0] - kart.s) * this.track.length, lane: racer.pose[1], speed: racer.pose[3] }))
      .filter(rival => Math.abs(rival.gap) < 26);
  }

  private canShift(kart: Kart, lane: number, rivals: Rival[], passing?: Rival) {
    const lo = Math.min(kart.lane, lane) - 1.45;
    const hi = Math.max(kart.lane, lane) + 1.45;
    return !rivals.some(rival => {
      if (rival === passing && this.canCreepPast(kart, lane, rival)) return false;
      const predicted = rival.gap + (rival.speed - kart.speed) * .4;
      return Math.min(rival.gap, predicted) < 5 && Math.max(rival.gap, predicted) > -5
        && rival.lane >= lo && rival.lane <= hi;
    });
  }

  private canCreepPast(kart: Kart, lane: number, rival: Rival) {
    const offset = lane - rival.lane;
    return rival.speed < 2 && kart.speed < 5.5 && Math.abs(offset) >= CREEP_CLEARANCE
      && (kart.lane - rival.lane) * offset >= 0;
  }

  private position(kart: Kart, time: number, target: number, pace: number, rivals: Rival[]) {
    const front = rivals.filter(rival => rival.gap > 0 && Math.abs(rival.lane - kart.lane) < 2.2)
      .reduce<Rival | undefined>((best, rival) => !best || rival.gap < best.gap ? rival : best, undefined);
    const behind = rivals.filter(rival => rival.gap < 0 && rival.speed > kart.speed + 1.15)
      .reduce<Rival | undefined>((best, rival) => !best || rival.gap > best.gap ? rival : best, undefined);
    const { safeLane } = this;
    if (this.maneuver) {
      const rival = rivals.find(candidate => candidate.id === this.maneuver?.rival);
      if (time >= this.maneuver.until || !rival || this.maneuver.kind === 'pass' && rival.gap < -5) this.maneuver = undefined;
    }
    if (behind?.id !== this.defended) this.defended = undefined;
    if (!this.maneuver && time >= this.decideAt) {
      this.decideAt = time + this.skill.reaction;
      if (front && front.gap < 22 && front.speed < Math.max(kart.speed, pace) - .9) {
        const candidates = [front.lane - 2.9, front.lane + 2.9]
          .filter(lane => Math.abs(lane) <= safeLane && this.canShift(kart, lane, rivals, front));
        candidates.sort((a, b) => Math.abs(a - kart.lane) + .35 * Math.abs(a - target) - Math.abs(b - kart.lane) - .35 * Math.abs(b - target));
        if (candidates.length) {
          const closePass = front.gap < 5 && this.canCreepPast(kart, candidates[0], front);
          this.maneuver = { kind: 'pass', rival: front.id, lane: candidates[0], until: time + (closePass ? 4.2 : 2.6) };
        }
      } else if (this.difficulty !== 'Easy' && behind && behind.gap < -10 && behind.gap > -21
        && time >= this.defendAt && behind.id !== this.defended && Math.abs(behind.lane - kart.lane) < 3.6) {
        const lane = clamp(mix(kart.lane, behind.lane, .8), -safeLane, safeLane);
        if (Math.abs(lane - kart.lane) > .6 && this.canShift(kart, lane, rivals)) {
          this.maneuver = { kind: 'defend', rival: behind.id, lane, until: time + .67 };
          this.defended = behind.id;
          this.defendAt = time + 3.5;
        }
      }
    }
    const pass = this.maneuver?.kind === 'pass' ? rivals.find(rival => rival.id === this.maneuver?.rival) : undefined;
    let maxProgress: number | undefined;
    if (this.maneuver && this.canShift(kart, this.maneuver.lane, rivals, pass)) {
      target = this.maneuver.lane;
      if (pass && pass.gap >= 0 && pass.gap < 5 && Math.abs(kart.lane - pass.lane) < CREEP_CLEARANCE
        && this.canCreepPast(kart, target, pass)) {
        maxProgress = kart.s + Math.max(0, pass.gap - CREEP_CLEARANCE) / this.track.length;
      }
    } else if (this.maneuver || !this.canShift(kart, target, rivals)) target = kart.lane;
    if (maxProgress !== undefined) pace = Math.min(pace, 4.5);
    else if (front && front.gap < 7) pace = Math.min(pace, front.speed + Math.max(0, front.gap - 3));
    return { target, pace, maxProgress, following: maxProgress === undefined && !!front && front.gap < 4.2 && kart.speed > front.speed + 2.5 };
  }

  input(kart: Kart, elapsed: number, racers: Driver[]): Input {
    const { track, skill, line, phase, slot, safeLane } = this;
    const time = elapsed / 1000;
    const look = kart.s + (3 + kart.speed * .12) / track.length;
    const here = lineAt(line, look);
    const next = lineAt(line, look + 16 / track.length);
    const severity = clamp(Math.max(Math.abs(here.bend), Math.abs(next.bend) * .85), 0, 1.5);
    let lineTarget = here.lane * skill.line + (slot - 3) * .24 + skill.error * Math.sin(kart.s * 12 * Math.PI + phase);
    for (const pad of track.pads) {
      const distance = delta(pad.s - kart.s) * track.length;
      if (distance < -4 || distance > 26) continue;
      const weight = clamp((26 - distance) / 20, 0, 1) * clamp((distance + 4) / 4, 0, 1);
      lineTarget = mix(lineTarget, pad.lane, weight * skill.pads);
      break;
    }
    const mistake = Math.max(0, Math.sin(time * .91 + phase) - .86) * skill.error * 30;
    const desiredPace = skill.pace - slot * .21 - severity * (this.difficulty === 'Hard' ? 2.8 : 4.6) - mistake;
    const rivals = this.traffic(kart, racers);
    const { target, pace, following, maxProgress } = this.position(kart, time, clamp(lineTarget, -safeLane, safeLane), desiredPace, rivals);
    const herePoint = track.point(kart.s, kart.lane);
    const aim = track.point(kart.s + (5 + kart.speed * .22) / track.length, target);
    const bearing = Math.atan2(aim.x - herePoint.x, aim.z - herePoint.z);
    const error = delta(bearing - track.frame(kart.s).heading - kart.yaw, 2 * Math.PI);
    let steer = clamp(error * 3, -1, 1);
    const direction = Math.sign(here.bend);
    const space = safeLane - kart.lane * direction;
    const startingDrift = !this.maneuver && !following && time >= this.driftReady && kart.boost === 0 && kart.speed >= 28
      && Math.abs(here.bend) >= skill.drift && steer * direction > .29 && space > 4.1;
    if (startingDrift) {
      this.driftSign = direction;
      this.driftUntil = time + .47;
      this.driftReady = time + 2.5;
    }
    const drifting = !this.maneuver && !following && time < this.driftUntil && safeLane - kart.lane * this.driftSign > 1.05
      && this.canShift(kart, kart.lane + this.driftSign * 2.2, rivals);
    if (drifting) steer = this.driftSign * clamp(steer * this.driftSign, .27, .52);
    else this.driftUntil = 0;
    const heavyBrake = severity > 1.08 && kart.speed > pace + 5 && Math.abs(steer) < .22;
    return { steer: following ? clamp(steer, -.19, .19) : steer, gas: kart.speed < pace, brake: following || drifting || heavyBrake, maxProgress };
  }
}

function judgeRacer(entry: Driver, kart: Kart, before: number, dt: number, elapsed: number, track: Circuit) {
  const crossing = kart.s > LAPS ? (LAPS - before) / (kart.s - before) : 1;
  kart.s = Math.min(kart.s, LAPS);
  const next = pose(kart);
  next[0] = kart.s;
  advance(entry, next, mix(elapsed - dt * 1000, elapsed, crossing), dt, track);
  return entry.finish !== null;
}

export class LocalRace {
  readonly human: Driver;
  readonly kart: Kart;
  readonly room: RoomState;
  private readonly field: { entry: Driver; kart: Kart; pilot?: BotPilot }[];

  private readonly track: Circuit;

  constructor(readonly racers: number, start: number, singleTrack = RED_BASIN, cup?: Cup, readonly difficulty: Difficulty = 'Normal') {
    const track = this.track = cup ? getTrack(cupTrack(cup)) : singleTrack;
    this.human = driver('solo', racers === 1 ? 'Practice' : 'Player', racers - 1, track);
    this.kart = grid(this.human.slot, track);
    const bots = names.slice(0, racers - 1).map((name, slot) => ({
      entry: driver(`bot-${slot}`, `${name} (bot)`, slot, track), kart: grid(slot, track),
      pilot: new BotPilot(track, slot, difficulty),
    }));
    this.field = [...bots, { entry: this.human, kart: this.kart }];
    this.room = { host: this.human.id, start, complete: false, track: track.id, cup, drivers: this.field.map(racer => racer.entry) };
  }

  hitBot(id: string, duration = 1.15) {
    const bot = this.field.find(({ entry }) => entry !== this.human && entry.id === id);
    if (!bot || bot.kart.spin > 0) return;
    bot.kart.spin = duration;
    bot.kart.boost = 0;
    bot.kart.turbo = 0;
    bot.kart.drift = 0;
    bot.kart.speed = Math.min(bot.kart.speed, 14);
  }

  step(input: Input, dt: number, elapsed: number) {
    if (elapsed < 0 || this.room.complete) return false;
    const end = Math.min(elapsed, LIMIT);
    const raceDt = Math.max(0, Math.min(dt, (end - Math.max(0, elapsed - dt * 1000)) / 1000));
    let changed = false;
    let time = end - raceDt * 1000;
    substep(raceDt, step => {
      time += step * 1000;
      const racing = this.field.filter(({ entry }) => entry.finish === null);
      const before = racing.map(({ kart, pilot }) => {
        const s = kart.s;
        drive(kart, pilot?.input(kart, time, this.room.drivers) ?? input, step, this.track);
        return s;
      });
      for (let i = 0; i < racing.length; i++) {
        for (let j = i + 1; j < racing.length; j++) {
          const a = racing[i].kart, b = racing[j].kart;
          if (a.star <= 0 && b.star <= 0) bump(a, b, this.track);
        }
      }
      for (const [i, { entry, kart }] of racing.entries()) {
        if (judgeRacer(entry, kart, before[i], step, time, this.track)) changed = true;
      }
    });
    this.room.complete = elapsed >= LIMIT || this.room.drivers.every(entry => entry.finish !== null);
    if (this.room.complete && this.room.cup) this.room.cup = scoreRound(this.room.cup, this.room.drivers);
    return changed || this.room.complete;
  }
}
