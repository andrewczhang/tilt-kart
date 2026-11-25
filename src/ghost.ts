import type { Pose } from './drive';

export const GHOST_INTERVAL = 50;
export const MAX_LAP_MS = 180_000;
const BYTES = 12;
const SCALES = [65535, 100, 10000, 100, 10000, 10000];
export const MAX_GHOST_LENGTH = Math.ceil((MAX_LAP_MS / GHOST_INTERVAL + 1) * BYTES / 3) * 4;

export type Replay = { lapMs: number; ghost: string };
export type Ghost = { lapMs: number; poses: Pose[] };
export type Standing = { name: string; lapMs: number };

export function encodeGhost(poses: Pose[]) {
  const data = new DataView(new ArrayBuffer(poses.length * BYTES));
  poses.forEach((pose, i) => pose.forEach((n, j) => {
    const offset = i * BYTES + j * 2;
    const quantized = Math.round(n * SCALES[j]);
    if (j === 0) data.setUint16(offset, quantized);
    else data.setInt16(offset, quantized);
  }));
  return btoa(Array.from(new Uint8Array(data.buffer), n => String.fromCharCode(n)).join(''));
}

export function decodeGhost(lapMs: number, encoded: string): Ghost | null {
  if (!Number.isInteger(lapMs) || lapMs < 1 || lapMs > MAX_LAP_MS) return null;
  const count = Math.ceil(lapMs / GHOST_INTERVAL) + 1;
  if (encoded.length !== count * BYTES / 3 * 4 || /[^A-Za-z0-9+/]/.test(encoded)) return null;
  const data = new DataView(Uint8Array.from(atob(encoded), c => c.charCodeAt(0)).buffer);
  const poses: Pose[] = [];
  for (let i = 0; i < count; i++) {
    poses.push(SCALES.map((scale, j) => {
      const offset = i * BYTES + j * 2;
      return (j === 0 ? data.getUint16(offset) : data.getInt16(offset)) / scale;
    }) as Pose);
  }
  if (poses[0][0] !== 0 || poses[count - 1][0] !== 1
    || poses.some((p, i) => i > 0 && p[0] < poses[i - 1][0])) return null;
  return { lapMs, poses };
}

export function blendPose(a: Pose, b: Pose, fraction: number): Pose {
  return a.map((n, i) => n + (b[i] - n) * fraction) as Pose;
}

export function ghostPose({ lapMs, poses }: Ghost, elapsed: number): Pose {
  if (elapsed <= 0) return poses[0];
  if (elapsed >= lapMs) return poses[poses.length - 1];
  const i = Math.floor(elapsed / GHOST_INTERVAL);
  const start = i * GHOST_INTERVAL, end = Math.min(start + GHOST_INTERVAL, lapMs);
  return blendPose(poses[i], poses[i + 1], (elapsed - start) / (end - start));
}

export function ghostTimeAt({ lapMs, poses }: Ghost, progress: number) {
  if (progress <= 0) return 0;
  if (progress >= 1) return lapMs;
  let lo = 0, hi = poses.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (poses[mid][0] < progress) lo = mid;
    else hi = mid;
  }
  const start = lo * GHOST_INTERVAL, end = Math.min(hi * GHOST_INTERVAL, lapMs);
  return start + (end - start) * (progress - poses[lo][0]) / (poses[hi][0] - poses[lo][0]);
}
