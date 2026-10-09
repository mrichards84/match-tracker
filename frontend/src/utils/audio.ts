// Web Audio API Whistle Synthesizer
// Generates referee whistle pulses and substitution chimes
// Disabled by default as requested (vibration only); configurable in Settings & live match

export const SOUND_STORAGE_KEY = 'match_tracker_sound_enabled';

export function isSoundEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const stored = localStorage.getItem(SOUND_STORAGE_KEY);
    // Defaults to FALSE (muted by default, vibration only)
    if (stored === null) return false;
    return stored === 'true';
  } catch {
    return false;
  }
}

export function setSoundEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(SOUND_STORAGE_KEY, enabled ? 'true' : 'false');
    window.dispatchEvent(
      new CustomEvent('sound-setting-changed', { detail: { enabled } })
    );
  } catch {}
}

class WhistleSound {
  private ctx: AudioContext | null = null;

  isEnabled(): boolean {
    return isSoundEnabled();
  }

  setEnabled(enabled: boolean): void {
    setSoundEnabled(enabled);
  }

  private getContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  }

  // Plays a standard referee whistle burst (e.g. at kick off, half time, or full time)
  // Ignored if sound is disabled
  playWhistle(duration = 0.45, repetitions = 2) {
    if (!this.isEnabled()) return;
    const ctx = this.getContext();
    if (!ctx) return;

    for (let i = 0; i < repetitions; i++) {
      const startTime = ctx.currentTime + i * (duration + 0.15);
      this.synthesizeWhistlePip(ctx, startTime, duration);
    }
  }

  // Plays a vibrant, distinctive 2-tone chime for substitution and rotation alerts
  // Ignored if sound is disabled
  playSubstitutionAlert() {
    if (!this.isEnabled()) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const t0 = ctx.currentTime;
    // Tone 1: 587.33Hz (D5)
    this.playTone(ctx, t0, 587.33, 0.14);
    // Tone 2: 880Hz (A5)
    this.playTone(ctx, t0 + 0.16, 880, 0.22);
    // Tone 3: 1174.66Hz (D6)
    this.playTone(ctx, t0 + 0.34, 1174.66, 0.28);
  }

  // Force-test sound directly even if currently toggled off (for preview in Settings)
  previewWhistle() {
    const ctx = this.getContext();
    if (!ctx) return;
    this.synthesizeWhistlePip(ctx, ctx.currentTime, 0.35);
  }

  previewAlert() {
    const ctx = this.getContext();
    if (!ctx) return;
    const t0 = ctx.currentTime;
    this.playTone(ctx, t0, 587.33, 0.14);
    this.playTone(ctx, t0 + 0.16, 880, 0.22);
  }

  private playTone(ctx: AudioContext, startTime: number, freq: number, duration: number) {
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, startTime);

    gainNode.gain.setValueAtTime(0, startTime);
    gainNode.gain.linearRampToValueAtTime(0.28, startTime + 0.02);
    gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

    osc.connect(gainNode);
    gainNode.connect(ctx.destination);

    osc.start(startTime);
    osc.stop(startTime + duration);
  }

  private synthesizeWhistlePip(ctx: AudioContext, startTime: number, duration: number) {
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const vibrato = ctx.createOscillator();
    const vibratoGain = ctx.createGain();
    const gainNode = ctx.createGain();

    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(2600, startTime);
    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(2850, startTime);

    // Whistle rattle / flutter (pea vibration ~35Hz)
    vibrato.frequency.setValueAtTime(35, startTime);
    vibratoGain.gain.setValueAtTime(80, startTime);
    vibrato.connect(osc1.frequency);
    vibrato.connect(osc2.frequency);

    // Envelope
    gainNode.gain.setValueAtTime(0, startTime);
    gainNode.gain.linearRampToValueAtTime(0.35, startTime + 0.04);
    gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

    osc1.connect(gainNode);
    osc2.connect(gainNode);
    gainNode.connect(ctx.destination);

    osc1.start(startTime);
    osc2.start(startTime);
    vibrato.start(startTime);

    osc1.stop(startTime + duration);
    osc2.stop(startTime + duration);
    vibrato.stop(startTime + duration);
  }
}

export const sound = new WhistleSound();
