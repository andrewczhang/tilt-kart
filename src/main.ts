import './style.css';
import { Motor } from './audio';
import { LocalRace, MAX_RACERS } from './bots';
import { COLORS, COUNTDOWN, LAPS, clamp, point } from './circuit';
import { Controls } from './controls';
import { drive, grid, pose, type Kart, type Pose } from './drive';
import { RaceMusic } from './music';
import { readPreference, writePreference } from './preferences';
import { driver, rank, type Driver, type RoomState, type ServerMessage } from './rules';
import { View } from './scene';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const ui = $('interface');
const touch = new Controls(updateTilt, () => screen === 'race');
const motor = new Motor();
const music = new RaceMusic(() => motor.start(), motor.muted);
const route = /^\/r\/([0-9a-z]{8})\/?$/i.exec(location.pathname);
let code = route?.[1].toUpperCase() ?? '';
let screen: 'home' | 'bots' | 'join' | 'lobby' | 'race' | 'results' = code ? 'join' : 'home';
let socket: WebSocket | undefined;
let heartbeat = 0, clock = 0, sent = 0;
let player = '', local = grid(0), room: RoomState | undefined;
let localRace: LocalRace | undefined;
let issue = '', starting = false, joining = false;
let view: View;
const remotes = new Map<string, Pose>();
const preview = driver('preview', '', 0);
const mapPath = Array.from({ length: 121 }, (_, i) => point(i / 120));
const show = (html: string) => { ui.innerHTML = html; };
const button = (id: string, label: string, alt = false) => `<button id="${id}" class="action${alt ? ' alt' : ''}" type="button">${label}</button>`;
const doOn = (id: string, fn: () => void) => { $(id).onclick = fn; };
const sceneTag = '<p class="callout"><strong>01</strong>Red Basin Circuit</p>';
const identity = '<p class="identity">Tilt Kart / Red Basin</p>';
const doAfterGesture = () => {
  motor.start();
  if (touch.touch) void touch.enableTilt();
};
const notes = () => touch.touch ? 'Rotate to landscape. Hold your phone like a wheel. Automatic throttle.' : 'Drive with WASD or arrow keys. Hold brake and turn to drift; release for a boost.';

function menu() {
  if (screen === 'home') {
    show(`<section class="poster">${identity}<h1 class="title">Tilt <span>Kart</span></h1>
      <p class="intro">Three laps through Red Basin. Send a link to race up to seven friends.</p>
      <div class="actions">${button('create', 'Create room')}${button('bots', 'Vs bots', true)}${button('solo', 'Solo practice', true)}</div>
      <p class="help">${notes()}</p></section>${sceneTag}`);
    doOn('create', () => { screen = 'join'; menu(); });
    doOn('bots', () => { screen = 'bots'; menu(); });
    doOn('solo', () => { doAfterGesture(); startLocal(1); });
    return;
  }
  if (screen === 'bots') {
    const options = Array.from({ length: MAX_RACERS - 1 }, (_, i) => {
      const racers = i + 2;
      return `<option value="${racers}"${racers === 6 ? ' selected' : ''}>${racers} (you + ${racers - 1} ${racers === 2 ? 'bot' : 'bots'})</option>`;
    }).join('');
    show(`<section class="poster compact">${identity}<h2 class="title">Vs bots</h2>
      <form class="setup" id="bot-setup"><label for="racers">Total racers</label><select id="racers" name="racers">${options}</select>
      <div class="actions"><button class="action" type="submit">Start race</button>${button('back', 'Back', true)}</div></form>
      <p class="help">${notes()}</p></section>${sceneTag}`);
    const setup = $<HTMLFormElement>('bot-setup');
    setup.onsubmit = e => {
      e.preventDefault();
      const racers = Number(new FormData(setup).get('racers'));
      doAfterGesture();
      startLocal(racers);
    };
    doOn('back', home);
    return;
  }
  if (screen === 'join') {
    show(`<section class="poster compact">${identity}<h2 class="title">${code ? 'Join the grid' : 'Set up a race'}</h2>
      <form class="setup" id="setup"><label for="driver">Driver name</label>
      <input id="driver" maxlength="20" autocomplete="nickname" required placeholder="Your name">
      <div class="actions"><button class="action" id="join" type="submit">${code ? 'Join room' : 'Create room'}</button>${button('back', 'Back', true)}</div></form>
      <p class="notice" role="status" id="notice"></p><p class="help">${notes()}</p></section>${sceneTag}`);
    $<HTMLInputElement>('driver').value = readPreference('tilt-kart-name') ?? '';
    $('notice').textContent = issue;
    $<HTMLFormElement>('setup').onsubmit = e => {
      e.preventDefault();
      if (joining) return;
      const name = $<HTMLInputElement>('driver').value.trim();
      if (!name) { $('notice').textContent = 'Enter a name first.'; return; }
      doAfterGesture();
      void connect(name);
    };
    doOn('back', home);
    return;
  }
  if (screen === 'lobby' && room) {
    const isHost = room.host === player;
    show(`<section class="poster compact">${identity}<h2 class="title">Starting grid</h2>
      <div id="room-code">Room ${code} · ${room.drivers.length}/8 drivers</div><ol class="list" id="roster"></ol>
      <div class="actions">${button('share', 'Invite friends', true)}${isHost ? button('start', 'Start race') : ''}${button('leave', 'Leave', true)}</div>
      <p class="notice" id="notice" role="status"></p></section>${sceneTag}`);
    $('notice').textContent = issue || (isHost ? 'Start when your friends are on the grid.' : 'Waiting for the host to start.');
    fillList($('roster'), [...room.drivers].sort((a, b) => a.slot - b.slot), d => d.id === room?.host ? 'Host' : '');
    doOn('leave', home);
    doOn('share', () => void share());
    if (isHost) doOn('start', () => {
      touch.calibrate();
      motor.start();
      socket?.send('start');
    });
  }
}

