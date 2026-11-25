import './style.css';
import { Motor } from './audio';
import { DIFFICULTIES, LocalRace, MAX_RACERS, type Difficulty } from './bots';
import { COLORS, COUNTDOWN, LAPS, LIMIT, clamp, delta, getTrack } from './circuit';
import { Controls } from './controls';
import { cupItinerary, cupSelector, fillCupResults } from './cup-ui';
import { CUPS, CUP_IDS, cupTrack, isCupId, newCup, nextRound, type Cup } from './cups';
import { bump, drive, grid, pose, remoteContact, sampleRemote, substep, type Kart, type Pose, type RemoteSample } from './drive';
import { newDriverId } from './driver-id';
import { decodeGhost, ghostPose, ghostTimeAt, type Ghost, type Replay, type Standing } from './ghost';
import { RaceMusic } from './music';
import { POWERUPS, PowerupState, type ItemEvent, type PowerupCallbacks, type PowerupId } from './powerups';
import { readPreference, writePreference } from './preferences';
import { rank, type Driver, type RoomState, type ServerMessage } from './rules';
import { View, type Actor } from './scene';
import { TimeTrial } from './time-trial';
import { drawTrackMap, trackSelector, trackTag } from './track-ui';
import { courseLayoutKey, DEFAULT_TRACK, isTrackId, type TrackId } from './tracks';
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
let screen: 'home' | 'bots' | 'grand-prix' | 'controls' | 'time-trial' | 'join' | 'lobby' | 'race' | 'spectate' | 'results' = code ? 'join' : 'home';
let socket: WebSocket | undefined;
let heartbeat = 0, clock = 0, sent = 0;
let player = '', local = grid(0), room: RoomState | undefined;
let localRace: LocalRace | undefined;
let timing = new RaceTiming();
let timingKey = '';
type LapGhost = { replay: Replay; decoded: Ghost };
type Trial = { race: TimeTrial; name: string; personal?: LapGhost; world?: LapGhost };
let trial: Trial | undefined;
let trialDriverId: string | undefined;
let issue = '', starting = false, joining = false;
let followed = '', checkedDeadline: number | null = null;
let view: View;
let practiceTrack: TrackId = DEFAULT_TRACK;
let track = getTrack();
const remotes = new Map<string, Pose>();
const remoteSamples = new Map<string, RemoteSample>();
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

function prepareLocal(racers: number, back: () => void, cup?: Cup, difficulty?: Difficulty) {
  motor.start();
  if (!touch.touch) { startLocal(racers, cup, difficulty); return; }
  screen = 'controls';
  show(`<section class="poster compact">${identity}<h2 class="title">Phone controls</h2>
    ${phoneSetup()}
    <p class="help">Hold your phone like a wheel. The kart accelerates automatically.</p>
    <div class="actions">${button('start', cup ? 'Start cup' : 'Start race')}${button('back', 'Back', true)}</div>
    </section>${trackTag(track)}`);
  bindTilt();
  doOn('start', () => { motor.start(); startLocal(racers, cup, difficulty); });
  doOn('back', back);
}

function displayTrack(id: TrackId) {
  track = getTrack(id);
  view.setTrack(track);
}

function selectById(id: string) {
  return Array.from(ui.querySelectorAll('select')).find(select => select.id === id);
}

function bindTrackPicker(onChange: (id: TrackId) => void) {
  const select = selectById('track-select')!;
  select.onchange = () => { if (isTrackId(select.value)) onChange(select.value); };
}

