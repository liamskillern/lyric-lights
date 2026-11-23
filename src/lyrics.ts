// Time-synced lyrics from LRCLIB (lrclib.net): free, open, no API key.
// Spotify's own lyrics aren't available to third-party apps.

import type { Track } from "./spotify";
import { LruCache } from "./storage";

export interface LyricLine {
  /** when the line starts, in ms from the start of the song */
  timeMs: number;
  text: string;
  /** per-word start times, only when the lyrics have them (enhanced LRC) */
  words?: { text: string; atMs: number }[];
}

const WORD_TAG = /<(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?>([^<]*)/g;

/** Word timings from an enhanced-LRC line body, relative to `lineStart`; null if none or inconsistent. */
export function parseWordTimes(body: string, text: string, lineStart: number, offsetMs: number): { text: string; relMs: number }[] | null {
  if (!body.includes("<")) return null;
  const out: { text: string; relMs: number }[] = [];
  WORD_TAG.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WORD_TAG.exec(body))) {
    const [, mm, ss, frac = "0", seg] = m;
    const at = Number(mm) * 60_000 + Number(ss) * 1000 + Number(frac.padEnd(3, "0").slice(0, 3)) - offsetMs;
    for (const word of seg.trim().split(/\s+/).filter(Boolean)) out.push({ text: word, relMs: Math.max(0, at - lineStart) });
  }
  // Only trust them if they cover exactly the words of the line.
  const textWords = text.split(/\s+/).filter(Boolean);
  if (!out.length || out.length !== textWords.length) return null;
  return out;
}

export type Lyrics =
  | { kind: "synced"; lines: LyricLine[] }
  | { kind: "plain"; text: string }
  | { kind: "instrumental" }
  | { kind: "none" };

/**
 * LRCLIB is community-edited, so its data is untrusted. These caps keep a huge or
 * broken entry from freezing the tab. Real songs are far below them.
 */
export const LIMITS = {
  /** whole HTTP response */
  responseBytes: 1_000_000,
  /** one lyrics field (synced or plain) */
  lyricsChars: 256_000,
  /** one line of lyrics */
  lineChars: 300,
  /** lines per song */
  lines: 2_000,
  /** search results considered */
  records: 50,
};

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

  for (const raw of lrc.slice(0, LIMITS.lyricsChars).split(/\r?\n/)) {
    if (out.length >= LIMITS.lines) break;
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
    // Word-level "<mm:ss.xx>" tags (enhanced LRC) become word timings, then are stripped from the text.
    const body = raw.slice(lastEnd);
    let text = body.replace(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g, "").replace(/\s+/g, " ").trim();
    const truncated = text.length > LIMITS.lineChars;
    if (truncated) text = text.slice(0, LIMITS.lineChars - 1) + "…";
    const rel = truncated ? null : parseWordTimes(body, text, stamps[0], offsetMs);
    for (const t of stamps) {
      const line: LyricLine = { timeMs: Math.max(0, t), text };
      if (rel) line.words = rel.map((w) => ({ text: w.text, atMs: Math.max(0, t) + w.relMs }));
      out.push(line);
    }
  }

  return out.slice(0, LIMITS.lines).sort((a, b) => a.timeMs - b.timeMs);
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

/** Keep only well-typed, reasonably sized fields from an LRCLIB record. */
export function sanitizeRecord(raw: unknown): LrclibRecord | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === "string" && v.length <= max ? v : undefined);
  return {
    trackName: str(r.trackName, 500),
    artistName: str(r.artistName, 500),
    duration: typeof r.duration === "number" && Number.isFinite(r.duration) ? r.duration : undefined,
    instrumental: r.instrumental === true,
    plainLyrics: str(r.plainLyrics, LIMITS.lyricsChars) ?? null,
    syncedLyrics: str(r.syncedLyrics, LIMITS.lyricsChars) ?? null,
  };
}

export function lyricsFromRecord(raw: unknown): Lyrics {
  const rec = sanitizeRecord(raw);
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
export function pickBestRecord(raw: unknown, durationSec: number): LrclibRecord | null {
  if (!Array.isArray(raw)) return null;
  const records = raw.slice(0, LIMITS.records).map(sanitizeRecord).filter((r): r is LrclibRecord => r !== null);
  const near = records.filter((r) => r.duration == null || Math.abs(r.duration - durationSec) <= 3);
  const score = (r: LrclibRecord) =>
    (r.syncedLyrics ? 0 : r.instrumental ? 1 : r.plainLyrics ? 2 : 3) * 100 +
    Math.abs((r.duration ?? durationSec) - durationSec);
  return [...near].sort((a, b) => score(a) - score(b))[0] ?? null;
}

/**
 * Read a response body as JSON, giving up (null) past `maxBytes` without loading the rest.
 */
export async function readJsonCapped(res: Response, maxBytes = LIMITS.responseBytes): Promise<unknown> {
  const declared = Number(res.headers.get("content-length"));
  if (declared > maxBytes) return null;
  let text: string;
  if (res.body) {
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const all = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      all.set(c, off);
      off += c.byteLength;
    }
    text = new TextDecoder().decode(all);
  } else {
    text = await res.text();
    if (text.length > maxBytes) return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** "Song (feat. X) - 2011 Remaster" → "Song". Helps the fallback search. */
export function cleanTitle(name: string): string {
  return name
    .replace(/\s*[([](feat|ft|with)\.?\s[^)\]]*[)\]]/gi, "")
    .replace(/\s+-\s+.*(remaster|version|edit|mix|live|mono|stereo).*$/i, "")
    .trim();
}

const cache = new LruCache<string, Lyrics>(50);
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
    if (res.ok) result = lyricsFromRecord(await readJsonCapped(res));

    // 2) Fuzzy search if that missed or only had plain lyrics.
    if (result.kind === "none" || result.kind === "plain") {
      const q = new URLSearchParams({ track_name: cleanTitle(track.name), artist_name: artist });
      const sres = await fetch(`${API}/search?${q}`, { signal });
      if (sres.ok) {
        const better = lyricsFromRecord(pickBestRecord(await readJsonCapped(sres), durationSec));
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
