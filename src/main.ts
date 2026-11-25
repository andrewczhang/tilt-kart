import './style.css';
import { Motor } from './audio';
import { LocalRace, MAX_RACERS } from './bots';
import { COLORS, COUNTDOWN, LAPS, LIMIT, clamp, getTrack } from './circuit';
import { Controls } from './controls';
import { drive, grid, pose, type Kart, type Pose } from './drive';
import { RaceMusic } from './music';
import { POWERUPS, PowerupState, type ItemEvent, type PowerupCallbacks, type PowerupId } from './powerups';
import { readPreference, writePreference } from './preferences';
import { rank, type Driver, type RoomState, type ServerMessage } from './rules';
import { View } from './scene';
import { drawTrackMap, trackSelector, trackTag } from './track-ui';
import { DEFAULT_TRACK, isTrackId, type TrackId } from './tracks';
import { formatTime, RaceTiming } from './timing';
import { RaceWakeLock } from './wake';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const ui = $('interface');
const touch = new Controls(updateTilt, () => screen === 'race' && !$<HTMLDialogElement>('exit-dialog')?.open);
const motor = new Motor();
const music = new RaceMusic(() => motor.start(), motor.muted);
const wake = new RaceWakeLock();
const route = /^\/r\/([0-9a-z]{8})\/?$/i.exec(location.pathname);
let code = route?.[1].toUpperCase() ?? '';
let screen: 'home' | 'bots' | 'controls' | 'join' | 'lobby' | 'race' | 'spectate' | 'results' = code ? 'join' : 'home';
let socket: WebSocket | undefined;
let heartbeat = 0, clock = 0, sent = 0;
let player = '', local = grid(0), room: RoomState | undefined;
let localRace: LocalRace | undefined;
let timing = new RaceTiming();
let timingKey = '';
let issue = '', starting = false, joining = false;
let followed = '', checkedDeadline: number | null = null;
let view: View;
let practiceTrack: TrackId = DEFAULT_TRACK;
let track = getTrack();
const remotes = new Map<string, Pose>();
const powerups = new PowerupState();
let lastItemKey = '';
const show = (html: string) => { ui.innerHTML = html; };
const button = (id: string, label: string, alt = false) => `<button id="${id}" class="action${alt ? ' alt' : ''}" type="button">${label}</button>`;
const doOn = (id: string, fn: () => void) => { $(id).onclick = fn; };
const identity = '<p class="identity">Tilt Kart</p>';
const tokenKey = () => `tilt-kart-room-${code}`;
const notes = () => touch.touch ? 'Rotate to landscape. Hold your phone like a wheel. Automatic throttle. Tap the item box for power-ups.' : 'Drive with WASD or arrow keys. Brake with S, ↓ or Space. Hold brake and turn to drift; press E or Enter for power-ups.';
const phoneSetup = () => touch.touch ? `<div class="phone-setup">
  <p class="rotate">Turn sideways for a wider view.</p>
  ${button('tilt', 'Enable tilt', true)}<p id="tilt-status" role="status">Tilt or use Left / Right to steer.</p>
  </div>` : '';

function bindTilt() {
  if (!$('tilt')) return;
  doOn('tilt', () => {
    if (screen === 'race') $('tilt').blur();
    void touch.enableTilt();
  });
  updateTilt();
}

function prepareLocal(racers: number, back: () => void) {
  motor.start();
  if (!touch.touch) { startLocal(racers); return; }
  screen = 'controls';
  show(`<section class="poster compact">${identity}<h2 class="title">Phone controls</h2>
    ${phoneSetup()}
    <p class="help">Hold your phone like a wheel. The kart accelerates automatically.</p>
    <div class="actions">${button('start', 'Start race')}${button('back', 'Back', true)}</div>
    </section>${trackTag(track)}`);
  bindTilt();
  doOn('start', () => { motor.start(); startLocal(racers); });
  doOn('back', back);
}

function displayTrack(id: TrackId) {
  track = getTrack(id);
  view.setTrack(track);
}

function bindTrackPicker(onChange: (id: TrackId) => void) {
  const select = ui.querySelector('select')!;
  select.onchange = () => { if (isTrackId(select.value)) onChange(select.value); };
}

