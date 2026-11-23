import { describe, expect, it } from "vitest";
import { FONT_CHOICES, pickAutoFont, resolveFont } from "../src/fonts";
import type { SongMood } from "../src/mood";
import { defaultSettings, parseSettings } from "../src/settings";

const song = (wpm: number, valence: number): SongMood => ({ wpm, valence, topThemes: [], lines: [] });

describe("pickAutoFont", () => {
  it("fits the font to the song", () => {
    expect(pickAutoFont(song(200, 0), 95)).toBe("marker"); // rap speed
    expect(pickAutoFont(song(100, 0), 150)).toBe("poster"); // fast tempo
    expect(pickAutoFont(song(130, 0.5), null)).toBe("poster"); // upbeat
    expect(pickAutoFont(song(80, -0.6), 120)).toBe("elegant"); // sad
    expect(pickAutoFont(song(90, 0.1), 75)).toBe("elegant"); // slow
    expect(pickAutoFont(song(100, 0.1), 110)).toBe("modern");
    expect(pickAutoFont(null, null)).toBe("modern");
  });
  it("resolveFont only changes things for Auto", () => {
    expect(resolveFont("mono", song(200, 0), 160)).toBe("mono");
    expect(resolveFont("auto", song(200, 0), 160)).toBe("marker");
  });
});

describe("font setting", () => {
  it("accepts every choice and rejects anything else", () => {
    const d = defaultSettings();
    for (const f of FONT_CHOICES) expect(parseSettings({ font: f }, d).font).toBe(f);
    expect(parseSettings({ font: "Comic Sans" }, d).font).toBe("modern");
  });
});
