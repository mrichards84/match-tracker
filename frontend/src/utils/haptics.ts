// Browser Vibration API wrapper for tactile touch feedback

export const HAPTICS_STORAGE_KEY = 'match_tracker_haptics_enabled';

export function isHapticsEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const stored = localStorage.getItem(HAPTICS_STORAGE_KEY);
    // Enabled by default
    if (stored === null) return true;
    return stored === 'true';
  } catch {
    return true;
  }
}

export function setHapticsEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(HAPTICS_STORAGE_KEY, enabled ? 'true' : 'false');
    window.dispatchEvent(
      new CustomEvent('haptics-setting-changed', { detail: { enabled } })
    );
  } catch {}
}

export const vibrate = (pattern: number | number[] = 25) => {
  if (!isHapticsEnabled()) return;
  if (typeof window !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate(pattern);
    } catch {
      // Ignore vibration errors if disabled or unpermitted
    }
  }
};

export const hapticFeedback = {
  tap: () => vibrate(15),
  goal: () => vibrate([60, 40, 90]),
  sub: () => vibrate([40, 30, 40]),
  subAlert: () => vibrate([90, 60, 90, 60, 160]),
  period: () => vibrate([120, 60, 120, 60, 200]),
  warning: () => vibrate([60, 40, 60]),
  test: () => vibrate([80, 50, 80, 50, 150])
};
