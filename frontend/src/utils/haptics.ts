// Browser Vibration API wrapper for tactile touch feedback

export const vibrate = (pattern: number | number[] = 25) => {
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
  goal: () => vibrate([50, 40, 80]),
  sub: () => vibrate([30, 30, 30]),
  period: () => vibrate([100, 50, 100]),
  warning: () => vibrate([60, 40, 60]),
};
