import { describe, expect, it } from "vitest";
import { parseCurrentlyPlaying, positionAt } from "../src/spotify";

const json = {
  is_playing: true,
  progress_ms: 30_000,
  currently_playing_type: "track",
  item: {
    id: "abc",
    name: "Song",
    duration_ms: 200_000,
    artists: [{ name: "A" }, { name: "B" }],
    album: {
      name: "Album",
      images: [
        { url: "small", width: 64, height: 64 },
        { url: "big", width: 640, height: 640 },
        { url: "mid", width: 300, height: 300 },
      ],
    },
  },
};

describe("parseCurrentlyPlaying", () => {
  it("reads the track and picks the biggest art and a small thumbnail", () => {
    const p = parseCurrentlyPlaying(json, 1000);
    expect(p.track).toMatchObject({ id: "abc", name: "Song", artists: ["A", "B"], album: "Album", artUrl: "big", thumbUrl: "small", durationMs: 200_000 });
    expect(p.isPlaying).toBe(true);
    expect(p.progressMs).toBe(30_000);
  });

  it("treats podcasts, ads and empty responses as no track", () => {
    expect(parseCurrentlyPlaying({ ...json, currently_playing_type: "episode" }, 0).track).toBeNull();
    expect(parseCurrentlyPlaying({ ...json, currently_playing_type: "ad", item: null }, 0).track).toBeNull();
    expect(parseCurrentlyPlaying(null, 0).track).toBeNull();
  });

  it("gives local files (no id) a stable id", () => {
    const p = parseCurrentlyPlaying({ ...json, item: { ...json.item, id: null, uri: "spotify:local:x" } }, 0);
    expect(p.track?.id).toBe("spotify:local:x");
  });
});

describe("positionAt", () => {
  const p = parseCurrentlyPlaying(json, 1000);
  it("advances while playing", () => expect(positionAt(p, 3000)).toBe(32_000));
  it("stays put while paused", () => expect(positionAt({ ...p, isPlaying: false }, 3000)).toBe(30_000));
  it("never passes the end of the song", () => expect(positionAt(p, 10_000_000)).toBe(200_000));
});

import { formatTime, parseQueue, trackFromItem } from "../src/spotify";

describe("parseQueue", () => {
  const track = (id: string) => ({ type: "track", id, name: `Song ${id}`, duration_ms: 1000, artists: [{ name: "A" }], album: { name: "B", images: [] } });
  it("returns the first track in the queue", () => {
    expect(parseQueue({ queue: [track("n1"), track("n2")] })?.id).toBe("n1");
  });
  it("skips podcast episodes", () => {
    expect(parseQueue({ queue: [{ type: "episode", id: "e", name: "Pod" }, track("n2")] })?.id).toBe("n2");
  });
  it("returns null for an empty or broken queue", () => {
    expect(parseQueue({ queue: [] })).toBeNull();
    expect(parseQueue({ queue: "nope" })).toBeNull();
    expect(parseQueue(null)).toBeNull();
    expect(parseQueue({ queue: [null, 42, { type: "track" }] })).toBeNull();
  });
});

describe("trackFromItem", () => {
  it("ignores junk inside a track", () => {
    const t = trackFromItem({ id: "x", name: "S", artists: [{ name: "A" }, null, { name: 5 }], album: { images: [null, { url: "u", width: 300 }] } });
    expect(t?.artists).toEqual(["A"]);
    expect(t?.artUrl).toBe("u");
    expect(t?.durationMs).toBe(0);
  });
});

describe("formatTime", () => {
  it("formats minutes and seconds", () => {
    expect(formatTime(83_000)).toBe("1:23");
    expect(formatTime(5_000)).toBe("0:05");
    expect(formatTime(-1)).toBe("0:00");
    expect(formatTime(3_600_000)).toBe("60:00");
  });
});
