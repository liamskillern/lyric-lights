// Tempo (BPM). Spotify no longer gives new apps a song's tempo, so we work it out:
//  - heard: from the beats the audio detector finds (accurate, live), or
//  - guessed: from when lyric lines start, since singers tend to start lines on the bar.

import type { LyricLine } from "./lyrics";

export const MIN_BPM = 70;
export const MAX_BPM = 180;

/** Fold a tempo into 70–180 BPM: 240 → 120, 60 → 120. Beat detectors often find half or double time. */
export function foldBpm(bpm: number, lo = MIN_BPM, hi = MAX_BPM): number {
  if (!Number.isFinite(bpm) || bpm <= 0) return NaN;
  while (bpm > hi) bpm /= 2;
  while (bpm < lo) bpm *= 2;
  return bpm;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Live tempo from beat times. Median of folded intervals, so missed or extra beats don't throw it. */
export class TempoTracker {
  private beats: number[] = [];
  private smoothed: number | null = null;

  constructor(private windowMs = 10_000) {}

  /** Record a beat at time `ms`. Returns the current BPM estimate (or null while learning). */
  push(ms: number): number | null {
    this.beats.push(ms);
    while (this.beats.length && ms - this.beats[0] > this.windowMs) this.beats.shift();
    const bpms: number[] = [];
    for (let i = 1; i < this.beats.length; i++) {
      const iv = this.beats[i] - this.beats[i - 1];
      if (iv >= 250 && iv <= 2000) bpms.push(foldBpm(60_000 / iv));
    }
    if (bpms.length < 4) return this.smoothed;
    const now = median(bpms);
    // Ease toward the new value, but jump if it's far off (the song changed tempo).
    if (this.smoothed === null || Math.abs(now - this.smoothed) / this.smoothed > 0.12) this.smoothed = now;
    else this.smoothed = this.smoothed * 0.85 + now * 0.15;
    return this.smoothed;
  }

  get bpm(): number | null {
    return this.smoothed;
  }

  reset(): void {
    this.beats = [];
    this.smoothed = null;
  }
}

export interface TempoGuess {
  bpm: number;
  /** 0 (no idea) .. 1 (line starts fit the beat grid perfectly) */
  confidence: number;
}

/** Use a lyric guess only at or above this confidence. */
export const GUESS_CONFIDENCE = 0.45;

/**
 * Guess the tempo from lyric timing. Tries every BPM from 70 to 180 and scores how well the
 * gaps between line starts land on a half-bar grid (2 beats), allowing for timestamp slop.
 * Scores are compared against what random timing would get, so faster tempos (a finer grid)
 * don't win by default. (Pure, tested.)
 */
export function estimateTempoFromLyrics(lines: LyricLine[]): TempoGuess | null {
  const starts = lines.filter((l) => l.text.trim()).map((l) => l.timeMs);
  const gaps: number[] = [];
  for (let i = 1; i < starts.length; i++) {
    const d = starts[i] - starts[i - 1];
    if (d >= 900 && d <= 16_000) gaps.push(d);
  }
  if (gaps.length < 6) return null;

  const slop = 110; // ms: LRC timestamps are typed by people
  const scoreAt = (bpm: number) => {
    const unit = (60_000 / bpm) * 2; // half a bar
    let sum = 0;
    for (const d of gaps) {
      const k = Math.max(1, Math.round(d / unit));
      const e = d - k * unit;
      sum += Math.exp(-((e / slop) ** 2));
    }
    const mean = sum / gaps.length;
    const chance = Math.min(0.99, (Math.sqrt(Math.PI) * slop) / unit);
    return (mean - chance) / (1 - chance);
  };

  let best = { bpm: 0, score: -Infinity };
  const scores = new Map<number, number>();
  for (let b = MIN_BPM; b <= MAX_BPM; b += 0.5) {
    const s = scoreAt(b);
    scores.set(b, s);
    if (s > best.score) best = { bpm: b, score: s };
  }
  // Half/double time fit the same grid. If both are close, prefer the one nearer a typical 115.
  for (const alt of [best.bpm * 2, best.bpm / 2]) {
    const a = Math.round(alt * 2) / 2;
    const s = scores.get(a);
    if (s !== undefined && s >= best.score * 0.9 && Math.abs(a - 115) < Math.abs(best.bpm - 115)) best = { bpm: a, score: s };
  }
  return { bpm: best.bpm, confidence: Math.max(0, Math.min(1, best.score)) };
}
