import { clamp, delta } from './circuit';
import type { Input } from './drive';

type Orientation = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<string> };

export class Controls {
  private keys = new Set<string>();
  private pointers = new Map<number, 'left' | 'right' | 'brake'>();
  private itemQueued = false;
  private roll: number | undefined;
  private neutral: number | undefined;
  private orientation = 0;
  private tiltListener = false;
  private tiltTimer = 0;
  tiltStatus: 'idle' | 'waiting' | 'denied' | 'unavailable' | 'ready' = 'idle';
  touch = matchMedia('(pointer: coarse)').matches;

  constructor(private change: () => void, racing: () => boolean) {
    addEventListener('keydown', e => {
      if (!racing()) return;
      const key = e.key.toLowerCase();
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(e.key)) e.preventDefault();
      if ((key === 'e' || key === 'f' || (key === 'enter' && !(e.target instanceof HTMLButtonElement))) && !this.keys.has(key)) {
        if (key === 'enter') e.preventDefault();
        this.itemQueued = true;
      }
      this.keys.add(key);
    });
    addEventListener('keyup', e => this.keys.delete(e.key.toLowerCase()));
    addEventListener('blur', () => { this.keys.clear(); this.pointers.clear(); this.itemQueued = false; });
  }

  queueItem() {
    this.itemQueued = true;
  }

  consumeItem(): boolean {
    if (!this.itemQueued) return false;
    this.itemQueued = false;
    return true;
  }

  calibrate() {
    this.neutral = this.roll;
  }

  get tilted() { return this.roll !== undefined; }

  async enableTilt() {
    if (this.tilted) { this.calibrate(); return; }
    if (this.tiltStatus === 'waiting') return;
    const sensor = window.DeviceOrientationEvent as Orientation | undefined;
    if (!sensor) { this.setTiltStatus('unavailable'); return; }
    this.setTiltStatus('waiting');
    try {
      if (!this.tiltListener && sensor.requestPermission && await sensor.requestPermission() !== 'granted') {
        this.setTiltStatus('denied');
        return;
      }
    } catch { this.setTiltStatus('denied'); return; }
    if (!this.tiltListener) {
      addEventListener('deviceorientation', e => {
        if (e.beta === null || e.gamma === null) return;
        const angle = screen.orientation?.angle || (window as Window & { orientation?: number }).orientation || 0;
        const roll = angle === 90 ? e.beta : Math.abs(angle) === 90 || angle === 270 ? -e.beta : angle === 180 ? -e.gamma : e.gamma;
        if (this.orientation !== angle) { this.neutral = undefined; this.orientation = angle; }
        this.roll = roll;
        this.neutral ??= roll;
        if (this.tiltStatus !== 'ready') {
          window.clearTimeout(this.tiltTimer);
          this.setTiltStatus('ready');
        }
      });
      this.tiltListener = true;
    }
    this.tiltTimer = window.setTimeout(() => this.setTiltStatus('unavailable'), 1500);
  }

  private setTiltStatus(status: Controls['tiltStatus']) {
    this.tiltStatus = status;
    this.change();
  }

  bindTouch() {
    this.pointers.clear();
    for (const id of ['left', 'right', 'brake'] as const) {
      const button = document.getElementById(id)!;
      button.addEventListener('pointerdown', e => {
        e.preventDefault(); button.setPointerCapture(e.pointerId); this.pointers.set(e.pointerId, id);
      });
      for (const event of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
        button.addEventListener(event, e => this.pointers.delete(e.pointerId));
      }
    }
  }

  input(): Input {
    const held = (...keys: string[]) => keys.some(k => this.keys.has(k));
    const pointer = (action: string) => [...this.pointers.values()].includes(action as 'left');
    const steer = Number(held('d', 'arrowright') || pointer('right')) - Number(held('a', 'arrowleft') || pointer('left'));
    const angle = this.roll === undefined || this.neutral === undefined ? 0 : delta(this.roll - this.neutral, 360);
    const dead = Math.sign(angle) * Math.max(0, Math.abs(angle) - 3);
    return {
      steer: -(steer || clamp(dead / 27, -1, 1)),
      brake: held('s', 'arrowdown', ' ') || pointer('brake'),
      gas: this.touch || this.tilted || held('w', 'arrowup')
    };
  }
}
