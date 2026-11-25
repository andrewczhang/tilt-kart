import type { Input } from './drive';

type TouchAction = 'left' | 'right' | 'brake';

export class Controls {
  private keys = new Set<string>();
  private pointers = new Map<number, TouchAction>();
  private itemQueued = false;
  touch = matchMedia('(pointer: coarse)').matches;

  constructor(racing: () => boolean) {
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
    addEventListener('blur', () => { this.keys.clear(); this.clearPointers(); this.itemQueued = false; });
  }

  queueItem() {
    this.itemQueued = true;
  }

  consumeItem(): boolean {
    if (!this.itemQueued) return false;
    this.itemQueued = false;
    return true;
  }

  bindTouch() {
    this.clearPointers();
    for (const id of ['left', 'right', 'brake'] as const) {
      const button = document.getElementById(id)!;
      button.addEventListener('pointerdown', e => {
        e.preventDefault(); button.setPointerCapture(e.pointerId); this.pointers.set(e.pointerId, id);
        button.toggleAttribute('data-held', true);
      });
      for (const event of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
        button.addEventListener(event, e => {
          this.pointers.delete(e.pointerId);
          button.toggleAttribute('data-held', this.pointerHeld(id));
        });
      }
    }
  }

  private clearPointers() {
    for (const action of new Set(this.pointers.values())) document.getElementById(action)?.removeAttribute('data-held');
    this.pointers.clear();
  }

  private pointerHeld(action: TouchAction) {
    return [...this.pointers.values()].includes(action);
  }

  input(): Input {
    const held = (...keys: string[]) => keys.some(k => this.keys.has(k));
    return {
      steer: Number(held('a', 'arrowleft') || this.pointerHeld('left')) - Number(held('d', 'arrowright') || this.pointerHeld('right')),
      brake: held('s', 'arrowdown', ' ') || this.pointerHeld('brake'),
      gas: this.touch || held('w', 'arrowup')
    };
  }
}