function menu() {
  if (screen === 'home') {
    displayTrack(practiceTrack);
    show(`<section class="poster">${identity}<h1 class="title">Tilt <span>Kart</span></h1>
      <p class="intro">Eight circuits, three laps each. Send a link to race up to seven friends.</p>
      ${trackSelector(practiceTrack)}
      <div class="actions">${button('create', 'Create room')}${button('bots', 'Vs bots', true)}${button('solo', 'Solo practice', true)}</div>
      <p class="help">${notes()}</p></section>${trackTag(track)}`);
    bindTrackPicker(id => {
      practiceTrack = id;
      displayTrack(id);
      $('track-callout').outerHTML = trackTag(track);
    });
    doOn('create', () => { screen = 'join'; menu(); });
    doOn('bots', () => { screen = 'bots'; menu(); });
    doOn('solo', () => prepareLocal(1, home));
    return;
  }
  if (screen === 'bots') {
    const options = Array.from({ length: MAX_RACERS - 1 }, (_, i) => {
      const racers = i + 2;
      return `<option value="${racers}"${racers === 6 ? ' selected' : ''}>${racers} (you + ${racers - 1} ${racers === 2 ? 'bot' : 'bots'})</option>`;
    }).join('');
    show(`<section class="poster compact">${identity}<h2 class="title">Vs bots</h2>
      <form class="setup" id="bot-setup"><label for="racers">Total racers</label><select id="racers" name="racers">${options}</select>
      <div class="actions"><button class="action" type="submit">${touch.touch ? 'Phone controls' : 'Start race'}</button>${button('back', 'Back', true)}</div></form>
      <p class="help">${notes()}</p></section>${trackTag(track)}`);
    const setup = $<HTMLFormElement>('bot-setup');
    setup.onsubmit = e => {
      e.preventDefault();
      const racers = Number(new FormData(setup).get('racers'));
      prepareLocal(racers, () => { screen = 'bots'; menu(); });
    };
    doOn('back', home);
    return;
  }
  if (screen === 'join') {
    const rejoining = code && readPreference(tokenKey());
    show(`<section class="poster compact">${identity}<h2 class="title">${rejoining ? 'Rejoin room' : code ? 'Join the grid' : 'Set up a race'}</h2>
      <form class="setup" id="setup"><label for="driver">Driver name</label>
      <input id="driver" maxlength="20" autocomplete="nickname" required placeholder="Your name">
      ${phoneSetup()}
      <div class="actions"><button class="action" id="join" type="submit">${rejoining ? 'Rejoin room' : code ? 'Join room' : 'Create room'}</button>${button('back', 'Back', true)}</div></form>
      <p class="notice" role="status" id="notice"></p>${touch.touch ? '' : `<p class="help">${notes()}</p>`}</section>${code ? '' : trackTag(track)}`);
    $<HTMLInputElement>('driver').value = readPreference('tilt-kart-name') ?? '';
    $('notice').textContent = issue;
    $<HTMLFormElement>('setup').onsubmit = e => {
      e.preventDefault();
      if (joining || touch.tiltStatus === 'waiting') return;
      const name = $<HTMLInputElement>('driver').value.trim();
      if (!name) { $('notice').textContent = 'Enter a name first.'; return; }
      motor.start();
      void connect(name);
    };
    doOn('back', home);
    bindTilt();
    return;
  }
  if (screen === 'lobby' && room) {
    const isHost = room.host === player;
    displayTrack(room.track ?? DEFAULT_TRACK);
    const pickerFocused = document.activeElement?.id === 'track-select';
    show(`<section class="poster compact">${identity}<h2 class="title">Starting grid</h2>
      <div id="room-code">Room ${code} · ${room.drivers.length}/8 drivers</div><ol class="list" id="roster"></ol>
      ${isHost ? trackSelector(track.id) : `<p class="lobby-track">Track: <strong>${track.name}</strong></p>`}
      ${phoneSetup()}
      <div class="actions">${button('share', 'Invite friends', true)}${isHost ? button('start', 'Start race') : ''}${button('leave', 'Leave', true)}</div>
      <p class="notice" id="notice" role="status"></p></section>${trackTag(track)}`);
    if (isHost) {
      bindTrackPicker(id => { if (socket?.readyState === WebSocket.OPEN) socket.send(`track:${id}`); });
      if (pickerFocused) $('track-select').focus();
    }
    $('notice').textContent = issue || (isHost ? 'Start when your friends are on the grid.' : 'Waiting for the host to start.');
    fillList($('roster'), [...room.drivers].sort((a, b) => a.slot - b.slot), d => d.id === room?.host ? 'Host' : '');
    doOn('leave', home);
    doOn('share', () => void share());
    bindTilt();
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
  wake.setActive(false);
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
    const key = tokenKey();
    const token = readPreference(key) ?? crypto.randomUUID();
    const ws = socket = new WebSocket(url, token);
    ws.onmessage = e => {
      if (socket !== ws || e.data === 'pong') return;
      let message: ServerMessage;
      try { message = JSON.parse(e.data); } catch { return; }
      if (message.type === 'welcome') {
        writePreference(key, token);
        clock = message.now - Date.now();
        player = message.id; joining = false;
        screen = 'lobby'; issue = '';
        checkedDeadline = null;
        heartbeat = window.setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send('ping');
        }, 20_000);
        receiveRoom(message.room);
      } else if (message.type === 'room') receiveRoom(message.room);
      else if (message.type === 'error') connectionLost(message.reason);
      else if (message.type === 'state') {
        const d = room?.drivers.find(p => p.id === message.id);
        if (d) {
          Object.assign(d, { pose: message.pose, checkpoint: message.checkpoint, finish: message.finish });
          if (screen === 'results' && message.finish !== null) updateResults();
        }
      } else if (message.type === 'item') {
        powerups.applyRemote(message.from, message.event);
      }
    };
    ws.onclose = e => {
      if (socket === ws) connectionLost(e.reason || (joining ? 'Could not join room. Check the link and try again.' : 'Connection lost. Rejoin to return to your room.'));
    };
  } catch { if (joining) connectionLost('Could not create a room. Please try again.'); }
}

