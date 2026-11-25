import { COUNTDOWN, type Circuit } from './circuit';
import { drive, grid, type Input, type Pose } from './drive';
import { blendPose, encodeGhost, GHOST_INTERVAL, MAX_LAP_MS, type Replay } from './ghost';

export class TimeTrial {
  readonly kart;
  readonly start: number;
  elapsed = 0;
  finished = false;
  replay?: Replay;
  private readonly samples: Pose[];

  constructor(readonly track: Circuit, now: number) {
    this.start = now + COUNTDOWN;
    this.kart = { ...grid(0, track), s: 0, lane: 0, speed: 42 };
    this.samples = [this.snapshot()];
  }

  step(input: Input, now: number) {
    if (this.finished || now <= this.start) return;
    const end = now - this.start;
    const previous = this.elapsed;
    if (end <= previous) return;
    const before = this.snapshot();
    drive(this.kart, input, Math.min(.05, (end - previous) / 1000), this.track);
    let after = this.snapshot();
    let elapsed = end;
    if (after[0] >= 1) {
      const fraction = (1 - before[0]) / (after[0] - before[0]);
      elapsed = previous + (end - previous) * fraction;
      after = blendPose(before, after, fraction);
      after[0] = this.kart.s = 1;
      this.finished = true;
    }
    if (elapsed > MAX_LAP_MS) {
      this.elapsed = MAX_LAP_MS;
      this.finished = true;
      return;
    }
    this.elapsed = this.finished ? Math.ceil(elapsed) : elapsed;
    while (this.samples.length * GHOST_INTERVAL < this.elapsed) {
      const at = this.samples.length * GHOST_INTERVAL;
      this.samples.push(blendPose(before, after, (at - previous) / (elapsed - previous)));
    }
    if (this.finished) {
      this.samples.push(after);
      this.replay = { lapMs: this.elapsed, ghost: encodeGhost(this.samples) };
    }
  }

  private snapshot(): Pose {
    const { s, lane, yaw, speed, drift, boost } = this.kart;
    return [s, lane, yaw, speed, drift, boost];
  }
}