async function share() {
  const url = new URL(`/r/${code}`, location.origin).href;
  try {
    if (navigator.share) await navigator.share({ title: 'Race me in Tilt Kart', url });
    else {
      await navigator.clipboard.writeText(url);
      if ($('notice')) $('notice').textContent = 'Invite link copied.';
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return;
    if ($('notice')) $('notice').textContent = url;
  }
}

function fillList(list: HTMLElement, drivers: Driver[], status: (d: Driver) => string) {
  for (const [i, d] of drivers.entries()) {
    const row = document.createElement('li');
    const stripe = document.createElement('span');
    stripe.className = 'chip'; stripe.style.backgroundColor = COLORS[d.slot];
    const name = document.createElement('span'); name.className = 'driver-name';
    name.textContent = `${i + 1}. ${d.name}${d.id === player ? ' (you)' : ''}`;
    const info = document.createElement('small'); info.textContent = status(d);
    row.appendChild(stripe); row.appendChild(name); row.appendChild(info); list.appendChild(row);
  }
}

function close() {
  music.stop();
  clearInterval(heartbeat);
  const prev = socket;
  socket = undefined;
  prev?.close();
  room = undefined;
  localRace = undefined;
  remotes.clear();
  joining = false;
  issue = '';
}

function home() {
  close();
  if (location.pathname !== '/') history.replaceState(null, '', '/');
  code = '';
  screen = 'home';
  menu();
}

async function connect(name: string) {
  close();
  joining = true;
  $<HTMLButtonElement>('join').disabled = true;
  $('notice').textContent = 'Connecting…';
  writePreference('tilt-kart-name', name);
  try {
    if (!code) {
      const res = await fetch('/api/rooms', { method: 'POST' });
      if (!res.ok) throw new Error();
      if (!joining) return;
      code = (await res.json() as { code: string }).code;
      if (!joining) { code = ''; return; }
      history.replaceState(null, '', `/r/${code}`);
    }
    const url = new URL(`/api/rooms/${code}`, location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('name', name);
    const ws = socket = new WebSocket(url);
    ws.onmessage = e => {
      if (socket !== ws || e.data === 'pong') return;
      let message: ServerMessage;
      try { message = JSON.parse(e.data); } catch { return; }
      if (message.type === 'welcome') {
        clock = message.now - Date.now();
        player = message.id; joining = false;
        screen = 'lobby'; issue = '';
        heartbeat = window.setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send('ping');
        }, 20_000);
        receiveRoom(message.room);
      } else if (message.type === 'room') receiveRoom(message.room);
      else if (message.type === 'error') connectionLost(message.reason);
      else if (message.type === 'state') {
        const d = room?.drivers.find(p => p.id === message.id);
        if (d) Object.assign(d, { pose: message.pose, checkpoint: message.checkpoint, finish: message.finish });
      }
    };
    ws.onclose = () => {
      if (socket === ws) connectionLost(joining ? 'Could not join room. Check the link and try again.' : 'Connection to the room was lost.');
    };
  } catch { if (joining) connectionLost('Could not create a room. Please try again.'); }
}

