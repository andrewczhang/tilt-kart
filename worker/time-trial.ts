import { getTrack, MAX_ROUTE_PROGRESS_SCALE } from '../src/circuit';
import { MAX_BOOST_SPEED, MAX_STAR_SPEED } from '../src/drive';
import { decodeGhost, GHOST_INTERVAL, GHOST_PROGRESS_QUANTUM, MAX_GHOST_LENGTH, type Replay, type Standing } from '../src/ghost';
import { courseLayoutKey, type TrackId } from '../src/tracks';

const MAX_BODY_BYTES = MAX_GHOST_LENGTH + 512;
const DRIVER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
type Submission = Replay & Standing & { driverId: string };

export function validSubmission(value: unknown, trackId: TrackId): Submission | null {
  if (!value || typeof value !== 'object') return null;
  const { driverId, name, lapMs, ghost } = value as Partial<Submission>;
  if (typeof driverId !== 'string' || !DRIVER_ID.test(driverId)
    || typeof name !== 'string' || typeof lapMs !== 'number' || typeof ghost !== 'string') return null;
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 20 || /[\u0000-\u001f\u007f]/.test(trimmed)) return null;
  const track = getTrack(trackId);
  const branch = track.branch;
  const branchFraction = branch ? branch.end - branch.start : 0;
  const minDistance = track.length * (1 - branchFraction + branchFraction / MAX_ROUTE_PROGRESS_SCALE);
  if (lapMs / 1000 * MAX_BOOST_SPEED < minDistance) return null;
  const replay = decodeGhost(lapMs, ghost);
  if (!replay) return null;
  for (const [i, [s, lane, yaw, speed, drift, boost]] of replay.poses.entries()) {
    const [left, right] = track.laneBounds(s, lane);
    if (lane < left || lane > right || Math.abs(yaw) > 3.1416 || speed < 0 || speed > MAX_BOOST_SPEED
      || drift < 0 || drift > 1 || boost < 0 || boost > 1.5) return null;
    if (!i) continue;
    const dt = (Math.min(i * GHOST_INTERVAL, lapMs) - (i - 1) * GHOST_INTERVAL) / 1000;
    const [before, beforeLane] = replay.poses[i - 1];
    if (Math.abs(s - before) > 2 * MAX_BOOST_SPEED * dt / track.length + GHOST_PROGRESS_QUANTUM) return null;
    const from = track.point(before, beforeLane), to = track.point(s, lane);
    const distance = Math.hypot(to.x - from.x, to.z - from.z);
    const low = Math.min(before, s), high = Math.max(before, s);
    const lap = Math.floor(low);
    let flightSpeed = 0;
    for (const jump of track.jumps ?? []) {
      if (low - lap - GHOST_PROGRESS_QUANTUM < jump.end && high - lap + GHOST_PROGRESS_QUANTUM >= jump.start) {
        flightSpeed = Math.max(flightSpeed, track.flightSpeed(jump.start));
      }
    }
    const forwardLimit = Math.max(MAX_BOOST_SPEED, flightSpeed) * dt;
    const lateralAllowance = flightSpeed ? MAX_STAR_SPEED * dt : 0;
    if (distance > forwardLimit + lateralAllowance + 2 * GHOST_PROGRESS_QUANTUM * track.length + .01) return null;
  }
  return { driverId, name: trimmed, lapMs, ghost };
}

async function readJson(req: Request): Promise<unknown> {
  if (!req.body || Number(req.headers.get('Content-Length')) > MAX_BODY_BYTES) return null;
  const reader = req.body.getReader();
  const buffer = new Uint8Array(MAX_BODY_BYTES);
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (size + value.length > buffer.length) {
      await reader.cancel();
      return null;
    }
    buffer.set(value, size);
    size += value.length;
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size)));
}

export async function timeTrialRequest(req: Request, db: D1Database, trackId: TrackId, resource?: string) {
  const layout = courseLayoutKey(trackId);
  if (req.method === 'GET' && resource === 'leaderboard') {
    const { results } = await db.prepare(`SELECT name, lap_ms AS lapMs FROM time_trials
      WHERE track_id = ? ORDER BY lap_ms, id LIMIT 10`).bind(layout).all<Standing>();
    return Response.json(results);
  }
  if (req.method === 'GET' && resource === 'ghost') {
    const best = await db.prepare(`SELECT name, lap_ms AS lapMs, ghost FROM time_trials
      WHERE track_id = ? ORDER BY lap_ms, id LIMIT 1`).bind(layout).first<Replay & Standing>();
    return Response.json(best);
  }
  if (req.method === 'POST' && !resource) {
    const value = validSubmission(await readJson(req).catch(() => null), trackId);
    if (!value) return Response.json({ error: 'Invalid lap or replay' }, { status: 400 });
    const { name, driverId, lapMs, ghost } = value;
    const [, result] = await db.batch<{ rank: number; lapMs: number }>([
      db.prepare(`INSERT INTO time_trials (track_id, driver_id, name, lap_ms, ghost) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (track_id, driver_id) DO UPDATE SET name = excluded.name, lap_ms = excluded.lap_ms, ghost = excluded.ghost
        WHERE excluded.lap_ms < time_trials.lap_ms`).bind(layout, driverId, name, lapMs, ghost),
      db.prepare(`SELECT lap_ms AS lapMs, 1 + (SELECT COUNT(*) FROM time_trials
        WHERE track_id = best.track_id AND (lap_ms, id) < (best.lap_ms, best.id)) AS rank
        FROM time_trials AS best WHERE track_id = ? AND driver_id = ?`).bind(layout, driverId),
    ]);
    return Response.json(result.results[0]);
  }
  return new Response('Method not allowed', { status: 405, headers: { Allow: resource ? 'GET' : 'POST' } });
}
