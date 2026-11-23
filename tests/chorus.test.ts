import { describe, expect, it } from "vitest";
import { parseLrc } from "../src/lyrics";
import { analyzeSong, findChorus, normalizeLine } from "../src/mood";
import { DEFAULT_PALETTE } from "../src/palette";
import { computeScene } from "../src/scene";

const lrc = (texts: string[]) => parseLrc(texts.map((t, i) => `[00:${String(i * 2).padStart(2, "0")}.00]${t}`).join("\n"));

describe("normalizeLine", () => {
  it("ignores case and punctuation", () => {
    expect(normalizeLine("Hold on, HOLD ON!")).toBe("hold on hold on");
  });
});

describe("findChorus", () => {
  it("marks blocks of repeated lines", () => {
    const lines = lrc([
      "first verse line here",
      "second verse line here",
      "we are the chorus tonight",
      "singing it loud and proud",
      "a different verse line",
      "We are the chorus, tonight!", // punctuation and case differ
      "singing it loud and proud",
    ]);
    expect(findChorus(lines)).toEqual([false, false, true, true, false, true, true]);
  });

  it("finds a hook line that repeats 3 times on its own", () => {
    const lines = lrc(["this is the hook line", "verse a goes here", "this is the hook line", "verse b goes here", "this is the hook line"]);
    expect(findChorus(lines)).toEqual([true, false, true, false, true]);
  });

  it("ignores a single line repeated only twice, and short ad-libs", () => {
    const lines = lrc(["oh yeah", "line one is here", "oh yeah", "line two is here", "line one is here", "oh yeah"]);
    expect(findChorus(lines)).toEqual([false, false, false, false, false, false]);
  });

  it("finds nothing in a song with no repeats", () => {
    expect(findChorus(lrc(["one two three", "four five six", "seven eight nine"]))).toEqual([false, false, false]);
  });

  it("when almost everything repeats, keeps only the most repeated block", () => {
    const lines = lrc(["aa bb cc", "dd ee ff", "aa bb cc", "dd ee ff", "gg hh ii", "gg hh ii", "gg hh ii", "gg hh ii"]);
    expect(findChorus(lines)).toEqual([false, false, false, false, true, true, true, true]);
  });
});

describe("chorus in the scene", () => {
  const song = analyzeSong(lrc(["rain falls on me now", "we are the chorus tonight", "under the falling rain", "verse again right here", "we are the chorus tonight", "under the falling rain"]));
  it("is brighter, faster and has more effects than a verse", () => {
    const verse = computeScene({ palette: DEFAULT_PALETTE, song, lineIndex: 3, isPlaying: true });
    const chorus = computeScene({ palette: DEFAULT_PALETTE, song, lineIndex: 4, isPlaying: true });
    expect(chorus.chorus).toBe(true);
    expect(verse.chorus).toBe(false);
    expect(chorus.brightness).toBeGreaterThan(verse.brightness);
    expect(chorus.speed).toBeGreaterThan(verse.speed);
    expect(chorus.effects.sparkles).toBeGreaterThan(verse.effects.sparkles);
  });
  it("isn't active while paused", () => {
    expect(computeScene({ palette: DEFAULT_PALETTE, song, lineIndex: 4, isPlaying: false }).chorus).toBe(false);
  });
});
