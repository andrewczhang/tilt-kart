export class RaceWakeLock {
  private active = false;
  private pending = false;
  private lock?: WakeLockSentinel;

  constructor() {
    document.addEventListener('visibilitychange', () => void this.acquire());
  }

  setActive(active: boolean) {
    this.active = active;
    if (active) void this.acquire();
    else if (this.lock) {
      const lock = this.lock;
      this.lock = undefined;
      void lock.release().catch(() => {});
    }
  }

  private async acquire() {
    if (!this.active || this.pending || this.lock && !this.lock.released || document.visibilityState !== 'visible' || !navigator.wakeLock) return;
    this.pending = true;
    try {
      const lock = await navigator.wakeLock.request('screen');
      if (!this.active || document.visibilityState !== 'visible') {
        await lock.release();
        return;
      }
      if (lock.released) return;
      this.lock = lock;
      lock.addEventListener('release', () => {
        if (this.lock === lock) this.lock = undefined;
      }, { once: true });
    } catch {} finally {
      this.pending = false;
    }
  }
}
