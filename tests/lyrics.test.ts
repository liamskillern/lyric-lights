import { describe, expect, it } from "vitest";
import { cleanTitle, lineIndexAt, lyricsFromRecord, parseLrc, pickBestRecord } from "../src/lyrics";

describe("parseLrc", () => {
  it("parses timestamps with 1, 2 and 3 digit fractions", () => {
    const lines = parseLrc("[00:01.5]a\n[00:02.25]b\n[01:03.125]c\n[00:04]d");
    expect(lines.map((l) => l.timeMs)).toEqual([1500, 2250, 4000, 63125]);
    expect(lines.map((l) => l.text)).toEqual(["a", "b", "d", "c"]);
  });

  it("expands several timestamps on one line and sorts by time", () => {
    const lines = parseLrc("[00:30.00][00:10.00]chorus\n[00:20.00]verse");
    expect(lines).toEqual([
      { timeMs: 10000, text: "chorus" },
      { timeMs: 20000, text: "verse" },
      { timeMs: 30000, text: "chorus" },
    ]);
  });

  it("skips metadata tags and applies [offset:]", () => {
    const lines = parseLrc("[ar:Someone]\n[ti:Song]\n[offset:+500]\n[00:10.00]hello");
    expect(lines).toEqual([{ timeMs: 9500, text: "hello" }]);
  });

  it("keeps blank lines (instrumental breaks) and handles CRLF", () => {
    const lines = parseLrc("[00:01.00]one\r\n[00:05.00]\r\n[00:09.00]two");
    expect(lines.map((l) => l.text)).toEqual(["one", "", "two"]);
  });

  it("strips word-level timing tags from enhanced LRC", () => {
    expect(parseLrc("[00:01.00]<00:01.00>hello <00:01.50>world")[0].text).toBe("hello world");
  });

  it("ignores timestamps that aren't at the start of the line", () => {
    expect(parseLrc("text [00:01.00] in the middle")).toEqual([]);
  });

  it("never goes below zero with a big offset", () => {
    expect(parseLrc("[offset:5000]\n[00:01.00]x")[0].timeMs).toBe(0);
  });
});

describe("lineIndexAt", () => {
  const lines = parseLrc("[00:01.00]a\n[00:05.00]b\n[00:09.00]c");
  it("returns -1 before the first line", () => expect(lineIndexAt(lines, 500)).toBe(-1));
  it("finds the line being sung", () => {
    expect(lineIndexAt(lines, 1000)).toBe(0);
    expect(lineIndexAt(lines, 4999)).toBe(0);
    expect(lineIndexAt(lines, 5000)).toBe(1);
    expect(lineIndexAt(lines, 60000)).toBe(2);
  });
  it("handles an empty list", () => expect(lineIndexAt([], 1000)).toBe(-1));
});

describe("lyricsFromRecord", () => {
  it("prefers synced lyrics", () => {
    expect(lyricsFromRecord({ syncedLyrics: "[00:01.00]hi", plainLyrics: "hi" }).kind).toBe("synced");
  });
  it("falls back to plain, then instrumental, then none", () => {
    expect(lyricsFromRecord({ syncedLyrics: null, plainLyrics: "hi" }).kind).toBe("plain");
    expect(lyricsFromRecord({ instrumental: true }).kind).toBe("instrumental");
    expect(lyricsFromRecord(null).kind).toBe("none");
    expect(lyricsFromRecord({ plainLyrics: "  " }).kind).toBe("none");
  });
});

describe("pickBestRecord", () => {
  it("picks synced lyrics with the closest duration and drops far-off durations", () => {
    const best = pickBestRecord(
      [
        { duration: 200, plainLyrics: "plain" },
        { duration: 203, syncedLyrics: "[00:01.00]b" },
        { duration: 201, syncedLyrics: "[00:01.00]a" },
        { duration: 260, syncedLyrics: "[00:01.00]wrong song" },
      ],
      200,
    );
    expect(best?.syncedLyrics).toBe("[00:01.00]a");
  });
  it("returns null when nothing is close", () => {
    expect(pickBestRecord([{ duration: 400, syncedLyrics: "x" }], 200)).toBeNull();
  });
});

describe("cleanTitle", () => {
  it("removes features and remaster tags", () => {
    expect(cleanTitle("Song (feat. Someone)")).toBe("Song");
    expect(cleanTitle("Song [with Other]")).toBe("Song");
    expect(cleanTitle("Song - 2011 Remaster")).toBe("Song");
    expect(cleanTitle("Song - Radio Edit")).toBe("Song");
    expect(cleanTitle("Twenty-One Pilots")).toBe("Twenty-One Pilots");
  });
});
