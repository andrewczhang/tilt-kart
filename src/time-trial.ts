import { COUNTDOWN, type Circuit } from './circuit';
import { drive, grid, type Input, type Pose } from './drive';
import { blendPose, encodeGhost, GHOST_INTERVAL, MAX_LAP_MS, type Replay } from './ghost';

const STEP_MS = 10;
const MAX_FRAME_GAP_MS = 1000;

export class TimeTrial {
  readonly kart;
  readonly start: number;
  elapsed = 0;
  finished = false;
  interrupted = false;
  replay?: Replay;
  private lastFrame: number;
  private lastInput?: Input;
  private simulatedMs = 0;
  private readonly samples: Pose[];

  constructor(readonly track: Circuit, now: number) {
    this.start = now + COUNTDOWN;
    this.lastFrame = this.start;
    this.kart = { ...grid(0, track), s: 0, lane: 0, speed: 42 };
    this.samples = [this.snapshot()];
  }

  step(input: Input, now: number) {
    if (this.finished) return;
    const held = this.lastInput ?? input;
    this.lastInput = input;
    if (now <= this.lastFrame) return;
    if (now - this.lastFrame > MAX_FRAME_GAP_MS) {
      this.interrupted = this.finished = true;
      return;
    }
    this.lastFrame = now;
    this.elapsed = Math.min(now - this.start, MAX_LAP_MS);
    while (this.simulatedMs + STEP_MS <= this.elapsed) {
      const before = this.snapshot();
      drive(this.kart, held, STEP_MS / 1000, this.track, 'time-trial');
      if (this.kart.s >= 1) {
        const fraction = (1 - before[0]) / (this.kart.s - before[0]);
        const finish = blendPose(before, this.snapshot(), fraction);
        finish[0] = this.kart.s = 1;
        this.elapsed = Math.ceil(this.simulatedMs + STEP_MS * fraction);
        this.samples.push(finish);
        this.replay = { lapMs: this.elapsed, ghost: encodeGhost(this.samples) };
        this.finished = true;
        return;
      }
      this.simulatedMs += STEP_MS;
      if (this.simulatedMs % GHOST_INTERVAL === 0) this.samples.push(this.snapshot());
    }
    if (this.elapsed === MAX_LAP_MS) this.finished = true;
  }

  private snapshot(): Pose {
    const { s, lane, yaw, speed, drift, boost } = this.kart;
    return [s, lane, yaw, speed, drift, boost];
  }
}
