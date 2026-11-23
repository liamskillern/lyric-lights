import { describe, expect, it } from "vitest";
import { parseLrc } from "../src/lyrics";
import { analyzeSong } from "../src/mood";
import { DEFAULT_PALETTE } from "../src/palette";
import { computeScene, EFFECTS } from "../src/scene";
import { luminance } from "../src/color";

const song = analyzeSong(
  parseLrc("[00:00.00]rain falls on the city\n[00:04.00]fire in my heart\n[00:08.00]rain again\n[00:12.00]rain"),
  "",
);

describe("computeScene", () => {
  it("turns on the current line's effects at full strength", () => {
    const s = computeScene({ palette: DEFAULT_PALETTE, song, lineIndex: 1, isPlaying: true });
    expect(s.effects.embers).toBe(1);
    expect(s.effects.glow).toBe(1); // "heart" → love → glow
  });

  it("keeps the song's main theme in the background", () => {
    const s = computeScene({ palette: DEFAULT_PALETTE, song, lineIndex: 1, isPlaying: true });
    expect(s.effects.rain).toBeGreaterThan(0.2);
    expect(s.effects.rain).toBeLessThan(1);
    expect(s.effects.snow).toBe(0);
  });

  it("slows down and dims effects when paused", () => {
    const playing = computeScene({ palette: DEFAULT_PALETTE, song, lineIndex: 0, isPlaying: true });
    const paused = computeScene({ palette: DEFAULT_PALETTE, song, lineIndex: 0, isPlaying: false });
    expect(paused.speed).toBeLessThan(playing.speed);
    expect(paused.effects.rain).toBeLessThan(playing.effects.rain);
  });

  it("moves faster for wordier songs", () => {
    const slow = { ...song, wpm: 50 };
    const fast = { ...song, wpm: 220 };
    const a = computeScene({ palette: DEFAULT_PALETTE, song: slow, lineIndex: -1, isPlaying: true });
    const b = computeScene({ palette: DEFAULT_PALETTE, song: fast, lineIndex: -1, isPlaying: true });
    expect(b.speed).toBeGreaterThan(a.speed);
  });

  it("is brighter for happy songs than sad ones", () => {
    const happy = computeScene({ palette: DEFAULT_PALETTE, song: { ...song, valence: 0.8 }, lineIndex: -1, isPlaying: true });
    const sad = computeScene({ palette: DEFAULT_PALETTE, song: { ...song, valence: -0.8 }, lineIndex: -1, isPlaying: true });
    expect(happy.brightness).toBeGreaterThan(sad.brightness);
  });

  it("works with no song data and keeps the background dark", () => {
    const s = computeScene({ palette: DEFAULT_PALETTE, song: null, lineIndex: -1, isPlaying: true });
    for (const e of EFFECTS) expect(s.effects[e]).toBe(0);
    expect(luminance(s.colors.top)).toBeLessThan(0.08);
    expect(luminance(s.colors.bottom)).toBeLessThan(0.05);
  });
});

describe("tempo in the scene", () => {
  it("moves faster for a higher BPM, whatever the lyrics", () => {
    const slow = computeScene({ palette: DEFAULT_PALETTE, song, lineIndex: 0, isPlaying: true, bpm: 75 });
    const fast = computeScene({ palette: DEFAULT_PALETTE, song, lineIndex: 0, isPlaying: true, bpm: 165 });
    expect(fast.speed).toBeGreaterThan(slow.speed * 1.5);
  });
});
