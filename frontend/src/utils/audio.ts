// Web Audio API Whistle Synthesizer
// Generates realistic referee whistle pulses without external audio files

class WhistleSound {
  private ctx: AudioContext | null = null;

  private getContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  }

  // Plays a standard referee whistle burst (e.g. at half time or full time)
  playWhistle(duration = 0.45, repetitions = 2) {
    const ctx = this.getContext();
    if (!ctx) return;

    for (let i = 0; i < repetitions; i++) {
      const startTime = ctx.currentTime + i * (duration + 0.15);
      this.synthesizeWhistlePip(ctx, startTime, duration);
    }
  }

  private synthesizeWhistlePip(ctx: AudioContext, startTime: number, duration: number) {
    // Whistle fundamental frequency is around 2500Hz - 2800Hz with high frequency vibrato (the 'pea' inside the whistle)
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