function connectionLost(reason: string) {
  close();
  issue = reason;
  screen = 'join';
  menu();
}

function receiveRoom(next: RoomState) {
  room = next;
  const me = next.drivers.find(d => d.id === player);
  if (next.start === null) {
    music.stop();
    screen = 'lobby';
    menu();
  } else if (next.complete || me?.finish != null) {
    if (screen === 'lobby') resetRace(me);
    results();
  } else if (screen === 'lobby') {
    if (me) begin();
    else spectate();
  }
}

function startLocal(racers: number) {
  close();
  localRace = new LocalRace(racers, Date.now() + COUNTDOWN, getTrack(practiceTrack));
  player = localRace.human.id;
  clock = 0;
  room = localRace.room;
  begin();
}

function updateTilt() {
  const tilt = $<HTMLButtonElement>('tilt');
  if (!tilt) return;
  const status = touch.tiltStatus;
  tilt.textContent = status === 'ready' ? 'Recenter tilt' : 'Enable tilt';
  tilt.disabled = status === 'waiting';
  set('tilt-status', {
    idle: screen === 'race' ? '' : 'Tilt or use Left / Right to steer.',
    waiting: 'Waiting for motion data…',
    denied: 'Motion access denied. Use Left / Right to steer.',
    unavailable: 'No motion data. Use Left / Right to steer.',
    ready: screen === 'race' ? '' : 'Tilt ready. Left / Right still work.',
  }[status]);
  const start = $<HTMLButtonElement>('start');
  const join = $<HTMLButtonElement>('join');
  if (start) start.disabled = status === 'waiting';
  if (join) join.disabled = joining || status === 'waiting';
}

