// Optional beat detection from the microphone.
// Spotify's audio is DRM-protected, so a web page can't read it directly. If the music
// is playing out loud nearby, the mic can still hear the beat.

/**
 * Finds beats in a stream of bass-energy readings: a beat is a jump well above the
 * recent average, with a short cooldown so one kick drum doesn't count twice. (Pure, tested.)
 */
export class BeatDetector {
  private avg = 0;
  private peak = 1e-4;
  private lastBeat = -Infinity;

  constructor(
    private sensitivity = 1.35,
    private cooldownMs = 220,
    private floor = 0.02,
  ) {}

  /** Feed one reading (any scale). Returns the level (0..1) and whether this is a beat. */
  push(energy: number, nowMs: number): { level: number; beat: boolean } {
    // Slow-moving average of the bass and a slowly decaying peak for normalizing.
    this.avg = this.avg === 0 ? energy : this.avg * 0.92 + energy * 0.08;
    this.peak = Math.max(energy, this.peak * 0.995);
    const level = Math.min(1, energy / this.peak);

    const beat =
      energy > this.avg * this.sensitivity &&
      energy / this.peak > this.floor &&
      nowMs - this.lastBeat > this.cooldownMs;
    if (beat) this.lastBeat = nowMs;
    return { level, beat };
  }
}

export class MicListener {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private stream: MediaStream | null = null;
  private bins: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  private detector = new BeatDetector();

  level = 0;
  beat = false;

  get active(): boolean {
    return this.ctx !== null;
  }

  async start(): Promise<void> {
    if (this.ctx) return;
    // Turn off the voice-call processing: it treats music as noise and flattens it.
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    this.ctx = new AudioContext();
    const source = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.5;
    source.connect(this.analyser); // not connected to speakers: no feedback
    this.bins = new Uint8Array(this.analyser.frequencyBinCount);
    this.detector = new BeatDetector();
  }

  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close();
    this.ctx = null;
    this.analyser = null;
    this.stream = null;
    this.level = 0;
    this.beat = false;
  }

  /** Call once per animation frame. */
  update(nowMs: number): void {
    if (!this.analyser || !this.ctx) return;
    this.analyser.getByteFrequencyData(this.bins);
    // Bass range (~40–160 Hz) is where kick drums live.
    const hzPerBin = this.ctx.sampleRate / this.analyser.fftSize;
    const from = Math.max(1, Math.floor(40 / hzPerBin));
    const to = Math.max(from + 1, Math.ceil(160 / hzPerBin));
    let sum = 0;
    for (let i = from; i <= to; i++) sum += this.bins[i] * this.bins[i];
    const energy = Math.sqrt(sum / (to - from + 1)) / 255;
    const { level, beat } = this.detector.push(energy, nowMs);
    this.level = level;
    this.beat = beat;
  }
}
