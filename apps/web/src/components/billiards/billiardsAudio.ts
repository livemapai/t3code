// Every sound is synthesised, so the game ships no audio files.

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

export class BilliardsAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;

  /** Starts audio; call from a user gesture. */
  unlock(): void {
    if (!this.context) {
      const context = new AudioContext();
      const master = context.createGain();
      master.gain.value = 0.55;
      master.connect(context.destination);
      const noise = context.createBuffer(
        1,
        Math.floor(context.sampleRate * 0.4),
        context.sampleRate,
      );
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.context = context;
      this.master = master;
      this.noise = noise;
    }
    if (this.context.state === "suspended") void this.context.resume();
  }

  dispose(): void {
    void this.context?.close();
    this.context = null;
  }

  /** Ball on ball: a bright click whose pitch and level follow the impact. */
  click(speed: number): void {
    const v = clamp01(speed / 5);
    if (v < 0.01) return;
    this.tone("sine", 2300 + Math.random() * 900 + v * 600, 1900, v * 0.45, 0.05);
    this.hiss("bandpass", 3600, 1.4, v * 0.55, 0.02);
  }

  /** Ball on cushion: a low, soft thud. */
  cushion(speed: number): void {
    const v = clamp01(speed / 4);
    if (v < 0.02) return;
    this.tone("sine", 150, 70, v * 0.6, 0.12);
    this.hiss("lowpass", 700, 0.7, v * 0.35, 0.07);
  }

  /** Ball into a pocket: a hollow drop, then a rattle in the pocket. */
  pocket(): void {
    this.tone("triangle", 240, 85, 0.35, 0.28);
    this.hiss("bandpass", 950, 2, 0.22, 0.05, 0.09);
    this.hiss("bandpass", 780, 2, 0.14, 0.05, 0.17);
  }

  /** Cue tip on the cue ball. */
  cue(power: number): void {
    const p = clamp01(power);
    this.hiss("bandpass", 1500 + p * 900, 0.9, 0.25 + p * 0.5, 0.03);
    this.tone("sine", 700 + p * 300, 500, 0.15 + p * 0.2, 0.04);
  }

  private tone(type: OscillatorType, from: number, to: number, gain: number, decay: number): void {
    const { context, master } = this;
    if (!context || !master) return;
    const at = context.currentTime;
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(from, at);
    oscillator.frequency.exponentialRampToValueAtTime(to, at + decay);
    envelope.gain.setValueAtTime(gain, at);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    oscillator.connect(envelope).connect(master);
    oscillator.start(at);
    oscillator.stop(at + decay + 0.02);
  }

  private hiss(
    type: BiquadFilterType,
    frequency: number,
    q: number,
    gain: number,
    decay: number,
    delay = 0,
  ): void {
    const { context, master, noise } = this;
    if (!context || !master || !noise) return;
    const at = context.currentTime + delay;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const envelope = context.createGain();
    source.buffer = noise;
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    envelope.gain.setValueAtTime(gain, at);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    source.connect(filter).connect(envelope).connect(master);
    source.start(at, Math.random() * 0.3);
    source.stop(at + decay + 0.02);
  }
}