function resetRace(me?: Driver) {
  displayTrack(room?.track ?? DEFAULT_TRACK);
  local = localRace?.kart ?? grid(me?.slot ?? 0, track);
  if (!localRace && me) {
    [local.s, local.lane, local.yaw, local.speed, local.drift, local.boost] = me.pose;
  }
  const key = `${code}/${room?.start}`;
  if (localRace || key !== timingKey) {
    timing = new RaceTiming(track.id);
    timingKey = key;
  }
  sent = 0;
  starting = true;
  followed = '';
  remotes.clear();
  powerups.reset();
  lastItemKey = '';
}

function spectate() {
  screen = 'spectate';
  resetRace();
  show(`<div class="hud" aria-label="Race overview">
      <div class="hud-box" role="status"><strong>Spectating</strong><small>You’re on the grid next race.</small></div>
      <canvas id="map" class="map" width="160" height="130" aria-label="${track.name} circuit map"></canvas></div>
    <div class="hud-actions"><button class="tool" id="exit">Exit</button></div>`);
  doOn('exit', home);
}

function begin() {
  screen = 'race';
  wake.setActive(true);
  resetRace(room!.drivers.find(d => d.id === player));
  music.start(track.id);
  show(`<div class="hud" aria-label="Race overview">
      <div class="hud-box"><small>Lap</small><em id="lap">1/3</em></div>
      <div class="hud-box"><small>Place</small><em id="place">1/${room!.drivers.length}</em></div>
      <div class="hud-box"><small>km/h</small><em id="speed">0</em></div>
      <div class="hud-box race-clock"><small>Race time</small><em id="elapsed">0:00.00</em><small id="remaining">3:00 left</small></div>
      <button class="hud-box item-slot" id="item-slot" type="button" aria-label="Use power-up"><small id="item-hint">Item</small><span id="item-icon" class="item-icon">?</span><b id="item-name">Empty</b></button>
      <canvas id="map" class="map" width="160" height="130" aria-label="${track.name} circuit map"></canvas>
    </div>
    <div class="hud-actions"><button class="tool" id="tilt"${touch.touch ? '' : ' hidden'}>Enable tilt</button><button class="tool" id="music"></button><button class="tool" id="sound"></button><button class="tool" id="exit">Exit</button></div>
    <div class="status" id="status" role="status"></div><div class="item-banner" id="item-banner" role="status"></div>
    ${touch.touch ? '<p class="race-tilt-status" id="tilt-status" role="status"></p>' : ''}
    <div class="boost" aria-label="Drift boost"><i id="boost"></i></div>
    <div class="touch"${touch.touch ? '' : ' hidden'}><button id="left">Left</button><button id="right">Right</button><button id="brake">Brake / Drift</button></div>
    <dialog id="exit-dialog" aria-labelledby="exit-title">
      <h2 id="exit-title">Exit race?</h2><p>You’ll leave this race and lose your result.</p>
      <div class="actions"><button class="action alt" id="keep-racing" autofocus>Keep racing</button>${button('confirm-exit', 'Exit race')}</div>
    </dialog>`);
  touch.bindTouch();
  touch.calibrate();
  bindTilt();
  const itemBtn = $('item-slot');
  itemBtn.addEventListener('pointerdown', e => {
    e.preventDefault();
    touch.queueItem();
    itemBtn.blur();
  });
  itemBtn.addEventListener('click', e => {
    if (e.detail === 0) touch.queueItem();
  });
  const hudAction = (id: string, action: () => void) => doOn(id, () => {
    $(id).blur();
    action();
  });
  const labelAudio = () => {
    $('sound').textContent = motor.muted ? 'Unmute FX' : 'Mute FX';
    $('music').textContent = music.muted ? 'Unmute music' : 'Mute music';
  };
  hudAction('sound', () => { motor.toggle(); labelAudio(); });
  hudAction('music', () => { music.toggle(); labelAudio(); });
  labelAudio();
  const dialog = $<HTMLDialogElement>('exit-dialog');
  doOn('exit', () => dialog.showModal());
  doOn('keep-racing', () => dialog.close());
  doOn('confirm-exit', home);
}

