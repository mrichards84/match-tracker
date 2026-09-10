// Screen Wake Lock API wrapper to prevent screen timeout pitch-side

class WakeLockManager {
  private sentinel: WakeLockSentinel | null = null;
  private isRequested = false;

  async request(): Promise<boolean> {
    this.isRequested = true;
    if (typeof window === 'undefined' || !('wakeLock' in navigator)) {
      return false;
    }

    try {
      if (!this.sentinel) {
        this.sentinel = await navigator.wakeLock.request('screen');
        this.sentinel.addEventListener('release', () => {
          this.sentinel = null;
          // Re-acquire if still requested (e.g. user minimized and returned to tab)
          if (this.isRequested && document.visibilityState === 'visible') {
            this.request();
          }
        });
      }
      return true;
    } catch {
      this.sentinel = null;
      return false;
    }
  }

  async release(): Promise<void> {
    this.isRequested = false;
    if (this.sentinel) {
      try {
        await this.sentinel.release();
      } catch {
        // Ignore
      }
      this.sentinel = null;
    }
  }

  isActive(): boolean {
    return this.sentinel !== null;
  }
}

export const wakeLock = new WakeLockManager();
