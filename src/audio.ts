// Beat and loudness from live audio.
// Spotify's audio is DRM-protected, so a web page can't read it directly. Two ways in:
//  - "system": the browser's screen-share prompt can share the computer's sound (Chrome/Edge
//    on Windows: "Entire screen" + "Also share system audio"; or a single tab's audio).
//    Clean digital sound, no delay. We keep only the audio and stop the video right away.
//  - "mic": listens to the music playing in the room. Works on phones too.

export type AudioSource = "system" | "mic";

export interface Bands {
  /** kick drums, bass lines (≈40–160 Hz) */
  bass: number;
  /** vocals, most instruments (≈400–2000 Hz) */
  mid: number;
  /** hi-hats, cymbals, "air" (≈4–12 kHz) */
  treble: number;
}

export const SILENT: Bands = { bass: 0, mid: 0, treble: 0 };

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

/**
 * Lets a flash through at most `perSecond` times a second. WCAG 2.3.1 says content shouldn't
 * flash more than 3 times a second (seizure risk), and fast songs can have more beats than that.
 */
export class FlashLimiter {
  private last = -Infinity;
  constructor(private perSecond = 3) {}

  allow(nowMs: number): boolean {
    if (nowMs - this.last < 1000 / this.perSecond) return false;
    this.last = nowMs;
    return true;
  }
}

/** RMS of the FFT bins between two frequencies, 0..1. (Pure, tested.) */
export function bandEnergy(bins: ArrayLike<number>, hzPerBin: number, fromHz: number, toHz: number): number {
  const from = Math.max(1, Math.floor(fromHz / hzPerBin));
  const to = Math.min(bins.length - 1, Math.max(from, Math.ceil(toHz / hzPerBin)));
  if (to < from) return 0;
  let sum = 0;
  for (let i = from; i <= to; i++) sum += bins[i] * bins[i];
  return Math.sqrt(sum / (to - from + 1)) / 255;
}

/** Scales a band to 0..1 against its own slowly fading peak, so quiet songs still move. */
export class AutoGain {
  private peak = 0.05;
  push(v: number): number {
    this.peak = Math.max(v, this.peak * 0.997, 0.05);
    return Math.min(1, v / this.peak);
  }
}

/** Can this browser capture the computer's sound? (Desktop Chromium; phones can't.) */
export function canCaptureSystemAudio(): boolean {
  const md = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
  if (!md || typeof md.getDisplayMedia !== "function") return false;
  return !/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

export class NoAudioSharedError extends Error {
  constructor() {
    super("No sound was shared");
  }
}

export class AudioInput {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private stream: MediaStream | null = null;
  private bins: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  private detector = new BeatDetector();
  private gains = { bass: new AutoGain(), mid: new AutoGain(), treble: new AutoGain() };

  source: AudioSource | null = null;
  level = 0;
  beat = false;
  bands: Bands = { ...SILENT };
  /** called if the user ends the share from the browser's own "Stop sharing" bar */
  onEnded: (() => void) | null = null;

  get active(): boolean {
    return this.ctx !== null;
  }

  setSensitivity(s: number): void {
    // 0..1 slider → beat threshold 1.6 (fewer beats) .. 1.15 (more beats)
    this.detector = new BeatDetector(1.6 - s * 0.45);
  }

  async start(source: AudioSource, sensitivity = 0.5): Promise<void> {
    this.stop();
    // Turn off voice-call processing: it treats music as noise and flattens it.
    const clean = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
    let stream: MediaStream;
    if (source === "system") {
      // `systemAudio` is a Chrome hint to offer the "share system audio" box; not in TS's types yet.
      const opts = { video: true, audio: clean, systemAudio: "include" } as DisplayMediaStreamOptions;
      stream = await navigator.mediaDevices.getDisplayMedia(opts);
      // We only want the sound. Stop the picture right away: it is never drawn or stored.
      stream.getVideoTracks().forEach((t) => t.stop());
      if (stream.getAudioTracks().length === 0) {
        throw new NoAudioSharedError();
      }
    } else {
      stream = await navigator.mediaDevices.getUserMedia({ audio: clean });
    }

    this.stream = stream;
    stream.getAudioTracks()[0].addEventListener("ended", () => {
      this.stop();
      this.onEnded?.();
    });
    this.ctx = new AudioContext();
    const node = this.ctx.createMediaStreamSource(stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.45;
    node.connect(this.analyser); // never connected to the speakers: no echo or feedback
    this.bins = new Uint8Array(this.analyser.frequencyBinCount);
    this.setSensitivity(sensitivity);
    this.gains = { bass: new AutoGain(), mid: new AutoGain(), treble: new AutoGain() };
    this.source = source;
  }

  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.analyser = null;
    this.stream = null;
    this.source = null;
    this.level = 0;
    this.beat = false;
    this.bands = { ...SILENT };
  }

  /** Call once per animation frame. */
  update(nowMs: number): void {
    if (!this.analyser || !this.ctx) {
      this.beat = false;
      return;
    }
    this.analyser.getByteFrequencyData(this.bins);
    const hz = this.ctx.sampleRate / this.analyser.fftSize;
    const bass = bandEnergy(this.bins, hz, 40, 160);
    const { level, beat } = this.detector.push(bass, nowMs);
    this.level = level;
    this.beat = beat;
    this.bands = {
      bass: this.gains.bass.push(bass),
      mid: this.gains.mid.push(bandEnergy(this.bins, hz, 400, 2000)),
      treble: this.gains.treble.push(bandEnergy(this.bins, hz, 4000, 12000)),
    };
  }
}
