import { COLORS, type Circuit } from './circuit';
import type { Driver } from './rules';
import { TRACKS, TRACK_IDS, type TrackId } from './tracks';

export function trackSelector(id: TrackId) {
  const options = TRACK_IDS.map(key => `<option value="${key}"${key === id ? ' selected' : ''}>${TRACKS[key].name}</option>`);
  return `<div class="track-picker"><label for="track-select">Track</label> <select id="track-select">${options.join('')}</select></div>`;
}

export function trackTag(track: Circuit) {
  const number = String(TRACK_IDS.indexOf(track.id) + 1).padStart(2, '0');
  return `<p class="callout" id="track-callout" style="background:${track.sign[0]};color:${track.sign[1]}"><strong>${number}</strong>${track.name}</p>`;
}

const maps = new Map<TrackId, ReturnType<typeof makeMap>>();
const W = 160, H = 130;
function makeMap(track: Circuit) {
  const points = Array.from({ length: 181 }, (_, i) => track.point(i / 180));
  const xs = points.map(p => p.x), zs = points.map(p => p.z);
  const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...zs), bottom = Math.max(...zs);
  const scale = Math.min((W - 24) / (right - left), (H - 24) / (bottom - top));
  const x = (value: number) => (value - (right + left) / 2) * scale + W / 2;
  const y = (value: number) => (value - (bottom + top) / 2) * scale + H / 2;
  const path = new Path2D();
  points.forEach((p, i) => i ? path.lineTo(x(p.x), y(p.z)) : path.moveTo(x(p.x), y(p.z)));
  path.closePath();
  const finish = new Path2D();
  const a = track.point(0, -track.width / 2), b = track.point(0, track.width / 2);
  finish.moveTo(x(a.x), y(a.z)); finish.lineTo(x(b.x), y(b.z));
  return { x, y, path, finish };
}

type MapActor = Pick<Driver, 'id' | 'slot' | 'pose'> & { ghostColor?: string };

export function drawTrackMap(canvas: HTMLCanvasElement, track: Circuit, actors: MapActor[], own: string) {
  let map = maps.get(track.id);
  if (!map) {
    map = makeMap(track);
    maps.set(track.id, map);
  }
  const { x, y, path, finish } = map;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = track.wall;
  ctx.fillRect(0, 0, W, H);
  ctx.lineWidth = 4;
  ctx.strokeStyle = track.trim;
  ctx.stroke(path);
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#253139';
  ctx.stroke(finish);
  const mark = (actor: MapActor) => {
    const p = track.frame(actor.pose[0]);
    ctx.beginPath(); ctx.fillStyle = actor.ghostColor ?? COLORS[actor.slot];
    ctx.arc(x(p.x), y(p.z), actor.id === own ? 4.5 : 3.3, 0, 2 * Math.PI);
    ctx.fill();
    ctx.lineWidth = 1.25; ctx.strokeStyle = '#253139'; ctx.stroke();
  };
  for (const actor of actors) if (actor.id !== own) mark(actor);
  const me = actors.find(actor => actor.id === own);
  if (me) mark(me);
}
