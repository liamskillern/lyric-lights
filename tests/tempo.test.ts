import { describe, expect, it } from "vitest";
import type { LyricLine } from "../src/lyrics";
import { estimateTempoFromLyrics, foldBpm, GUESS_CONFIDENCE, gridBeat, TempoTracker } from "../src/tempo";

// Small seeded random so tests are repeatable.
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 2 ** 32;
    return seed / 2 ** 32;
  };
}

describe("foldBpm", () => {
  it("folds half and double time into 70–180", () => {
    expect(foldBpm(240)).toBe(120);
    expect(foldBpm(60)).toBe(120);
    expect(foldBpm(128)).toBe(128);
    expect(foldBpm(35)).toBe(70);
    expect(foldBpm(30)).toBe(120);
    expect(foldBpm(0)).toBeNaN();
  });
});

describe("TempoTracker", () => {
  it("finds a steady 120 BPM with timing jitter", () => {
    const r = rng(1);
    const t = new TempoTracker();
    let bpm: number | null = null;
    for (let i = 0; i < 20; i++) bpm = t.push(i * 500 + (r() - 0.5) * 30);
    expect(bpm).not.toBeNull();
    expect(Math.abs(bpm! - 120)).toBeLessThan(3);
  });

  it("isn't fooled by missed beats or half-time detection", () => {
    const t = new TempoTracker();
    let bpm: number | null = null;
    const beatsAt128 = Array.from({ length: 24 }, (_, i) => i * (60_000 / 128)).filter((_, i) => i % 5 !== 3); // drop some
    for (const b of beatsAt128) bpm = t.push(b);
    expect(Math.abs(bpm! - 128)).toBeLessThan(3);
    const half = new TempoTracker();
    for (let i = 0; i < 12; i++) bpm = half.push(i * 1000); // only every other beat heard (60 BPM)
    expect(bpm).toBe(120);
  });

  it("needs a few beats before answering, and forgets after reset", () => {
    const t = new TempoTracker();
    expect(t.push(0)).toBeNull();
    expect(t.push(500)).toBeNull();
    for (let i = 2; i < 8; i++) t.push(i * 500);
    expect(t.bpm).not.toBeNull();
    t.reset();
    expect(t.bpm).toBeNull();
  });
});

function linesOnBars(bpm: number, count: number, seed: number): LyricLine[] {
  const r = rng(seed);
  const bar = (60_000 / bpm) * 4;
  const out: LyricLine[] = [];
  let t = 4000;
  for (let i = 0; i < count; i++) {
    out.push({ timeMs: Math.round(t + (r() - 0.5) * 120), text: `line ${i}` });
    t += bar * (r() < 0.6 ? 1 : r() < 0.7 ? 2 : 0.5);
  }
  return out;
}

describe("estimateTempoFromLyrics", () => {
  for (const bpm of [90, 128, 150]) {
    it(`finds ${bpm} BPM from lines that start on the bar`, () => {
      const g = estimateTempoFromLyrics(linesOnBars(bpm, 40, bpm));
      expect(g).not.toBeNull();
      expect(Math.abs(g!.bpm - bpm)).toBeLessThan(3);
      expect(g!.confidence).toBeGreaterThanOrEqual(GUESS_CONFIDENCE);
    });
  }

  it("has low confidence when lines start at random times", () => {
    const r = rng(7);
    let t = 3000;
    const lines = Array.from({ length: 40 }, (_, i) => ({ timeMs: (t += 1500 + r() * 4500), text: `x ${i}` }));
    expect(estimateTempoFromLyrics(lines)!.confidence).toBeLessThan(GUESS_CONFIDENCE);
  });

  it("returns null with too few lines", () => {
    expect(estimateTempoFromLyrics(linesOnBars(120, 4, 1))).toBeNull();
  });
});

describe("gridBeat", () => {
  it("fires once when a grid beat is crossed", () => {
    expect(gridBeat(990, 1010, 0, 500)).toBe(true);
    expect(gridBeat(1010, 1030, 0, 500)).toBe(false);
    expect(gridBeat(1240, 1260, 10, 500)).toBe(false);
    expect(gridBeat(1490, 1510, 10, 500)).toBe(true);
  });
  it("ignores jumps (seeking) and bad input", () => {
    expect(gridBeat(0, 5000, 0, 500)).toBe(false);
    expect(gridBeat(100, 90, 0, 500)).toBe(false);
    expect(gridBeat(0, 10, 0, 0)).toBe(false);
  });
});