function connectionLost(reason: string) {
  if (screen === 'race' && room) {
    issue = reason;
    results();
    socket = undefined;
    clearInterval(heartbeat);
    return;
  }
  if (screen === 'results') return;
  close();
  issue = reason;
  screen = 'join';
  menu();
}

function receiveRoom(next: RoomState) {
  room = next;
  if (screen === 'lobby') {
    if (next.start !== null) begin();
    else menu();
  }
  if (next.complete && screen === 'race') results();
  else if (next.complete && screen === 'results') results();
}

function startLocal(racers: number) {
  close();
  localRace = new LocalRace(racers, Date.now() + COUNTDOWN);
  player = localRace.human.id;
  clock = 0;
  room = localRace.room;
  begin();
}

function updateTilt() {
  if (screen !== 'race') return;
  const enabled = touch.tilted;
  $('tilt').textContent = enabled ? 'Recenter tilt' : 'Enable tilt';
  $('left').hidden = $('right').hidden = enabled;
}

function begin() {
  screen = 'race';
  music.start('red-basin');
  const me = room!.drivers.find(d => d.id === player)!;
  local = localRace?.kart ?? grid(me.slot);
  sent = 0;
  starting = true;
  remotes.clear();
  show(`<div class="hud" aria-label="Race overview">
      <div class="hud-box"><small>Lap</small><em id="lap">1/3</em></div>
      <div class="hud-box"><small>Place</small><em id="place">1/${room!.drivers.length}</em></div>
      <div class="hud-box"><small>km/h</small><em id="speed">0</em></div>
      <canvas id="map" class="map" width="160" height="130" aria-label="Circuit map"></canvas>
    </div>
    <div class="hud-actions"><button class="tool" id="tilt"${touch.touch ? '' : ' hidden'}>Enable tilt</button><button class="tool" id="sound" aria-label="Sound effects"></button><button class="tool" id="music" aria-label="Music"></button><button class="tool" id="exit">Exit</button></div>
    <div class="status" id="status" role="status"></div><div class="rotate">Turn sideways for a wider view</div>
    <div class="boost" aria-label="Drift boost"><i id="boost"></i></div>
    <div class="touch"${touch.touch ? '' : ' hidden'}><button id="left">Left</button><button id="right">Right</button><button id="brake">Brake / Drift</button></div>`);
  touch.bindTouch();
  touch.calibrate();
  updateTilt();
  const hudAction = (id: string, action: () => void) => doOn(id, () => {
    $(id).blur();
    action();
  });
  hudAction('tilt', () => {
    void touch.enableTilt().then(allowed => {
      if (!allowed && screen === 'race') $('tilt').textContent = 'Tilt unavailable';
      else updateTilt();
    });
  });
  const labelAudio = () => {
    $('sound').textContent = motor.muted ? 'FX off' : 'FX on';
    $('sound').setAttribute('aria-pressed', String(!motor.muted));
    $('music').textContent = music.muted ? 'Music off' : 'Music on';
    $('music').setAttribute('aria-pressed', String(!music.muted));
  };
  hudAction('sound', () => { motor.toggle(); labelAudio(); });
  hudAction('music', () => { music.toggle(); labelAudio(); });
  labelAudio();
  hudAction('exit', home);
}

