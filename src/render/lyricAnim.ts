// How a lyric line arrives and leaves. Each animation is plain math (pure, tested); the
// drawing code in lyrics.ts applies the result.

import type { LyricLine } from "../lyrics";

export const LYRIC_ANIMS = ["rise", "fade", "pop", "slide", "typewriter", "karaoke"] as const;
export type LyricAnim = (typeof LYRIC_ANIMS)[number];
export const LYRIC_ANIM_NAMES: Record<LyricAnim, string> = {
  rise: "Rise",
  fade: "Fade",
  pop: "Pop",
  slide: "Slide",
  typewriter: "Typewriter",
  karaoke: "Karaoke words",
};

/** How long a line takes to arrive/leave. */
export const ENTER_MS = 420;

export interface AnimState {
  /** sideways shift, as a fraction of screen width */
  dx: number;
  /** vertical shift, in lyric-size units */
  dy: number;
  scale: number;
  alpha: number;
}

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const easeOut = (t: number) => 1 - (1 - clamp01(t)) ** 3;
/** Overshoots a little past 1, then settles: a bouncy "pop". */
export function backOut(t: number, k = 1.9): number {
  const x = clamp01(t) - 1;
  return 1 + (k + 1) * x ** 3 + k * x ** 2;
}

/** The incoming line at raw progress `p` (0 → 1 over ENTER_MS). */
export function enter(anim: LyricAnim, p: number): AnimState {
  const t = easeOut(p);
  switch (anim) {
    case "rise":
      return { dx: 0, dy: 0.6 * (1 - t), scale: 1, alpha: t };
    case "pop":
      return { dx: 0, dy: 0, scale: 0.6 + 0.4 * backOut(p), alpha: clamp01(p * 2.5) };
    case "slide":
      return { dx: 0.55 * (1 - t), dy: 0, scale: 1, alpha: t };
    case "typewriter":
      return { dx: 0, dy: 0, scale: 1, alpha: 1 };
    case "fade":
    case "karaoke":
      return { dx: 0, dy: 0, scale: 1, alpha: t };
  }
}

/** The outgoing line at raw progress `p`. */
export function exit(anim: LyricAnim, p: number): AnimState {
  const t = easeOut(p);
  switch (anim) {
    case "rise":
      return { dx: 0, dy: -1.2 * t, scale: 1, alpha: 1 - t };
    case "pop":
      return { dx: 0, dy: 0, scale: 1 + 0.18 * t, alpha: 1 - clamp01(p * 1.6) };
    case "slide":
      return { dx: -0.55 * t, dy: 0, scale: 1, alpha: 1 - t };
    default:
      return { dx: 0, dy: 0, scale: 1, alpha: 1 - t };
  }
}

/** With reduced motion, anything that moves becomes a plain fade. */
export function calmAnim(anim: LyricAnim, reducedMotion: boolean): LyricAnim {
  return reducedMotion && (anim === "rise" || anim === "pop" || anim === "slide") ? "fade" : anim;
}

/** How long the words of a line are actually sung, given when the next line starts. */
export function sungDuration(line: LyricLine, nextStartMs: number | null): number {
  const gap = nextStartMs !== null ? nextStartMs - line.timeMs : Infinity;
  // Long gaps are instrumental breaks: assume ~95 ms per character, at least 1.2 s.
  const guess = Math.max(1200, line.text.length * 95);
  return Math.max(300, Math.min(gap * 0.92, guess));
}

/** Typewriter: how many characters are showing `ms` after the line started. (Pure, tested.) */
export function visibleChars(line: LyricLine, nextStartMs: number | null, ms: number): number {
  const total = line.text.length;
  const dur = Math.min(sungDuration(line, nextStartMs) * 0.6, total * 45);
  if (dur <= 0) return total;
  return Math.min(total, Math.max(0, Math.floor(((ms - line.timeMs) / dur) * total)));
}

/**
 * Karaoke: how far each word is filled (0..1) at song time `ms`. Uses the lyrics' own word
 * timings when present; otherwise spreads the sung time across the words by their length.
 * (Pure, tested.)
 */
export function wordProgress(line: LyricLine, nextStartMs: number | null, ms: number): number[] {
  const words = line.text.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const end = line.timeMs + sungDuration(line, nextStartMs);

  if (line.words && line.words.length === words.length) {
    return line.words.map((w, i) => {
      const next = line.words![i + 1]?.atMs ?? Math.max(end, w.atMs + 250);
      const len = Math.max(120, next - w.atMs);
      return clamp01((ms - w.atMs) / len);
    });
  }

  // Each word gets time in proportion to its length (+1 for the gap after it).
  const weights = words.map((w) => w.length + 1);
  const total = weights.reduce((a, b) => a + b, 0);
  const span = end - line.timeMs;
  let start = line.timeMs;
  return weights.map((wt) => {
    const len = (wt / total) * span;
    const fill = clamp01((ms - start) / len);
    start += len;
    return fill;
  });
}
