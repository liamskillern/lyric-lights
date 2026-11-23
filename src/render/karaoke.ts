// Karaoke mode helpers (pure, tested). The drawing lives in lyrics.ts.

import type { LyricLine } from "../lyrics";

/** A break this long before a line gets a countdown. */
export const COUNTDOWN_GAP_MS = 5000;

/**
 * Countdown dots before you need to sing: 3, 2, 1 in the last 3 seconds before a line,
 * but only for the first line or after a long break. 0 = no dots. (Pure, tested.)
 */
export function countdownDots(lines: LyricLine[], ms: number): number {
  const nextIdx = lines.findIndex((l) => l.text.trim() && l.timeMs > ms);
  if (nextIdx < 0) return 0;
  const next = lines[nextIdx];
  const left = next.timeMs - ms;
  if (left > 3000) return 0;

  // When did the singing before it stop? The last non-empty line's guessed end.
  let prevEnd = -Infinity;
  for (let i = nextIdx - 1; i >= 0; i--) {
    if (lines[i].text.trim()) {
      const blank = lines.slice(i + 1, nextIdx).find((l) => !l.text.trim());
      // A blank line marks where the vocal stopped; otherwise assume ~4 s per line.
      prevEnd = blank ? blank.timeMs : Math.min(next.timeMs, lines[i].timeMs + 4000);
      break;
    }
  }
  const isFirst = prevEnd === -Infinity;
  if (!isFirst && next.timeMs - prevEnd < COUNTDOWN_GAP_MS) return 0;
  return Math.max(1, Math.ceil(left / 1000));
}

/** The current line plus the next two non-empty lines, for the three-line layout. */
export function karaokeLines(lines: LyricLine[], index: number): { current: LyricLine | null; upcoming: LyricLine[] } {
  const cur = index >= 0 && lines[index]?.text.trim() ? lines[index] : null;
  const upcoming: LyricLine[] = [];
  for (let i = index + 1; i < lines.length && upcoming.length < 2; i++) {
    if (lines[i].text.trim()) upcoming.push(lines[i]);
  }
  return { current: cur, upcoming };
}