function formatTime(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}.${String(Math.floor(ms % 1000 / 10)).padStart(2, '0')}`;
}

function results() {
  music.stop();
  screen = 'results';
  const racers = localRace?.racers;
  show(`<section class="results" aria-labelledby="result-title"><div class="result-sheet">${identity}
    <h2 class="title" id="result-title">${racers === 1 ? 'Practice results' : 'Race results'}</h2>
    <ol class="list" id="results-list"></ol><p id="result-status"></p>
    <div class="actions">${button('back', 'Main menu', true)}${racers ? button('retry', 'Race again') : ''}</div>
    </div></section>`);
  updateResults();
  doOn('back', home);
  if (racers) doOn('retry', () => startLocal(racers));
}

function updateResults() {
  if (!room) return;
  const list = $('results-list');
  list.replaceChildren();
  fillList(list, rank(room.drivers), d => d.finish !== null ? formatTime(d.finish) : room?.complete || !d.online || issue ? 'DNF' : 'Racing');
  $('result-status').textContent = issue || (!room.complete ? 'Waiting for the finish…' : '');
}

function set(id: string, value: string) {
  const el = $(id);
  if (el.textContent !== value) el.textContent = value;
}

function drawMap(actors: Driver[]) {
  const canvas = $<HTMLCanvasElement>('map'), ctx = canvas.getContext('2d')!;
  const tx = (x: number) => x * .44 + 83, ty = (z: number) => z * .44 + 69;
  ctx.clearRect(0, 0, 160, 130);
  ctx.beginPath(); ctx.lineWidth = 3; ctx.strokeStyle = '#aebbb6';
  for (const [i, p] of mapPath.entries()) if (i) ctx.lineTo(tx(p.x), ty(p.z)); else ctx.moveTo(tx(p.x), ty(p.z));
  ctx.stroke();
  for (const actor of [...actors.filter(d => d.id !== player), ...actors.filter(d => d.id === player)]) {
    const p = point(actor.pose[0]);
    ctx.beginPath(); ctx.fillStyle = COLORS[actor.slot];
    ctx.arc(tx(p.x), ty(p.z), actor.id === player ? 4.5 : 3.3, 0, 2 * Math.PI); ctx.fill();
  }
}

let last = performance.now();
function tick(now: number) {
  const dt = Math.min(.05, (now - last) / 1000);
  last = now;
  const racing = screen === 'race' || screen === 'results';
  if (racing && room?.start != null) {
    const elapsed = Date.now() + clock - room.start;
    const me = room.drivers.find(d => d.id === player)!;
    const active = screen === 'race' && elapsed >= 0 && local.s < LAPS;
    if (active && starting) { starting = false; touch.calibrate(); }
    if (localRace) {
      const changed = localRace.step(touch.input(), dt, elapsed);
      if (screen === 'race' && (me.finish !== null || room.complete)) results();
      else if (screen === 'results' && changed) updateResults();
    } else if (active) {
      drive(local, touch.input(), dt);
    }
    const mine = pose(local);
    if (!localRace && screen === 'race' && elapsed >= 0 && me.finish === null) {
      mine[0] = Math.min(mine[0], LAPS);
      if (now - sent >= 55 && socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(mine)); sent = now;
      }
    }
    if (!localRace && me.finish !== null && screen === 'race') results();
    const visible = room.drivers.filter(d => d.online).map(d => {
      if (d.id === player) return { ...d, pose: mine };
      if (localRace) return d;
      const p = remotes.get(d.id) ?? [...d.pose] as Pose;
      for (let i = 0; i < p.length; i++) p[i] += (d.pose[i] - p[i]) * Math.min(1, dt * 15);
      remotes.set(d.id, p);
      return { ...d, pose: p };
    });
    if (screen === 'race') {
      const current = room.drivers.map(d => d.id === player ? { ...d, pose: mine } : d);
      set('lap', `${Math.min(LAPS, 1 + Math.max(0, Math.floor(mine[0])))}/${LAPS}`);
      set('speed', String(Math.round(local.speed * 3.6)));
      set('place', `${rank(current).findIndex(d => d.id === player) + 1}/${room.drivers.length}`);
      set('status', elapsed < 0 ? String(Math.min(3, Math.ceil(-elapsed / 1000))) : elapsed < 630 ? 'GO!' : '');
      $('boost').style.transform = `scaleX(${local.boost > 0 ? clamp(local.boost / 1.5, 0, 1) : local.drift})`;
      drawMap(visible);
    }
    motor.update(active || screen === 'race' && elapsed < 0 ? local : undefined);
    view.render(mine, visible, player, dt);
  } else {
    const demo: Pose = [((now % 68_000) / 68_000 + .964) % 1, 1.5, -.07, 32, 0, 0];
    view.render(demo, [{ ...preview, pose: demo }], preview.id, dt, true);
    motor.update();
  }
  requestAnimationFrame(tick);
}

try {
  view = new View($('world'), $('names'));
  menu();
  requestAnimationFrame(tick);
} catch {
  show(`<section class="poster">${identity}<h2 class="title">WebGL unavailable</h2><p>Tilt Kart needs a browser with 3D graphics enabled.</p></section>`);
}
