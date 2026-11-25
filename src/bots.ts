import { COLORS, LAPS, LIMIT, RED_BASIN, clamp, delta, mix, type Circuit } from './circuit';
import { drive, grid, pose, type Input, type Kart } from './drive';
import { advance, driver, type Driver, type RoomState } from './rules';

export const MAX_RACERS = COLORS.length;
const names = ['Comet', 'Dusty', 'Nitro', 'Swerve', 'Blaze', 'Dash', 'Drift'];

function botInput(kart: Kart, slot: number, { frame }: Circuit): Input {
  const phase = slot * 2.4;
  const look = kart.s + .006;
  const bend = clamp(delta(frame(look).heading - frame(kart.s).heading, 2 * Math.PI) / .3, -1, 1);
  const line = (slot - 3) * 1.13 + 1.2 * Math.sin(look * 6 * Math.PI + phase);
  const pace = 40 - slot * .65 + 1.9 * Math.sin(look * 4 * Math.PI + phase) - 3 * Math.abs(bend);
  return {
    steer: clamp((line - kart.lane) * .55 + bend * .34, -1, 1),
    gas: kart.speed < pace,
    brake: false,
  };
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
  private readonly bots: { entry: Driver; kart: Kart }[];

  constructor(readonly racers: number, start: number, private readonly track = RED_BASIN) {
    this.human = driver('solo', racers === 1 ? 'Practice' : 'Player', racers - 1, track);
    this.kart = grid(this.human.slot, track);
    this.bots = names.slice(0, racers - 1).map((name, slot) => ({
      entry: driver(`bot-${slot}`, `${name} (bot)`, slot, track), kart: grid(slot, track),
    }));
    this.room = { host: this.human.id, start, complete: false, track: track.id, drivers: [...this.bots.map(bot => bot.entry), this.human] };
  }

  step(input: Input, dt: number, elapsed: number) {
    if (elapsed < 0 || this.room.complete) return false;
    const end = Math.min(elapsed, LIMIT);
    const raceDt = Math.max(0, Math.min(dt, (end - Math.max(0, elapsed - dt * 1000)) / 1000));
    let changed = false;
    if (raceDt > 0) {
      changed = stepRacer(this.human, this.kart, input, raceDt, end, this.track);
      for (const { entry, kart } of this.bots) {
        if (stepRacer(entry, kart, botInput(kart, entry.slot, this.track), raceDt, end, this.track)) changed = true;
      }
    }
    this.room.complete = elapsed >= LIMIT || this.room.drivers.every(entry => entry.finish !== null);
    return changed || this.room.complete;
  }
}
