import { describe, expect, it } from "vitest";
import { FrameGate, isFromHost, isAndroidWallpaper, LIMITS, parseHostMessage } from "../src/androidWallpaper";

const ART = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==";
const msg = (o: unknown) => JSON.stringify(o);
const playback = (extra: Record<string, unknown> = {}) =>
  msg({
    type: "playback",
    track: { id: "Song|Artist|Album", name: "Song", artists: ["Artist"], album: "Album", durationMs: 200_000 },
    isPlaying: true,
    positionMs: 12_345,
    art: ART,
    ...extra,
  });

describe("Android wallpaper mode", () => {
  it("turns on only with ?android-wallpaper", () => {
    expect(isAndroidWallpaper("?android-wallpaper")).toBe(true);
    expect(isAndroidWallpaper("?demo&android-wallpaper=1")).toBe(true);
    // ?wallpaper is the Windows desktop wallpaper, which logs in to Spotify itself.
    expect(isAndroidWallpaper("?wallpaper")).toBe(false);
    expect(isAndroidWallpaper("?demo")).toBe(false);
    expect(isAndroidWallpaper("")).toBe(false);
  });

  it("only accepts messages from the Android app (no source window)", () => {
    expect(isFromHost({ source: null })).toBe(true);
    expect(isFromHost({ source: {} as Window })).toBe(false);
  });
});

describe("parseHostMessage", () => {
  it("reads now playing, with album art", () => {
    const m = parseHostMessage(playback());
    expect(m).toEqual({
      type: "playback",
      playback: {
        track: { id: "Song|Artist|Album", name: "Song", artists: ["Artist"], album: "Album", durationMs: 200_000, artUrl: ART, thumbUrl: ART },
        isPlaying: true,
        progressMs: 12_345,
      },
    });
  });

  it("reads nothing playing", () => {
    expect(parseHostMessage(msg({ type: "playback", track: null, isPlaying: true, positionMs: 5 }))).toEqual({
      type: "playback",
      playback: { track: null, isPlaying: false, progressMs: 5 },
    });
  });

  it("drops album art that isn't a small base64 image", () => {
    for (const art of [
      "https://evil.example/x.jpg",
      "javascript:alert(1)",
      "data:image/svg+xml;base64,PHN2Zz4=",
      "data:text/html;base64,PGh0bWw+",
      'data:image/png;base64,AAAA"onerror="x',
      `data:image/png;base64,${"A".repeat(LIMITS.artChars)}`,
    ]) {
      const m = parseHostMessage(playback({ art }));
      expect(m?.type).toBe("playback");
      if (m?.type === "playback") expect(m.playback.track?.artUrl, art).toBeNull();
    }
  });

  it("caps and cleans text and numbers", () => {
    const m = parseHostMessage(
      msg({
        type: "playback",
        track: { id: "x", name: "N".repeat(5000), artists: ["a", 7, null, "b", ...Array(50).fill("z")], durationMs: -5 },
        isPlaying: "yes",
        positionMs: Number.MAX_SAFE_INTEGER,
      }),
    );
    if (m?.type !== "playback") throw new Error("expected playback");
    expect(m.playback.track!.name).toHaveLength(LIMITS.text);
    expect(m.playback.track!.artists.slice(0, 2)).toEqual(["a", "b"]);
    expect(m.playback.track!.artists.length).toBeLessThanOrEqual(LIMITS.artists);
    expect(m.playback.track!.album).toBe("");
    expect(m.playback.track!.durationMs).toBe(0);
    expect(m.playback.isPlaying).toBe(false); // only a real `true` counts
    expect(m.playback.progressMs).toBe(24 * 3600_000);
  });

  it("rejects junk", () => {
    for (const bad of [
      null,
      42,
      "",
      "not json",
      "[]",
      msg(null),
      msg({ type: "nope" }),
      msg({ type: "playback", track: { name: "no id" } }),
      msg({ type: "playback", track: "string" }),
      msg({ type: "visible", visible: "true" }),
      "x".repeat(LIMITS.messageChars + 1),
    ]) {
      expect(parseHostMessage(bad), String(bad).slice(0, 40)).toBeNull();
    }
  });

  it("picks only the wallpaper's settings and a known quality", () => {
    const m = parseHostMessage(
      msg({ type: "settings", settings: { style: "aurora", karaoke: true, lyricOffsetMs: 999, beatSource: "mic" }, quality: "saver" }),
    );
    expect(m).toEqual({ type: "settings", settings: { style: "aurora", karaoke: true }, quality: "saver" });
    const bad = parseHostMessage(msg({ type: "settings", settings: [1], quality: "__proto__" }));
    expect(bad).toEqual({ type: "settings", settings: {}, quality: "balanced" });
  });

  it("reads visibility", () => {
    expect(parseHostMessage(msg({ type: "visible", visible: false }))).toEqual({ type: "visible", visible: false });
  });
});

describe("FrameGate", () => {
  /** frames a 60 Hz display offers over `ms` */
  function count(gate: FrameGate, ms: number, hz = 60): number {
    let n = 0;
    for (let t = 0; t < ms; t += 1000 / hz) if (gate.shouldDraw(t)) n++;
    return n;
  }

  it("draws about the requested rate on a 60 Hz display", () => {
    expect(count(new FrameGate(30), 10_000)).toBeGreaterThanOrEqual(295);
    expect(count(new FrameGate(30), 10_000)).toBeLessThanOrEqual(305);
    expect(count(new FrameGate(20), 10_000)).toBeLessThanOrEqual(205);
    expect(count(new FrameGate(5), 10_000)).toBeLessThanOrEqual(52);
    expect(count(new FrameGate(60), 1_000)).toBeGreaterThanOrEqual(58);
  });

  it("holds 30 fps on a 120 Hz display", () => {
    const n = count(new FrameGate(30), 10_000, 120);
    expect(n).toBeGreaterThanOrEqual(295);
    expect(n).toBeLessThanOrEqual(305);
  });

  it("doesn't burst to catch up after a pause", () => {
    const g = new FrameGate(30);
    expect(g.shouldDraw(0)).toBe(true);
    expect(g.shouldDraw(5000)).toBe(true);
    expect(g.shouldDraw(5016)).toBe(false);
  });
});
