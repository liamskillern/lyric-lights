import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSettings, loadSettings, parseSettings, saveSettings } from "../src/settings";
import { MemoryStorage } from "./helpers";

const D = defaultSettings();

describe("parseSettings", () => {
  it("fills in defaults for missing values", () => {
    expect(parseSettings({}, D)).toEqual(D);
    expect(parseSettings(null, D)).toEqual(D);
  });

  it("clamps numbers into range", () => {
    const s = parseSettings({ effectStrength: 99, lyricOffsetMs: -99999, beatSensitivity: -1 }, D);
    expect(s.effectStrength).toBe(1.5);
    expect(s.lyricOffsetMs).toBe(-3000);
    expect(s.beatSensitivity).toBe(0);
  });

  it("rejects wrong types and unknown choices", () => {
    const s = parseSettings(
      { style: "<script>", lyricSize: "xxl", beatSource: "radio", showLyrics: "yes", effectStrength: "1", lyricOffsetMs: Number.NaN, reducedMotion: 1 },
      D,
    );
    expect(s).toEqual(D);
  });

  it("ignores arrays and strings", () => {
    expect(parseSettings([1, 2, 3], D)).toEqual(D);
    expect(parseSettings("hello", D)).toEqual(D);
  });

  it("keeps good values", () => {
    const good = { ...D, style: "vinyl", effectStrength: 0.5, lyricSize: "l", reducedMotion: true } as const;
    expect(parseSettings(good, D)).toEqual(good);
  });

  it("uses the device's reduced-motion preference and mic on phones by default", () => {
    expect(defaultSettings(true).reducedMotion).toBe(true);
    expect(defaultSettings(false, false).beatSource).toBe("mic");
  });
});

describe("loadSettings / saveSettings", () => {
  let local: MemoryStorage;
  beforeEach(() => {
    local = new MemoryStorage();
    vi.stubGlobal("localStorage", local);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("round-trips", () => {
    saveSettings({ ...D, effectStrength: 0.7 });
    expect(loadSettings(D).effectStrength).toBe(0.7);
  });

  it("survives broken JSON", () => {
    local.setItem("sv.settings", "{not json");
    expect(loadSettings(D)).toEqual(D);
  });

  it("moves the old lyric-offset setting over once", () => {
    local.setItem("sv.lyricOffset", "400");
    expect(loadSettings(D).lyricOffsetMs).toBe(400);
    expect(local.getItem("sv.lyricOffset")).toBeNull();
  });
});
