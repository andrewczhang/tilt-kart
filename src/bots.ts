import { COLORS, LAPS, LIMIT, RED_BASIN, clamp, delta, getTrack, mix, wrap, type Circuit } from './circuit';
import { drive, grid, pose, type Input, type Kart } from './drive';
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

  private canShift(kart: Kart, lane: number, rivals: Rival[]) {
    const lo = Math.min(kart.lane, lane) - 1.45;
    const hi = Math.max(kart.lane, lane) + 1.45;
    return !rivals.some(rival => {
      const predicted = rival.gap + (rival.speed - kart.speed) * .4;
      return Math.min(rival.gap, predicted) < 5 && Math.max(rival.gap, predicted) > -5
        && rival.lane >= lo && rival.lane <= hi;
    });
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
      if (front && front.gap > 5.5 && front.gap < 22 && front.speed < Math.max(kart.speed, pace) - .9) {
        const candidates = [front.lane - 2.9, front.lane + 2.9]
          .filter(lane => Math.abs(lane) <= safeLane && this.canShift(kart, lane, rivals));
        candidates.sort((a, b) => Math.abs(a - kart.lane) + .35 * Math.abs(a - target) - Math.abs(b - kart.lane) - .35 * Math.abs(b - target));
        if (candidates.length) this.maneuver = { kind: 'pass', rival: front.id, lane: candidates[0], until: time + 2.6 };
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
    if (this.maneuver) target = this.canShift(kart, this.maneuver.lane, rivals) ? this.maneuver.lane : kart.lane;
    else if (!this.canShift(kart, target, rivals)) target = kart.lane;
    if (front && front.gap < 7) pace = Math.min(pace, front.speed + Math.max(0, front.gap - 3));
    return { target, pace, following: !!front && front.gap < 4.2 && kart.speed > front.speed + 2.5 };
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
    const { target, pace, following } = this.position(kart, time, clamp(lineTarget, -safeLane, safeLane), desiredPace, rivals);
    const bend = clamp(delta(track.frame(kart.s + .004).heading - track.frame(kart.s).heading, 2 * Math.PI) / .21, -1, 1);
    let steer = clamp((target - kart.lane) * .48 + bend * .34, -1, 1);
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
    if (drifting) steer = this.driftSign * clamp(steer * this.driftSign, .33, .52);
    else this.driftUntil = 0;
    const heavyBrake = severity > 1.08 && kart.speed > pace + 5 && Math.abs(steer) < .22;
    return { steer: following ? clamp(steer, -.19, .19) : steer, gas: kart.speed < pace, brake: following || drifting || heavyBrake };
  }
}

function stepRacer(entry: Driver, kart: Kart, input: Input, dt: number, elapsed: number, track: Circuit) {
  if (entry.finish !== null) return false;
  const before = kart.s;
  drive(kart, input, dt, track);
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
  private readonly bots: { entry: Driver; kart: Kart; pilot: BotPilot }[];

  private readonly track: Circuit;

  constructor(readonly racers: number, start: number, singleTrack = RED_BASIN, cup?: Cup, readonly difficulty: Difficulty = 'Normal') {
    const track = this.track = cup ? getTrack(cupTrack(cup)) : singleTrack;
    this.human = driver('solo', racers === 1 ? 'Practice' : 'Player', racers - 1, track);
    this.kart = grid(this.human.slot, track);
    this.bots = names.slice(0, racers - 1).map((name, slot) => ({
      entry: driver(`bot-${slot}`, `${name} (bot)`, slot, track), kart: grid(slot, track),
      pilot: new BotPilot(track, slot, difficulty),
    }));
    this.room = { host: this.human.id, start, complete: false, track: track.id, cup, drivers: [...this.bots.map(bot => bot.entry), this.human] };
  }

  hitBot(id: string, duration = 1.15) {
    const bot = this.bots.find(b => b.entry.id === id);
    if (!bot || bot.kart.spin > 0) return;
    bot.kart.spin = duration;
    bot.kart.boost = 0;
    bot.kart.drift = 0;
    bot.kart.speed = Math.min(bot.kart.speed, 14);
  }

  step(input: Input, dt: number, elapsed: number) {
    if (elapsed < 0 || this.room.complete) return false;
    const end = Math.min(elapsed, LIMIT);
    const raceDt = Math.max(0, Math.min(dt, (end - Math.max(0, elapsed - dt * 1000)) / 1000));
    let changed = false;
    if (raceDt > 0) {
      const botInputs = this.bots.map(({ kart, pilot, entry }) => entry.finish === null ? pilot.input(kart, end, this.room.drivers) : undefined);
      changed = stepRacer(this.human, this.kart, input, raceDt, end, this.track);
      for (const [i, { entry, kart }] of this.bots.entries()) {
        const controls = botInputs[i];
        if (controls && stepRacer(entry, kart, controls, raceDt, end, this.track)) changed = true;
      }
    }
    this.room.complete = elapsed >= LIMIT || this.room.drivers.every(entry => entry.finish !== null);
    if (this.room.complete && this.room.cup) this.room.cup = scoreRound(this.room.cup, this.room.drivers);
    return changed || this.room.complete;
  }
}
