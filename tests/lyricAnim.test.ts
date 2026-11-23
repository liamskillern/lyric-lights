import { describe, expect, it } from "vitest";
import { parseLrc, type LyricLine } from "../src/lyrics";
import { countdownDots, karaokeLines } from "../src/render/karaoke";
import { backOut, calmAnim, enter, exit, LYRIC_ANIMS, visibleChars, wordProgress } from "../src/render/lyricAnim";

describe("enter / exit", () => {
  it("every animation starts hidden-ish and ends fully in place", () => {
    for (const a of LYRIC_ANIMS) {
      const end = enter(a, 1);
      expect(end).toEqual({ dx: 0, dy: 0, scale: 1, alpha: 1 });
      expect(exit(a, 1).alpha).toBe(0);
      expect(exit(a, 0).alpha).toBe(1);
    }
    expect(enter("rise", 0).dy).toBeGreaterThan(0);
    expect(enter("slide", 0).dx).toBeGreaterThan(0);
    expect(exit("slide", 1).dx).toBeLessThan(0);
    expect(enter("pop", 0).scale).toBeLessThan(1);
    expect(enter("typewriter", 0).alpha).toBe(1); // letters do the revealing
  });
  it("pop overshoots before settling", () => {
    const peak = Math.max(...Array.from({ length: 50 }, (_, i) => backOut(i / 49)));
    expect(peak).toBeGreaterThan(1.05);
    expect(backOut(1)).toBeCloseTo(1);
  });
  it("reduced motion turns moving animations into fades", () => {
    expect(calmAnim("slide", true)).toBe("fade");
    expect(calmAnim("pop", true)).toBe("fade");
    expect(calmAnim("karaoke", true)).toBe("karaoke");
    expect(calmAnim("slide", false)).toBe("slide");
  });
});

const line: LyricLine = { timeMs: 10_000, text: "we are neon weather" };

describe("visibleChars (typewriter)", () => {
  it("reveals letters over time, all by the end", () => {
    expect(visibleChars(line, 14_000, 10_000)).toBe(0);
    const mid = visibleChars(line, 14_000, 10_300);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(line.text.length);
    expect(visibleChars(line, 14_000, 13_000)).toBe(line.text.length);
  });
});

describe("wordProgress (karaoke)", () => {
  it("fills words in order, partially inside a word", () => {
    expect(wordProgress(line, 14_000, 9_000)).toEqual([0, 0, 0, 0]);
    const mid = wordProgress(line, 14_000, 11_000);
    expect(mid[0]).toBe(1);
    expect(mid.some((f) => f > 0 && f < 1)).toBe(true); // a word is mid-fill
    for (let i = 1; i < mid.length; i++) expect(mid[i]).toBeLessThanOrEqual(mid[i - 1]);
    expect(wordProgress(line, 14_000, 14_000)).toEqual([1, 1, 1, 1]);
  });
  it("doesn't drag a line across a long instrumental gap", () => {
    // Next line 30 s later: the words should still finish within a few seconds.
    expect(wordProgress(line, 40_000, 13_000).every((f) => f === 1)).toBe(true);
  });
  it("uses real word timings when the lyrics have them", () => {
    const [l] = parseLrc("[00:10.00]<00:10.00>we <00:10.20>are <00:12.00>neon <00:12.50>weather");
    expect(l.words?.map((w) => w.atMs)).toEqual([10_000, 10_200, 12_000, 12_500]);
    const f = wordProgress(l, 14_000, 11_000);
    expect(f[0]).toBe(1);
    expect(f[1]).toBeGreaterThan(0.4); // "are" is held until 12.0 s
    expect(f[1]).toBeLessThan(1);
    expect(f[2]).toBe(0);
  });
  it("ignores word timings that don't match the line", () => {
    const [l] = parseLrc("[00:10.00]before tags <00:10.50>only");
    expect(l.words).toBeUndefined();
    expect(l.text).toBe("before tags only");
  });
});

describe("countdownDots", () => {
  const lines = parseLrc("[00:10.00]first line\n[00:14.00]second line\n[00:18.00]\n[00:30.00]after the break");
  it("counts down 3, 2, 1 before the first line", () => {
    expect(countdownDots(lines, 6_000)).toBe(0);
    expect(countdownDots(lines, 7_500)).toBe(3);
    expect(countdownDots(lines, 8_500)).toBe(2);
    expect(countdownDots(lines, 9_500)).toBe(1);
  });
  it("no dots between lines sung back to back", () => {
    expect(countdownDots(lines, 12_500)).toBe(0);
  });
  it("counts down again after a long instrumental break", () => {
    expect(countdownDots(lines, 28_500)).toBe(2);
  });
  it("nothing after the last line", () => {
    expect(countdownDots(lines, 40_000)).toBe(0);
  });
});

describe("karaokeLines", () => {
  const lines = parseLrc("[00:01.00]a a a\n[00:02.00]\n[00:03.00]b b b\n[00:04.00]c c c\n[00:05.00]d d d");
  it("gives the current line and the next two sung lines", () => {
    const k = karaokeLines(lines, 0);
    expect(k.current?.text).toBe("a a a");
    expect(k.upcoming.map((l) => l.text)).toEqual(["b b b", "c c c"]);
    expect(karaokeLines(lines, 1).current).toBeNull(); // blank line
    expect(karaokeLines(lines, -1).upcoming.map((l) => l.text)).toEqual(["a a a", "b b b"]);
  });
});
