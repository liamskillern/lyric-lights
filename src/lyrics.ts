// Time-synced lyrics from LRCLIB (lrclib.net): free, open, no API key.
// Spotify's own lyrics aren't available to third-party apps.

import type { Track } from "./spotify";

export interface LyricLine {
  /** when the line starts, in ms from the start of the song */
  timeMs: number;
  text: string;
}

export type Lyrics =
  | { kind: "synced"; lines: LyricLine[] }
  | { kind: "plain"; text: string }
  | { kind: "instrumental" }
  | { kind: "none" };

const TIMESTAMP = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const OFFSET = /^\[offset:\s*([+-]?\d+)\s*\]/im;

/**
 * Parse LRC text. Handles several timestamps on one line ("[00:12.00][01:40.00]chorus"),
 * 1–3 digit fractions, metadata tags, and the [offset:] tag.
 */
export function parseLrc(lrc: string): LyricLine[] {
  // Positive offset = show lyrics earlier (LRC convention).
  const offsetMs = Number(OFFSET.exec(lrc)?.[1] ?? 0);
  const out: LyricLine[] = [];

  for (const raw of lrc.split(/\r?\n/)) {
    const stamps: number[] = [];
    let lastEnd = -1;
    TIMESTAMP.lastIndex = 0;
    let m: RegExpExecArray | null;
    // Only timestamps at the start of the line (possibly several in a row) count.
    while ((m = TIMESTAMP.exec(raw)) && (lastEnd === -1 ? m.index === 0 : m.index === lastEnd)) {
      const [, mm, ss, frac = "0"] = m;
      const fracMs = Number(frac.padEnd(3, "0").slice(0, 3));
      stamps.push(Number(mm) * 60_000 + Number(ss) * 1000 + fracMs - offsetMs);
      lastEnd = TIMESTAMP.lastIndex;
    }
    if (!stamps.length) continue;
    // Strip word-level "<mm:ss.xx>" tags from enhanced LRC.
    const text = raw.slice(lastEnd).replace(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g, "").trim();
    for (const t of stamps) out.push({ timeMs: Math.max(0, t), text });
  }

  return out.sort((a, b) => a.timeMs - b.timeMs);
}

/** Index of the line being sung at `ms`, or -1 before the first line. Binary search. */
export function lineIndexAt(lines: LyricLine[], ms: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].timeMs <= ms) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

export interface LrclibRecord {
  trackName?: string;
  artistName?: string;
  duration?: number;
  instrumental?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

export function lyricsFromRecord(rec: LrclibRecord | null): Lyrics {
  if (!rec) return { kind: "none" };
  if (rec.instrumental) return { kind: "instrumental" };
  if (rec.syncedLyrics) {
    const lines = parseLrc(rec.syncedLyrics);
    if (lines.length) return { kind: "synced", lines };
  }
  if (rec.plainLyrics?.trim()) return { kind: "plain", text: rec.plainLyrics };
  return { kind: "none" };
}

/** Pick the best search hit: synced lyrics first, then the closest duration. */
export function pickBestRecord(records: LrclibRecord[], durationSec: number): LrclibRecord | null {
  const near = records.filter((r) => r.duration == null || Math.abs(r.duration - durationSec) <= 3);
  const score = (r: LrclibRecord) =>
    (r.syncedLyrics ? 0 : r.instrumental ? 1 : r.plainLyrics ? 2 : 3) * 100 +
    Math.abs((r.duration ?? durationSec) - durationSec);
  return [...near].sort((a, b) => score(a) - score(b))[0] ?? null;
}

/** "Song (feat. X) - 2011 Remaster" → "Song". Helps the fallback search. */
export function cleanTitle(name: string): string {
  return name
    .replace(/\s*[([](feat|ft|with)\.?\s[^)\]]*[)\]]/gi, "")
    .replace(/\s+-\s+.*(remaster|version|edit|mix|live|mono|stereo).*$/i, "")
    .trim();
}

const cache = new Map<string, Lyrics>();
const API = "https://lrclib.net/api";

export async function fetchLyrics(track: Track, signal?: AbortSignal): Promise<Lyrics> {
  const hit = cache.get(track.id);
  if (hit) return hit;

  const artist = track.artists[0] ?? "";
  const durationSec = Math.round(track.durationMs / 1000);
  let result: Lyrics = { kind: "none" };

  try {
    // 1) Exact lookup (track + artist + album + duration).
    const exact = new URLSearchParams({
      track_name: track.name,
      artist_name: artist,
      album_name: track.album,
      duration: String(durationSec),
    });
    const res = await fetch(`${API}/get?${exact}`, { signal });
    if (res.ok) result = lyricsFromRecord(await res.json());

    // 2) Fuzzy search if that missed or only had plain lyrics.
    if (result.kind === "none" || result.kind === "plain") {
      const q = new URLSearchParams({ track_name: cleanTitle(track.name), artist_name: artist });
      const sres = await fetch(`${API}/search?${q}`, { signal });
      if (sres.ok) {
        const better = lyricsFromRecord(pickBestRecord(await sres.json(), durationSec));
        if (better.kind === "synced" || result.kind === "none") result = better;
      }
    }
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    return { kind: "none" }; // network trouble: don't cache, try again next time
  }

  cache.set(track.id, result);
  return result;
}