function menu() {
  if (screen === 'home') {
    displayTrack(practiceTrack);
    show(`<section class="poster">${identity}<h1 class="title">Tilt <span>Kart</span></h1>
      <p class="intro">Eight circuits, three laps each. Send a link to race up to seven friends.</p>
      ${trackSelector(practiceTrack)}
      <div class="actions">${button('grand-prix', 'Grand Prix')}${button('create', 'Create room')}${button('time-trial', 'Time trial', true)}${button('bots', 'Vs bots', true)}${button('solo', 'Solo practice', true)}</div>
      <p class="help">${notes()}</p></section>${trackTag(track)}`);
    bindTrackPicker(id => {
      practiceTrack = id;
      displayTrack(id);
      $('track-callout').outerHTML = trackTag(track);
    });
    doOn('create', () => { screen = 'join'; menu(); });
    doOn('bots', () => { screen = 'bots'; menu(); });
    doOn('grand-prix', () => { screen = 'grand-prix'; menu(); });
    doOn('time-trial', openTimeTrials);
    doOn('solo', () => prepareLocal(1, home));
    return;
  }
  if (screen === 'time-trial') {
    showTimeTrials();
    return;
  }
  if (screen === 'bots' || screen === 'grand-prix') {
    const gp = screen === 'grand-prix';
    if (gp) displayTrack(CUPS[CUP_IDS[0]].tracks[0]);
    const options = Array.from({ length: MAX_RACERS - 1 }, (_, i) => {
      const racers = i + 2;
      return `<option value="${racers}"${racers === 6 ? ' selected' : ''}>${racers} (you + ${racers - 1} ${racers === 2 ? 'bot' : 'bots'})</option>`;
    }).join('');
    const difficulties = DIFFICULTIES.map(level => `<option${level === 'Normal' ? ' selected' : ''}>${level}</option>`).join('');
    show(`<section class="poster compact">${identity}<h2 class="title">${gp ? 'Grand Prix' : 'Vs bots'}</h2>
      <form class="setup" id="bot-setup">
      ${gp ? `${cupSelector()}<div id="cup-route">${cupItinerary(CUP_IDS[0])}</div>` : ''}
      <label for="racers">Total racers</label><select id="racers" name="racers">${options}</select>
      ${gp ? '' : `<label for="difficulty">Difficulty</label><select id="difficulty" name="difficulty">${difficulties}</select>`}
      <div class="actions"><button class="action" type="submit">${touch.touch ? 'Phone controls' : gp ? 'Start cup' : 'Start race'}</button>${button('back', 'Back', true)}</div></form>
      <p class="help">${gp ? 'Finish each race to score points. In a room, the host can choose a cup for everyone.' : notes()}</p></section>${trackTag(track)}`);
    const setup = $<HTMLFormElement>('bot-setup');
    const picker = selectById('cup-select');
    if (picker) picker.onchange = () => {
      if (!isCupId(picker.value)) return;
      $('cup-route').innerHTML = cupItinerary(picker.value);
      displayTrack(CUPS[picker.value].tracks[0]);
      $('track-callout').outerHTML = trackTag(track);
    };
    setup.onsubmit = e => {
      e.preventDefault();
      const data = new FormData(setup);
      const racers = Number(data.get('racers'));
      const difficulty = DIFFICULTIES.find(level => level === data.get('difficulty'));
      const selected = picker?.value;
      const cup = selected && isCupId(selected) ? newCup(selected) : undefined;
      prepareLocal(racers, () => { screen = gp ? 'grand-prix' : 'bots'; menu(); }, cup, difficulty);
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
    const focus = document.activeElement?.id;
    const cup = room.cup;
    show(`<section class="poster compact">${identity}<h2 class="title">Starting grid</h2>
      <div id="room-code">Room ${code} · ${room.drivers.length}/8 drivers</div><ol class="list" id="roster"></ol>
      ${isHost ? `<div class="track-picker cup-picker">${cupSelector(cup?.id, true)}</div>` : ''}
      ${cup ? `${isHost ? '' : `<p class="lobby-track"><strong>${CUPS[cup.id].name}</strong></p>`}${cupItinerary(cup.id)}` : isHost ? trackSelector(track.id) : `<p class="lobby-track">Track: <strong>${track.name}</strong></p>`}
      ${phoneSetup()}
      <div class="actions">${button('share', 'Invite friends', true)}${isHost ? button('start', cup ? 'Start cup' : 'Start race') : ''}${button('leave', 'Leave', true)}</div>
      <p class="notice" id="notice" role="status"></p></section>${trackTag(track)}`);
    if (isHost) {
      const picker = selectById('cup-select')!;
      picker.onchange = () => { if (socket?.readyState === WebSocket.OPEN) socket.send(`cup:${picker.value}`); };
      if (!cup) bindTrackPicker(id => { if (socket?.readyState === WebSocket.OPEN) socket.send(`track:${id}`); });
      if (focus === 'cup-select' || focus === 'track-select') $(focus)?.focus();
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

function trialKey(id: TrackId) { return `tilt-kart-trial-best-${courseLayoutKey(id)}`; }
function trialUrl(id: TrackId) { return `/api/tt/${courseLayoutKey(id)}`; }

function lapGhost(replay: Replay | null): LapGhost | undefined {
  if (!replay || typeof replay.ghost !== 'string') return;
  const decoded = decodeGhost(replay.lapMs, replay.ghost);
  if (decoded) return { replay, decoded };
}

function personalGhost(id: TrackId) {
  try { return lapGhost(JSON.parse(readPreference(trialKey(id)) ?? 'null')); } catch { return; }
}

async function trialRequest<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error('Time trial request failed');
  return res.json();
}

function formatLap(ms: number) {
  return `${formatTime(ms)}${Math.floor(ms % 10)}`;
}

function openTimeTrials() {
  close();
  screen = 'time-trial';
  menu();
}

function showTimeTrials() {
  displayTrack(practiceTrack);
  show(`<section class="poster compact trial-poster"><h2 class="title">Time trial</h2>
    <p class="intro">One flying lap. Chase your best and the world record.</p>
    <form class="setup" id="trial-setup">${trackSelector(practiceTrack)}
    <label for="trial-driver">Public driver name</label>
    <input id="trial-driver" maxlength="20" autocomplete="nickname" required placeholder="Your name">
    ${phoneSetup()}
    <div class="actions"><button class="action" id="start" type="submit">Start lap</button>${button('back', 'Back', true)}</div></form>
    <p class="trial-best" id="personal-best"></p>
    <section aria-labelledby="board-title"><h3 class="board-title" id="board-title">World leaderboard</h3>
    <ol class="list" id="standings"></ol><p id="board-message" role="status"></p></section>
    </section>${trackTag(track)}`);
  const input = $<HTMLInputElement>('trial-driver');
  input.value = readPreference('tilt-kart-name') ?? '';
  const list = $('standings'), message = $('board-message');
  let request = 0;
  const loadBoard = async (id: TrackId) => {
    const current = ++request;
    const best = personalGhost(id);
    $('personal-best').textContent = best ? `Personal best · ${formatLap(best.replay.lapMs)}` : 'No personal best yet';
    list.replaceChildren();
    message.textContent = 'Loading times…';
    try {
      const standings = await trialRequest<Standing[]>(`${trialUrl(id)}/leaderboard`);
      if (current !== request || !list.isConnected) return;
      message.textContent = standings.length ? '' : 'No times yet. Set the first one.';
      standings.forEach(({ name, lapMs }, index) => {
        const row = document.createElement('li');
        const place = document.createElement('strong'), driverName = document.createElement('span'), time = document.createElement('small');
        place.textContent = String(index + 1);
        driverName.className = 'driver-name';
        driverName.textContent = name;
        time.textContent = formatLap(lapMs);
        row.appendChild(place);
        row.appendChild(driverName);
        row.appendChild(time);
        list.appendChild(row);
      });
    } catch {
      if (current === request && list.isConnected) message.textContent = 'Leaderboard offline. You can still set a personal best.';
    }
  };
  bindTrackPicker(id => {
    practiceTrack = id;
    displayTrack(id);
    $('track-callout').outerHTML = trackTag(track);
    void loadBoard(id);
  });
  $<HTMLFormElement>('trial-setup').onsubmit = e => {
    e.preventDefault();
    if (touch.tiltStatus === 'waiting') return;
    const name = input.value.trim();
    if (!name) { input.value = ''; input.reportValidity(); return; }
    writePreference('tilt-kart-name', name);
    motor.start();
    startTrial(name);
  };
  bindTilt();
  doOn('back', home);
  void loadBoard(practiceTrack);
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
  trial = undefined;
  remotes.clear();
  remoteSamples.clear();
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
          if (d.id !== player) trackRemote(d.id, message.pose);
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

function trackRemote(id: string, pose: Pose) {
  remoteSamples.set(id, sampleRemote(pose, performance.now(), remoteSamples.get(id), track));
}

function receiveRoom(next: RoomState) {
  const newRace = room?.start !== next.start;
  for (const d of next.drivers) {
    if (d.id === player) continue;
    if (!d.online) remoteSamples.delete(d.id);
    else if (d.pose.some((n, i) => n !== remoteSamples.get(d.id)?.pose[i])) {
      trackRemote(d.id, d.pose);
    }
  }
  room = next;
  const me = next.drivers.find(d => d.id === player);
  if (next.start === null) {
    music.stop();
    screen = 'lobby';
    menu();
  } else if (next.complete || me?.finish != null) {
    if (screen === 'lobby' || newRace) resetRace(me);
    results();
  } else if (screen === 'lobby' || newRace) {
    if (me) begin();
    else spectate();
  }
}

function startLocal(racers: number, cup?: Cup, difficulty?: Difficulty) {
  close();
  localRace = new LocalRace(racers, Date.now() + COUNTDOWN, getTrack(practiceTrack), cup, difficulty);
  player = localRace.human.id;
  clock = 0;
  room = localRace.room;
  begin();
}

function startTrial(name: string) {
  close();
  const id = practiceTrack;
  const attempt: Trial = { race: new TimeTrial(getTrack(id), performance.now()), name, personal: personalGhost(id) };
  trial = attempt;
  player = 'trial-driver';
  begin();
  void trialRequest<Replay | null>(`${trialUrl(id)}/ghost`).then(replay => {
    if (trial === attempt) attempt.world = lapGhost(replay);
  }).catch(() => {});
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
  remoteSamples.clear();
  powerups.reset();
  view.resetEffects();
  lastItemKey = '';
}

function spectate() {
  screen = 'spectate';
  resetRace();
  show(`<div class="hud" aria-label="Race overview">
      <div class="hud-box" role="status"><strong>Spectating</strong><small>${room?.cup ? 'You can race in the next cup.' : 'You’re on the grid next race.'}</small></div>
      <canvas id="map" class="map" width="160" height="130" aria-label="${track.name} circuit map"></canvas></div>
    <div class="hud-actions"><button class="tool" id="exit">Exit</button></div>`);
  doOn('exit', home);
}

function begin() {
  screen = 'race';
  wake.setActive(true);
  if (trial) {
    displayTrack(trial.race.track.id);
    local = trial.race.kart;
    starting = true;
  } else resetRace(room!.drivers.find(d => d.id === player));
  const cup = room?.cup;
  music.start(track.id);
  show(`<div class="hud${trial ? ' trial-hud' : ''}" aria-label="Race overview">
      ${trial ? `<div class="hud-box trial-clock"><small>Lap time</small><em id="trial-clock">0:00.000</em></div>
      <div class="hud-box trial-clock"><small id="trial-target">Ghost delta</small><em id="trial-delta">—</em></div>` :
      `<div class="hud-box"><small>${cup ? `Race ${cup.round + 1}/${CUPS[cup.id].tracks.length} · Lap` : 'Lap'}</small><em id="lap">1/3</em></div>
      <div class="hud-box"><small>Place</small><em id="place">1/${room!.drivers.length}</em></div>`}
      <div class="hud-box"><small>km/h</small><em id="speed">0</em></div>
      ${trial ? '' : `<div class="hud-box race-clock"><small>Race time</small><em id="elapsed">0:00.00</em><small id="remaining">3:00 left</small></div>
      <button class="hud-box item-slot" id="item-slot" type="button" aria-label="Use power-up"><small id="item-hint">Item</small><span id="item-icon" class="item-icon">?</span><b id="item-name">Empty</b></button>`}
      <canvas id="map" class="map" width="160" height="130" aria-label="${track.name} circuit map"></canvas>
    </div>
    <div class="hud-actions"><button class="tool" id="tilt"${touch.touch ? '' : ' hidden'}>Enable tilt</button><button class="tool" id="music"></button><button class="tool" id="sound"></button><button class="tool" id="exit">Exit</button></div>
    <div class="status" id="status" role="status"></div>${trial ? '' : '<div class="item-banner" id="item-banner" role="status"></div>'}
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
  itemBtn?.addEventListener('pointerdown', e => {
    e.preventDefault();
    touch.queueItem();
    itemBtn.blur();
  });
  itemBtn?.addEventListener('click', e => {
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
  doOn('confirm-exit', trial ? openTimeTrials : home);
}

function trialResults(attempt: Trial) {
  music.stop();
  wake.setActive(false);
  screen = 'results';
  const { race, name, personal } = attempt;
  const replay = race.replay;
  if (replay) motor.finish();
  const improved = replay && (!personal || replay.lapMs < personal.replay.lapMs);
  if (improved) writePreference(trialKey(race.track.id), JSON.stringify(replay));
  const best = improved ? replay : personal?.replay;
  show(`<section class="results" aria-labelledby="result-title"><div class="result-sheet"><p class="identity">Time trial / ${race.track.name}</p>
    <h2 class="title" id="result-title">${replay ? formatLap(replay.lapMs) : 'Time expired'}</h2>
    ${best ? `<p>${improved ? 'New personal best' : `Personal best · ${formatLap(best.lapMs)}`}</p>` : ''}
    <p id="result-status" role="status"></p>
    <div class="actions">${button('retry', 'Race again')}${button('back', 'Leaderboard', true)}</div>
    </div></section>`);
  doOn('back', openTimeTrials);
  doOn('retry', () => startTrial(name));
  if (!replay || !best) return;
  const status = $('result-status');
  status.textContent = 'Posting your best lap…';
  const key = 'tilt-kart-trial-driver';
  trialDriverId ??= readPreference(key) || newDriverId();
  writePreference(key, trialDriverId);
  void trialRequest<{ rank: number; lapMs: number }>(trialUrl(race.track.id), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...best, name, driverId: trialDriverId }),
  }).then(({ rank, lapMs }) => {
    status.textContent = `World rank #${rank} · ${formatLap(lapMs)}`;
  }).catch(() => {
    status.textContent = 'Best lap saved on this device. The leaderboard is unavailable.';
  });
}

function results() {
  music.stop();
  const me = room?.drivers.find(d => d.id === player);
  const finish = me?.finish ?? null;
  if (screen === 'race' && finish !== null) motor.finish();
  screen = 'results';
  wake.setActive(false);
  const splits = timing.splits(finish !== null), records = timing.records(finish);
  const time = finish === null ? 'DNF' : formatTime(finish);
  const splitsAndRecords = `
    <dl class="splits" aria-label="Lap splits">${Array.from({ length: LAPS }, (_, i) =>
      `<div><dt>Lap ${i + 1}</dt><dd>${formatTime(splits[i] ?? Infinity)}</dd></div>`).join('')}</dl>
    <dl class="records" aria-label="Personal bests"><div><dt>Best lap</dt><dd>${formatTime(records.lap)}</dd></div>
      <div><dt>Best time</dt><dd>${formatTime(records.race)}</dd></div></dl>`;
  if (room?.cup && room.complete) {
    cupResults(room.cup, me ? `<details><summary>${track.name} · Your result: ${time}</summary>${splitsAndRecords}</details>` : '');
    return;
  }
  const racers = localRace?.racers;
  const difficulty = localRace?.difficulty;
  const retry = room?.cup ? '' : racers ? 'Race again' : room?.host === player ? 'Rematch' : '';
  show(`<section class="results" aria-labelledby="result-title"><div class="result-sheet"><p class="identity">Tilt Kart / ${track.name}${racers && racers > 1 && !room?.cup ? ` / ${difficulty}` : ''}</p>
    <h2 class="title" id="result-title">${racers === 1 ? 'Practice results' : 'Race results'}</h2>
    ${me ? `<p class="finish-time"><small>Your result</small><strong>${time}</strong></p>${splitsAndRecords}` : ''}
    <ol class="list" id="results-list"></ol><p id="result-status"></p>
    <div class="actions">${button('back', 'Main menu', true)}${retry ? button('retry', retry) : ''}</div>
    </div></section>`);
  updateResults();
  doOn('back', home);
  if (retry) doOn('retry', () => racers ? prepareLocal(racers, results, undefined, difficulty) : socket?.send('rematch'));
}

function cupResults(cup: Cup, timingDetails: string) {
  const event = CUPS[cup.id];
  const next = nextRound(cup);
  const racers = localRace?.racers;
  const canContinue = Boolean(racers || room?.host === player);
  const continueLabel = next ? `Next: ${getTrack(cupTrack(next)).name}` : racers ? 'Race cup again' : 'Back to lobby';
  show(`<section class="results" aria-labelledby="result-title"><div class="result-sheet cup-sheet">
    <div class="cup-content" role="region" aria-labelledby="result-title" tabindex="0">
      <p class="identity">${event.name} / Race ${cup.round + 1} of ${event.tracks.length}</p>
      <h2 class="title" id="result-title">${next ? 'Cup standings' : 'Cup podium'}</h2>
      ${next ? `<p>${track.name} complete · Next: ${getTrack(cupTrack(next)).name}</p>` : '<ol class="cup-podium" id="cup-podium" aria-label="Top finishers"></ol>'}
      <table class="cup-table" id="cup-table" aria-label="${event.name} points"><thead><tr><th scope="col">Driver</th>
      ${cup.results.map((_, i) => `<th scope="col" title="${getTrack(event.tracks[i]).name}">R${i + 1}</th>`).join('')}
      <th scope="col">Total</th></tr></thead><tbody></tbody></table>
      ${timingDetails}
      ${canContinue ? '' : `<p class="cup-wait" role="status">Waiting for the host to ${next ? 'start the next race' : 'return to the lobby'}.</p>`}
    </div>
    <div class="actions">${canContinue ? button('cup-next', continueLabel) : ''}${button('back', 'Main menu', true)}</div>
    </div></section>`);
  fillCupResults(cup, player);
  doOn('back', home);
  if (canContinue) doOn('cup-next', () => {
    if (racers) startLocal(racers, next ?? newCup(cup.id));
    else if (socket?.readyState === WebSocket.OPEN) socket.send(next ? `next:${cup.round}` : 'rematch');
  });
}

function updateResults() {
  if (!room) return;
  const list = $('results-list');
  if (!list) return;
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

function tickTrial(attempt: Trial, now: number, dt: number) {
  const { race, name, personal, world } = attempt;
  if (screen === 'race') {
    touch.consumeItem();
    if (starting && now >= race.start) { starting = false; touch.calibrate(); }
    race.step(touch.input(), now);
    if (race.finished) trialResults(attempt);
  }
  const mine = pose(race.kart);
  const actors: Actor[] = [{ id: player, name, pose: mine, slot: 0 }];
  if (screen === 'race') {
    const elapsed = race.elapsed;
    const target = personal ?? world;
    const shared = personal && world && personal.replay.ghost === world.replay.ghost && personal.replay.lapMs === world.replay.lapMs;
    const addGhost = (id: string, label: string, ghost: LapGhost, color: string) => {
      if (now >= race.start && elapsed <= ghost.decoded.lapMs) actors.push({
        id, name: label, pose: ghostPose(ghost.decoded, elapsed), slot: 0, ghostColor: color,
      });
    };
    if (shared) addGhost('ghost-shared', 'Personal / world best', personal, '#7ce3f6');
    else {
      if (personal) addGhost('ghost-personal', 'Personal best', personal, '#7ce3f6');
      if (world) addGhost('ghost-world', 'World best', world, '#ffa1b9');
    }
    set('trial-target', personal ? 'Δ Personal best' : world ? 'Δ World best' : 'Ghost delta');
    const gap = target ? Math.round(elapsed - ghostTimeAt(target.decoded, mine[0])) : 0;
    set('trial-delta', target && elapsed > 0 ? `${gap < 0 ? '−' : '+'}${(Math.abs(gap) / 1000).toFixed(3)}` : '—');
    set('trial-clock', formatLap(elapsed));
    set('speed', String(now < race.start ? 0 : Math.round(local.speed * 3.6)));
    set('status', now < race.start ? String(Math.min(3, Math.ceil((race.start - now) / 1000))) : elapsed < 630 ? 'GO!' : '');
    $('boost').style.transform = `scaleX(${local.boost > 0 ? clamp(local.boost / 1.5, 0, 1) : local.drift})`;
    drawTrackMap($<HTMLCanvasElement>('map'), track, actors, player);
  }
  motor.update(screen === 'race' ? local : undefined);
  view.render(mine, actors, player, dt);
}

function blendRemote(d: Driver, dt: number) {
  const p = remotes.get(d.id) ?? [...d.pose] as Pose;
  const blend = 1 - Math.exp(-dt * 15);
  for (let i = 0; i < p.length; i++) {
    const gap = d.pose[i] - p[i];
    p[i] += (i === 2 ? delta(gap, 2 * Math.PI) : gap) * blend;
  }
  p[2] = delta(p[2], 2 * Math.PI);
  remotes.set(d.id, p);
}

let last = performance.now();
function tick(now: number) {
  const dt = (now - last) / 1000;
  last = now;
  const racing = screen === 'race' || screen === 'spectate' || screen === 'results';
  if (trial) {
    tickTrial(trial, now, dt);
  } else if (racing && room?.start != null) {
    const elapsed = Date.now() + clock - room.start;
    const me = room.drivers.find(d => d.id === player);
    const canDrive = screen === 'race' && me?.finish === null && !room.complete && local.s < LAPS;
    const active = canDrive && elapsed >= 0 && elapsed < LIMIT;
    const localItemsActive = localRace && elapsed >= 0 && !room.complete;
    if (active && starting) { starting = false; touch.calibrate(); }
    const before = local.s;
    const beforeLane = local.lane;
    const frameRaceDt = clamp((Math.min(elapsed, LIMIT) - Math.max(0, elapsed - dt * 1000)) / 1000, 0, dt);
    if (localRace) {
      const changed = localRace.step(touch.input(), dt, elapsed, {
        state: powerups, callbacks: powerupCallbacks, usePlayerItem: active && touch.consumeItem(),
      });
      if (screen === 'results' && changed) {
        if (room.complete && room.cup) results();
        else updateResults();
      }
    } else {
      const peers = room.drivers.filter(d => d.id !== player && d.online);
      const raceDt = canDrive ? frameRaceDt : 0;
      for (const peer of peers) blendRemote(peer, dt);
      if (raceDt > 0) {
        const input = touch.input();
        let stepAt = now - raceDt * 1000;
        substep(raceDt, step => {
          stepAt += step * 1000;
          drive(local, input, step, track);
          for (const peer of peers) {
            if (peer.finish === null && local.star <= 0 && powerups.fxOf(peer.id).star <= 0) {
              const sample = remoteSamples.get(peer.id) ?? { pose: peer.pose, receivedAt: now };
              bump(local, remoteContact(sample, stepAt, track), track);
            }
          }
        });
      }
    }
    const mine = pose(local);
    if (screen === 'race' && elapsed >= 0) {
      const progress = !localRace && mine[0] >= LAPS ? Math.max(LAPS, local.s) : local.s;
      timing.step(before, progress, Math.min(elapsed, LIMIT), frameRaceDt * 1000, localRace?.human.finish ?? undefined);
    }
    if (!localRace && !room.complete && elapsed >= LIMIT && checkedDeadline !== room.start && socket?.readyState === WebSocket.OPEN) {
      socket.send('status');
      checkedDeadline = room.start;
    }
    const visible = room.drivers.filter(d => d.online).map(d => {
      if (d.id === player) return { ...d, pose: mine };
      return localRace ? d : { ...d, pose: remotes.get(d.id) ?? d.pose };
    });
    const current = room.drivers.map(d => d.id === player ? { ...d, pose: mine } : d);
    const place = rank(current).findIndex(d => d.id === player) + 1;
    if (!localRace && active) {
      if (touch.consumeItem()) powerups.useItem(player, local, visible, powerupCallbacks, track);
      powerups.step(dt, player, local, visible, place, room.drivers.length, false, powerupCallbacks, Math.random, track, { s: before, lane: beforeLane });
    } else if (!localItemsActive) {
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
