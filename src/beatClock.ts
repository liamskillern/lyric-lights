// The beat clock: a steady metronome at the song's tempo, kept in step with the music.
// It runs on *song time* (ms into the track), so it pauses when the music pauses and
// stays in step after seeking. Everything here is pure and tested.
//
// Where the beat comes from, best first:
//   exact   – demo songs, whose tempo we know
//   heard   – beat sync: tempo from the detected beats, phase nudged toward each hit
//   tapped  – the user tapped Space along with the song
//   guessed – tempo guessed from lyric timing, lined up with line starts

export type ClockSource = "exact" | "heard" | "tapped" | "guessed";
export type PulseShape = "off" | "soft" | "punchy";

export class BeatClock {
  bpm = 0;
  /** song time (ms) of some beat; every beat is anchor + k·beatMs */
  anchor = 0;
  source: ClockSource | null = null;

  get running(): boolean {
    return this.bpm > 0;
  }

  get beatMs(): number {
    return this.bpm > 0 ? 60_000 / this.bpm : 0;
  }

  set(bpm: number, anchorMs: number, source: ClockSource): void {
    this.bpm = bpm;
    this.anchor = anchorMs;
    this.source = source;
  }

  clear(): void {
    this.bpm = 0;
    this.anchor = 0;
    this.source = null;
  }

  /**
   * Change tempo without a jump: re-anchor on the most recent beat (at the old tempo)
   * before switching, so the phase right now stays the same.
   */
  setTempo(bpm: number, nowMs: number): void {
    if (!this.running) return;
    if (Math.abs(bpm - this.bpm) < 0.01) return;
    this.anchor += this.beatIndexAt(nowMs) * this.beatMs;
    this.bpm = bpm;
  }

  /**
   * A hit was heard at `hitMs`: move the beat grid 25% of the way toward it (a small
   * phase-locked loop). Hits more than 30% of a beat away are ignored as noise.
   * Returns whether the hit was used.
   */
  lockTo(hitMs: number, gain = 0.25): boolean {
    if (!this.running) return false;
    const b = this.beatMs;
    const err = this.errorAt(hitMs);
    if (Math.abs(err) > 0.3 * b) return false;
    this.anchor += err * gain;
    return true;
  }

  /** Signed distance (ms) from `ms` to the nearest beat of the grid. */
  errorAt(ms: number): number {
    const b = this.beatMs;
    if (!b) return 0;
    const off = (((ms - this.anchor) % b) + b) % b;
    return off > b / 2 ? off - b : off;
  }

  /** 0 at a beat, rising to 1 just before the next. */
  phaseAt(ms: number): number {
    const b = this.beatMs;
    if (!b) return 0;
    return ((((ms - this.anchor) % b) + b) % b) / b;
  }

  /** Which beat this is (counting from the anchor); beat 0, 4, 8… start a bar. */
  beatIndexAt(ms: number): number {
    const b = this.beatMs;
    return b ? Math.floor((ms - this.anchor) / b) : 0;
  }
}

/** Tap tempo: tap along 4+ times; a pause over 2.5 s starts over. */
export class TapTempo {
  private taps: number[] = [];

  /** Record a tap at `ms`. Returns the tempo once there are enough taps, else null. */
  tap(ms: number): { bpm: number; anchor: number } | null {
    const last = this.taps[this.taps.length - 1];
    if (last !== undefined && (ms - last > 2500 || ms <= last)) this.taps = [];
    this.taps.push(ms);
    if (this.taps.length > 9) this.taps.shift();
    if (this.taps.length < 4) return null;
    const iv: number[] = [];
    for (let i = 1; i < this.taps.length; i++) {
      const d = this.taps[i] - this.taps[i - 1];
      if (d >= 250 && d <= 1500) iv.push(d);
    }
    if (iv.length < 3) return null;
    iv.sort((a, b) => a - b);
    const mid = iv.length >> 1;
    const median = iv.length % 2 ? iv[mid] : (iv[mid - 1] + iv[mid]) / 2;
    return { bpm: 60_000 / median, anchor: ms };
  }

  /** Taps so far in the current run. */
  get count(): number {
    return this.taps.length;
  }

  reset(): void {
    this.taps = [];
  }
}

const DECAY: Record<PulseShape, number> = { off: 0, soft: 5, punchy: 9 };

/**
 * The pulse for one beat: jumps up on the beat, then fades before the next.
 * Bar starts (downbeats) are full strength; other beats ~70% (downbeats are 40% stronger).
 */
export function pulseEnvelope(phase: number, downbeat: boolean, shape: PulseShape): number {
  if (shape === "off") return 0;
  const p = Math.min(1, Math.max(0, phase));
  return Math.exp(-p * DECAY[shape]) * (downbeat ? 1 : 1 / 1.4);
}

/** How much the whole background zooms on a full-strength beat. */
export function breathFor(shape: PulseShape, reducedMotion: boolean): number {
  if (reducedMotion || shape === "off") return 0;
  return shape === "punchy" ? 0.04 : 0.022;
}

/**
 * How much brighter the background gets on a full-strength beat. Kept under 10%, below the
 * luminance change WCAG counts as a flash, so it's safe at any tempo.
 */
export function pumpFor(shape: PulseShape, reducedMotion: boolean): number {
  const base = shape === "punchy" ? 0.08 : shape === "soft" ? 0.05 : 0;
  return reducedMotion ? base / 2 : base;
}
