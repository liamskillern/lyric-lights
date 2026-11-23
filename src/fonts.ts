// Lyric fonts. All self-hosted (bundled from @fontsource, free licenses), so the strict
// Content-Security-Policy stays as is and no font service learns who's visiting.
// Only the Latin subset is included; the browser downloads a font file only when it's used.

import "@fontsource/inter/latin-200.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-800.css";
import "@fontsource/bebas-neue/latin-400.css";
import "@fontsource/playfair-display/latin-400.css";
import "@fontsource/playfair-display/latin-700.css";
import "@fontsource/permanent-marker/latin-400.css";
import "@fontsource/righteous/latin-400.css";
import "@fontsource/space-mono/latin-400.css";
import "@fontsource/space-mono/latin-700.css";

import type { SongMood } from "./mood";

export interface FontSpec {
  label: string;
  family: string;
  /** weight for the current line */
  bold: number;
  /** weight for secondary text (next line, artist) */
  light: number;
  /** some fonts look small or big at the same size */
  scale: number;
}

const FALLBACK = `"Segoe UI", system-ui, -apple-system, Roboto, sans-serif`;

export const FONTS = {
  modern: { label: "Modern", family: `"Inter"`, bold: 800, light: 600, scale: 1 },
  poster: { label: "Poster", family: `"Bebas Neue"`, bold: 400, light: 400, scale: 1.22 },
  elegant: { label: "Elegant", family: `"Playfair Display"`, bold: 700, light: 400, scale: 1.02 },
  marker: { label: "Marker", family: `"Permanent Marker"`, bold: 400, light: 400, scale: 0.98 },
  retro: { label: "Retro", family: `"Righteous"`, bold: 400, light: 400, scale: 1 },
  mono: { label: "Mono", family: `"Space Mono"`, bold: 700, light: 400, scale: 0.88 },
} satisfies Record<string, FontSpec>;

export type FontKey = keyof typeof FONTS;
export const FONT_CHOICES = ["auto", ...(Object.keys(FONTS) as FontKey[])] as const;
export type FontChoice = (typeof FONT_CHOICES)[number];

export function fontCss(spec: FontSpec, weight: number, sizePx: number): string {
  return `${weight} ${Math.round(sizePx)}px ${spec.family}, ${FALLBACK}`;
}

/**
 * "Auto": pick a font that fits the song. Rap-speed lyrics get Marker, fast or upbeat songs
 * get Poster, slow or sad ones Elegant, everything else Modern. (Pure, tested.)
 */
export function pickAutoFont(song: SongMood | null, bpm: number | null): FontKey {
  if (!song) return "modern";
  if (song.wpm >= 170) return "marker";
  if ((bpm !== null && bpm >= 140) || (song.valence > 0.3 && song.wpm > 110)) return "poster";
  if (song.valence < -0.25 || (bpm !== null && bpm < 85)) return "elegant";
  return "modern";
}

export function resolveFont(choice: FontChoice, song: SongMood | null, bpm: number | null): FontKey {
  return choice === "auto" ? pickAutoFont(song, bpm) : choice;
}

const requested = new Set<FontKey>();
/** Start downloading a font so it's ready; the canvas uses the fallback until then. */
export function loadFont(key: FontKey): void {
  if (requested.has(key) || typeof document === "undefined" || !document.fonts) return;
  requested.add(key);
  const spec = FONTS[key];
  const weights = new Set([spec.bold, spec.light]);
  for (const w of weights) void document.fonts.load(`${w} 40px ${spec.family}`).catch(() => {});
}
