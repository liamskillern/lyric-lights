import { describe, expect, it } from "vitest";
import { parseLrc } from "../src/lyrics";
import { analyzeLines, analyzeSong, analyzeText, themesOf, valenceOf, words } from "../src/mood";

describe("words", () => {
  it("lowercases, drops apostrophes and punctuation", () => {
    expect(words("I'm FALLING, don’t stop!")).toEqual(["im", "falling", "dont", "stop"]);
  });
});

describe("themesOf", () => {
  it("finds themes from keywords and stems", () => {
    expect(themesOf("Rain on the windshield")).toEqual(["rain"]);
    expect(themesOf("burning in the midnight")).toEqual(["fire", "night"]);
    expect(themesOf("frozen hearts")).toEqual(["snow", "love"]);
    expect(themesOf("driving down the highway")).toEqual(["city"]);
  });
  it("doesn't fire on look-alike words", () => {
    expect(themesOf("we started searching for the window seat")).toEqual([]);
    expect(themesOf("I care about the hotel")).toEqual([]);
  });
  it("matches short stems only as whole words or plurals", () => {
    expect(themesOf("the sea")).toEqual(["rain"]);
    expect(themesOf("seasons")).toEqual([]);
    expect(themesOf("cars")).toEqual(["city"]);
  });
});

describe("valenceOf", () => {
  it("is positive for happy lines, negative for sad, 0 for empty", () => {
    expect(valenceOf("I love you, this is wonderful and happy")).toBeGreaterThan(0.3);
    expect(valenceOf("I hate this, I'm broken and alone and sad")).toBeLessThan(-0.3);
    expect(valenceOf("   ")).toBe(0);
  });
  it("stays within -1..1", () => {
    const v = valenceOf("love love love love amazing wonderful");
    expect(v).toBeLessThanOrEqual(1);
    expect(v).toBeGreaterThan(0);
  });
});

describe("analyzeLines / analyzeSong", () => {
  const lines = parseLrc(
    [
      "[00:00.00]rain rain rain falling down", // 5 words / 2s = 2.5 wps
      "[00:02.00]the rain is cold tonight", // 5 words / 4s = 1.25 wps
      "[00:06.00]", // break
      "[00:10.00]love is a fire",
      "[00:14.00]end",
    ].join("\n"),
  );

  it("measures words per second per line", () => {
    const moods = analyzeLines(lines);
    expect(moods[0].wordsPerSec).toBeCloseTo(2.5);
    expect(moods[1].wordsPerSec).toBeCloseTo(1.25);
    expect(moods[2].wordsPerSec).toBeNull(); // blank line
    expect(moods[4].wordsPerSec).toBeNull(); // last line: no end time
  });

  it("picks recurring themes and computes words per minute over sung lines", () => {
    const song = analyzeSong(lines, "Some Title");
    expect(song.topThemes[0]).toBe("rain");
    // (5 + 5 + 4) words over (2 + 4 + 4) s = 84 wpm
    expect(song.wpm).toBeCloseTo(84);
    expect(song.lines).toHaveLength(lines.length);
  });

  it("counts title themes extra", () => {
    const song = analyzeSong(parseLrc("[00:00.00]la la la\n[00:02.00]la"), "Midnight City");
    expect(song.topThemes).toEqual(expect.arrayContaining(["night", "city"]));
  });
});

describe("analyzeText", () => {
  it("uses title themes when there are no lyrics", () => {
    const m = analyzeText("", "Snowfall Winter Album");
    expect(m.topThemes).toEqual(["snow"]);
    expect(m.wpm).toBe(0);
    expect(m.lines).toEqual([]);
  });
});
