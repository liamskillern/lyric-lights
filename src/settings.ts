// User settings, kept in localStorage (nothing here is sensitive).
// Stored values are treated as untrusted: anything missing, the wrong type or out of
// range falls back to the default, so a broken or tampered value can't break the app.

import { FONT_CHOICES, type FontChoice } from "./fonts";
import { LYRIC_ANIMS, type LyricAnim } from "./render/lyricAnim";
import { local } from "./storage";

export const STYLES = ["glow", "aurora", "vinyl", "tunnel"] as const;
export type VisualStyle = (typeof STYLES)[number];
export const STYLE_NAMES: Record<VisualStyle, string> = {
  glow: "Glow",
  aurora: "Aurora",
  vinyl: "Vinyl",
  tunnel: "Tunnel",
};

export const LYRIC_SIZES = { s: 0.8, m: 1, l: 1.25 } as const;
export type LyricSize = keyof typeof LYRIC_SIZES;

export interface Settings {
  style: VisualStyle;
  /** 0 (no effects) .. 1.5 */
  effectStrength: number;
  showLyrics: boolean;
  /** lyric font, or "auto" to pick per song */
  font: FontChoice;
  lyricSize: LyricSize;
  /** how lines arrive and leave */
  lyricAnim: LyricAnim;
  /** three-line sing-along layout */
  karaoke: boolean;
  /** shift lyrics earlier (+) or later (−), -3000..3000 ms */
  lyricOffsetMs: number;
  /** which source the Beat button uses */
  beatSource: "system" | "mic";
  /** 0 (fewer beats) .. 1 (more beats) */
  beatSensitivity: number;
  showUpNext: boolean;
  /** pulse on the tempo guessed from lyrics when beat sync is off */
  guessedPulse: boolean;
  /** calmer: slower, fewer particles, no flashes */
  reducedMotion: boolean;
}

const KEY = "sv.settings";
const LEGACY_OFFSET_KEY = "sv.lyricOffset";

export function defaultSettings(prefersReducedMotion = false, canShareSystemAudio = true): Settings {
  return {
    style: "glow",
    effectStrength: 1,
    showLyrics: true,
    font: "modern",
    lyricSize: "m",
    lyricAnim: "rise",
    karaoke: false,
    lyricOffsetMs: 0,
    beatSource: canShareSystemAudio ? "system" : "mic",
    beatSensitivity: 0.5,
    showUpNext: true,
    guessedPulse: false,
    reducedMotion: prefersReducedMotion,
  };
}

const num = (v: unknown, lo: number, hi: number, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
const oneOf = <T extends string>(v: unknown, options: readonly T[], fallback: T): T =>
  typeof v === "string" && (options as readonly string[]).includes(v) ? (v as T) : fallback;

/** Validate anything (parsed JSON, or junk) into a complete Settings object. (Pure, tested.) */
export function parseSettings(raw: unknown, defaults: Settings): Settings {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    style: oneOf(r.style, STYLES, defaults.style),
    effectStrength: num(r.effectStrength, 0, 1.5, defaults.effectStrength),
    showLyrics: bool(r.showLyrics, defaults.showLyrics),
    font: oneOf(r.font, FONT_CHOICES, defaults.font),
    lyricSize: oneOf(r.lyricSize, Object.keys(LYRIC_SIZES) as LyricSize[], defaults.lyricSize),
    lyricAnim: oneOf(r.lyricAnim, LYRIC_ANIMS, defaults.lyricAnim),
    karaoke: bool(r.karaoke, defaults.karaoke),
    lyricOffsetMs: Math.round(num(r.lyricOffsetMs, -3000, 3000, defaults.lyricOffsetMs)),
    beatSource: oneOf(r.beatSource, ["system", "mic"] as const, defaults.beatSource),
    beatSensitivity: num(r.beatSensitivity, 0, 1, defaults.beatSensitivity),
    showUpNext: bool(r.showUpNext, defaults.showUpNext),
    guessedPulse: bool(r.guessedPulse, defaults.guessedPulse),
    reducedMotion: bool(r.reducedMotion, defaults.reducedMotion),
  };
}

export function loadSettings(defaults: Settings): Settings {
  let raw: unknown = null;
  try {
    raw = JSON.parse(local.get(KEY) ?? "null");
  } catch {
    raw = null;
  }
  const s = parseSettings(raw, defaults);
  // Older versions stored only the lyric offset, under its own key.
  const legacy = local.get(LEGACY_OFFSET_KEY);
  if (legacy !== null) {
    if (raw === null) s.lyricOffsetMs = parseSettings({ lyricOffsetMs: Number(legacy) }, defaults).lyricOffsetMs;
    local.remove(LEGACY_OFFSET_KEY);
  }
  return s;
}

export function saveSettings(s: Settings): void {
  local.set(KEY, JSON.stringify(s));
}