function results() {
  music.stop();
  const me = room?.drivers.find(d => d.id === player);
  const finish = me?.finish ?? null;
  if (screen === 'race' && finish !== null) motor.finish();
  screen = 'results';
  wake.setActive(false);
  const racers = localRace?.racers;
  const rematch = !localRace && room?.host === player;
  const splits = timing.splits(finish !== null), records = timing.records(finish);
  show(`<section class="results" aria-labelledby="result-title"><div class="result-sheet"><p class="identity">Tilt Kart / ${track.name}</p>
    <h2 class="title" id="result-title">${racers === 1 ? 'Practice results' : 'Race results'}</h2>
    ${me ? `<p class="finish-time"><small>Your result</small><strong>${finish === null ? 'DNF' : formatTime(finish)}</strong></p>
    <dl class="splits" aria-label="Lap splits">${Array.from({ length: LAPS }, (_, i) =>
      `<div><dt>Lap ${i + 1}</dt><dd>${formatTime(splits[i] ?? Infinity)}</dd></div>`).join('')}</dl>
    <dl class="records" aria-label="Personal bests"><div><dt>Best lap</dt><dd>${formatTime(records.lap)}</dd></div>
      <div><dt>Best time</dt><dd>${formatTime(records.race)}</dd></div></dl>` : ''}
    <ol class="list" id="results-list"></ol><p id="result-status"></p>
    <div class="actions">${button('back', 'Main menu', true)}${racers ? button('retry', 'Race again') : rematch ? button('retry', 'Rematch') : ''}</div>
    </div></section>`);
  updateResults();
  doOn('back', home);
  if (racers) doOn('retry', () => prepareLocal(racers, results));
  else if (rematch) doOn('retry', () => socket?.send('rematch'));
}

function updateResults() {
  if (!room) return;
  const list = $('results-list');
  list.replaceChildren();
  fillList(list, rank(room.drivers), d => d.finish !== null ? formatTime(d.finish) : room?.complete ? 'DNF' : d.online ? 'Racing' : 'Disconnected');
  const retry = $<HTMLButtonElement>('retry');
  if (!localRace && retry) retry.disabled = !room.complete;
  $('result-status').textContent = !room.complete ? 'Waiting for the finish…' : !localRace && room.host !== player ? 'Waiting for the host to start a rematch.' : '';
}

function set(id: string, value: string) {
  const el = $(id);
  if (el && el.textContent !== value) el.textContent = value;
}

function updateItemHud() {
  const item: PowerupId | null = powerups.displayItem;
  const rolling = powerups.rolling !== null;
  const key = `${item ?? 'none'}:${rolling ? 1 : 0}:${touch.touch ? 1 : 0}`;
  if (key !== lastItemKey) {
    lastItemKey = key;
    const slot = $('item-slot');
    slot.classList.toggle('rolling', rolling);
    slot.classList.toggle('ready', !rolling && item !== null);
    if (item) {
      const meta = POWERUPS[item];
      slot.style.setProperty('--item-color', meta.color);
      $('item-icon').innerHTML = meta.svg;
      $('item-name').textContent = meta.label;
      $('item-hint').textContent = rolling ? 'Rolling' : touch.touch ? 'Tap' : 'E / Enter';
    } else {
      slot.style.removeProperty('--item-color');
      $('item-icon').textContent = '?';
      $('item-name').textContent = 'Empty';
      $('item-hint').textContent = 'Item';
    }
  }
  const banner = $('item-banner');
  if (powerups.banner) {
    if (banner.textContent !== powerups.banner.text) banner.textContent = powerups.banner.text;
    banner.style.setProperty('--banner-color', powerups.banner.color);
    banner.classList.add('show');
  } else {
    banner.classList.remove('show');
  }
}

