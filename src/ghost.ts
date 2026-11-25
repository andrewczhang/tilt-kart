import type { Pose } from './drive';

export const GHOST_INTERVAL = 50;
export const MAX_LAP_MS = 180_000;
const BYTES = 12;
const PROGRESS_SCALE = 65535;
const SCALES = [PROGRESS_SCALE, 100, 10000, 100, 10000, 10000];
const SIGNED_PROGRESS = 'v2:';
export const GHOST_PROGRESS_QUANTUM = 1 / PROGRESS_SCALE;
export const MAX_GHOST_LENGTH = Math.ceil((MAX_LAP_MS / GHOST_INTERVAL + 1) * BYTES / 3) * 4 + SIGNED_PROGRESS.length;

export type Replay = { lapMs: number; ghost: string };
export type Ghost = { lapMs: number; poses: Pose[] };
export type Standing = { name: string; lapMs: number };

export function encodeGhost(poses: Pose[]) {
  const signed = poses.some(p => p[0] < 0);
  const data = new DataView(new ArrayBuffer(poses.length * BYTES));
  let previous = 0;
  poses.forEach((pose, i) => pose.forEach((n, j) => {
    const offset = i * BYTES + j * 2;
    const quantized = Math.round(n * SCALES[j]);
    if (j === 0 && signed) {
      data.setInt16(offset, quantized - previous);
      previous = quantized;
    } else if (j === 0) data.setUint16(offset, quantized);
    else data.setInt16(offset, quantized);
  }));
  return (signed ? SIGNED_PROGRESS : '') + btoa(Array.from(new Uint8Array(data.buffer), n => String.fromCharCode(n)).join(''));
}

export function decodeGhost(lapMs: number, encoded: string): Ghost | null {
  if (!Number.isInteger(lapMs) || lapMs < 1 || lapMs > MAX_LAP_MS) return null;
  const signed = encoded.startsWith(SIGNED_PROGRESS);
  if (signed) encoded = encoded.slice(SIGNED_PROGRESS.length);
  const count = Math.ceil(lapMs / GHOST_INTERVAL) + 1;
  if (encoded.length !== count * BYTES / 3 * 4 || /[^A-Za-z0-9+/]/.test(encoded)) return null;
  const data = new DataView(Uint8Array.from(atob(encoded), c => c.charCodeAt(0)).buffer);
  const poses: Pose[] = [];
  let progress = 0;
  for (let i = 0; i < count; i++) {
    poses.push(SCALES.map((scale, j) => {
      const offset = i * BYTES + j * 2;
      if (j !== 0) return data.getInt16(offset) / scale;
      progress = signed ? progress + data.getInt16(offset) : data.getUint16(offset);
      return progress / scale;
    }) as Pose);
  }
  if (poses[0][0] !== 0 || poses[count - 1][0] !== 1
    || poses.some(p => p[0] > 1)) return null;
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
  if (progress < poses[0][0]) return;
  if (progress === poses[0][0]) return 0;
  if (progress >= 1) return lapMs;
  const hi = poses.findIndex(p => p[0] >= progress);
  const lo = hi - 1;
  const start = lo * GHOST_INTERVAL, end = Math.min(hi * GHOST_INTERVAL, lapMs);
  return start + (end - start) * (progress - poses[lo][0]) / (poses[hi][0] - poses[lo][0]);
}
