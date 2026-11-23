// Read the mood and imagery of the lyrics.
// Sentiment uses the AFINN word list (via the `sentiment` package): each word has a
// score from -5 (very negative) to +5. Themes come from a keyword map below.

import Sentiment from "sentiment";
import type { LyricLine } from "./lyrics";

export const THEMES = ["rain", "fire", "night", "snow", "gold", "love", "city", "nature"] as const;
export type Theme = (typeof THEMES)[number];

/**
 * Word stems for each theme. A word matches if it starts with the stem; stems of
 * 3 letters or fewer must match the whole word (or its plural), so "sea" doesn't hit "search".
 */
const THEME_WORDS: Record<Theme, string[]> = {
  rain: ["rain", "storm", "tear", "cry", "cried", "crying", "ocean", "sea", "wave", "river", "drown", "water", "flood", "thunder", "sink"],
  fire: ["fire", "burn", "flame", "blaze", "heat", "smoke", "ash", "spark", "ignite", "inferno", "hot", "lava", "explode"],
  night: ["night", "moon", "star", "midnight", "dark", "sky", "galax", "planet", "space", "orbit", "cosmic", "universe", "heaven", "dream", "sleep"],
  snow: ["snow", "ice", "cold", "frozen", "freez", "winter", "frost", "chill", "december"],
  gold: ["gold", "money", "cash", "diamond", "rich", "dollar", "bands", "crown", "king", "queen", "shine", "glitter", "jewel", "million"],
  love: ["love", "heart", "kiss", "darling", "baby", "lover", "hold", "touch", "forever", "together", "honey", "sweet"],
  city: ["city", "street", "car", "drive", "driving", "highway", "road", "neon", "downtown", "lights", "traffic", "club", "speed", "fast"],
  nature: ["tree", "flower", "sun", "summer", "garden", "field", "wind", "bloom", "spring", "leaf", "leaves", "forest", "rose", "grass", "bird", "mountain", "sunshine", "sunset", "sunrise"],
};

// Words that start with a stem but mean something else.
const FALSE_FRIENDS = new Set(["start", "started", "starting", "starts", "stare", "stared", "staring", "window", "windows", "windshield", "windshields", "winding", "holder", "heather", "richard", "fasten"]);

const analyzer = new Sentiment();

export interface LineMood {
  /** -1 (dark/sad) .. +1 (bright/happy) */
  valence: number;
  themes: Theme[];
  /** words per second while this line is sung; null if unknown */
  wordsPerSec: number | null;
}

export interface SongMood {
  valence: number;
  /** words per minute over the sung parts: fast rap ≈ 200+, ballad ≈ 60 */
  wpm: number;
  /** up to 3 themes that come up most across the song */
  topThemes: Theme[];
  lines: LineMood[];
}

export function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’']/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function matches(word: string, stem: string): boolean {
  if (stem.length <= 3) return word === stem || word === stem + "s";
  return word.startsWith(stem);
}

export function themesOf(text: string): Theme[] {
  const ws = words(text).filter((w) => !FALSE_FRIENDS.has(w));
  const found: Theme[] = [];
  for (const theme of THEMES) {
    if (ws.some((w) => THEME_WORDS[theme].some((stem) => matches(w, stem)))) found.push(theme);
  }
  return found;
}

/** Sentiment of a piece of text, squashed into -1..+1. */
export function valenceOf(text: string): number {
  if (!text.trim()) return 0;
  const { comparative } = analyzer.analyze(text);
  return Math.tanh(comparative * 1.2);
}

export function analyzeLines(lines: LyricLine[]): LineMood[] {
  return lines.map((line, i) => {
    const next = lines[i + 1];
    const durSec = next ? (next.timeMs - line.timeMs) / 1000 : null;
    const count = words(line.text).length;
    return {
      valence: valenceOf(line.text),
      themes: themesOf(line.text),
      wordsPerSec: durSec && durSec > 0.3 && count ? Math.min(count / durSec, 8) : null,
    };
  });
}

export function analyzeSong(lines: LyricLine[], extraText = ""): SongMood {
  const moods = analyzeLines(lines);
  const allText = lines.map((l) => l.text).join("\n");

  // Words per minute across the lines that are actually sung (blank lines = instrumental breaks).
  let sungWords = 0;
  let sungSec = 0;
  moods.forEach((m, i) => {
    if (m.wordsPerSec == null) return;
    const dur = (lines[i + 1].timeMs - lines[i].timeMs) / 1000;
    sungWords += m.wordsPerSec * dur;
    sungSec += dur;
  });

  const counts = new Map<Theme, number>();
  for (const m of moods) for (const t of m.themes) bump(counts, t, 1);
  for (const t of themesOf(extraText)) bump(counts, t, 3); // the title and album count extra
  const topThemes = pickTop(counts, 2);

  return {
    valence: valenceOf(allText + "\n" + extraText),
    wpm: sungSec > 0 ? (sungWords / sungSec) * 60 : 0,
    topThemes,
    lines: moods,
  };
}

/** For plain (unsynced) lyrics, or just the title when there are no lyrics. */
export function analyzeText(text: string, extraText = ""): SongMood {
  const counts = new Map<Theme, number>();
  for (const line of text.split(/\r?\n/)) for (const t of themesOf(line)) bump(counts, t, 1);
  for (const t of themesOf(extraText)) bump(counts, t, 3);
  return {
    valence: valenceOf(text + "\n" + extraText),
    wpm: 0,
    topThemes: pickTop(counts, text.trim() ? 2 : 1),
    lines: [],
  };
}

function bump(counts: Map<Theme, number>, t: Theme, n: number) {
  counts.set(t, (counts.get(t) ?? 0) + n);
}

/** Up to 3 themes seen at least `min` times, most frequent first. */
function pickTop(counts: Map<Theme, number>, min: number): Theme[] {
  return [...counts.entries()]
    .filter(([, n]) => n >= min)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([t]) => t);
}