const powerupCallbacks: PowerupCallbacks = {
  emit(event: ItemEvent) {
    if (!localRace && socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'item', event }));
    }
  },
  sfx(kind) {
    motor.sfx(kind);
  }
};
let last = performance.now();
function tick(now: number) {
  const dt = Math.min(.05, (now - last) / 1000);
  last = now;
  const racing = screen === 'race' || screen === 'spectate' || screen === 'results';
  if (racing && room?.start != null) {
    const elapsed = Date.now() + clock - room.start;
    const me = room.drivers.find(d => d.id === player);
    const active = screen === 'race' && elapsed >= 0 && elapsed < LIMIT && local.s < LAPS;
    if (active && starting) { starting = false; touch.calibrate(); }
    const before = local.s;
    if (localRace) {
      const changed = localRace.step(touch.input(), dt, elapsed);
      if (screen === 'results' && changed) updateResults();
    } else if (active) {
      drive(local, touch.input(), Math.min(dt, elapsed / 1000), track);
    }
    const mine = pose(local);
    if (screen === 'race' && elapsed >= 0) {
      const progress = !localRace && mine[0] >= LAPS ? Math.max(LAPS, local.s) : local.s;
      timing.step(before, progress, Math.min(elapsed, LIMIT), dt * 1000, localRace?.human.finish ?? undefined);
    }
    if (!localRace && !room.complete && elapsed >= LIMIT && checkedDeadline !== room.start && socket?.readyState === WebSocket.OPEN) {
      socket.send('status');
      checkedDeadline = room.start;
    }
    const visible = room.drivers.filter(d => d.online).map(d => {
      if (d.id === player) return { ...d, pose: mine };
      if (localRace) return d;
      const p = remotes.get(d.id) ?? [...d.pose] as Pose;
      for (let i = 0; i < p.length; i++) p[i] += (d.pose[i] - p[i]) * Math.min(1, dt * 15);
      remotes.set(d.id, p);
      return { ...d, pose: p };
    });
    const current = room.drivers.map(d => d.id === player ? { ...d, pose: mine } : d);
    const place = rank(current).findIndex(d => d.id === player) + 1;
    if (active) {
      const callbacks: PowerupCallbacks = localRace
        ? { ...powerupCallbacks, onActorHit: actorId => localRace!.hitBot(actorId) }
        : powerupCallbacks;
      if (touch.consumeItem()) powerups.useItem(player, local, visible, callbacks, track);
      powerups.step(dt, player, local, visible, place, room.drivers.length, localRace?.racers === 1, callbacks, Math.random, track);
    } else if (room.start !== null) {
      powerups.stepSpectator(dt, visible, track);
    }
    const updatedMine = pose(local);
    if (!localRace && screen === 'race' && elapsed >= 0 && me?.finish === null) {
      updatedMine[0] = Math.min(updatedMine[0], LAPS);
      if (now - sent >= 55 && socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(updatedMine)); sent = now;
      }
    }
    if (screen === 'race' && (me?.finish != null || room.complete)) results();
    if (screen === 'race') {
      set('lap', `${Math.min(LAPS, 1 + Math.max(0, Math.floor(updatedMine[0])))}/${LAPS}`);
      set('speed', String(Math.round(local.speed * 3.6)));
      set('place', `${place}/${room.drivers.length}`);
      set('elapsed', formatTime(clamp(elapsed, 0, LIMIT)));
      set('remaining', `${formatTime(Math.ceil((LIMIT - clamp(elapsed, 0, LIMIT)) / 1000) * 1000).split('.')[0]} left`);
      set('status', elapsed < 0 ? String(Math.min(3, Math.ceil(-elapsed / 1000))) : elapsed < 630 ? 'GO!' : '');
      $('boost').style.transform = `scaleX(${local.star > 0 ? 1 : local.boost > 0 ? clamp(local.boost / 1.95, 0, 1) : local.drift})`;
      updateItemHud();
    }
    if (screen === 'race' || screen === 'spectate') drawTrackMap($<HTMLCanvasElement>('map'), track, visible, player);
    motor.update(active || screen === 'race' && elapsed < 0 ? local : undefined);
    const target = !me ? visible.find(d => d.id === followed && d.finish === null) ?? visible.find(d => d.finish === null) ?? visible[0] : undefined;
    followed = target?.id ?? '';
    view.render(target?.pose ?? updatedMine, visible, player, dt, false, powerups);
  } else {
    if (screen === 'controls' && localRace?.room.start != null) {
      localRace.step(touch.input(), dt, Date.now() - localRace.room.start);
    }
    const demo: Pose = [.968 + .009 * Math.sin(now / 4200), 1.5, 0, 0, 0, 0];
    view.render(demo, [], '', dt, true);
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
