// The "director": turns song data (palette, lyric mood, lyric speed, mic) into the
// numbers the renderer draws with. Pure functions, so the mapping is easy to test and tune.

import { adjust, clamp, mix, type RGB } from "./color";
import type { SongMood, Theme } from "./mood";
import type { Palette } from "./palette";

export const EFFECTS = ["rain", "embers", "stars", "snow", "sparkles", "glow", "streaks", "petals"] as const;
export type Effect = (typeof EFFECTS)[number];

/** Which visual effect each lyric theme turns on. */
export const EFFECT_FOR: Record<Theme, Effect> = {
  rain: "rain",
  fire: "embers",
  night: "stars",
  snow: "snow",
  gold: "sparkles",
  love: "glow",
  city: "streaks",
  nature: "petals",
};

export interface SceneColors {
  top: RGB;
  bottom: RGB;
  blobA: RGB;
  blobB: RGB;
  accent: RGB;
  text: RGB;
}

export interface SceneTarget {
  colors: SceneColors;
  /** overall motion speed, ~0.15 (paused) .. ~2 (fast rap) */
  speed: number;
  /** how bright the glowing layers are, ~0.5 .. 1.2 */
  brightness: number;
  /** 0..1 intensity for each effect */
  effects: Record<Effect, number>;
}

export interface SceneInput {
  palette: Palette;
  song: SongMood | null;
  /** index of the current lyric line, -1 if none */
  lineIndex: number;
  isPlaying: boolean;
}

const COOL: RGB = [12, 18, 48];
const WARM: RGB = [255, 170, 90];

export function noEffects(): Record<Effect, number> {
  return Object.fromEntries(EFFECTS.map((e) => [e, 0])) as Record<Effect, number>;
}

export function computeScene({ palette, song, lineIndex, isPlaying }: SceneInput): SceneTarget {
  const songValence = song?.valence ?? 0;
  const line = song && lineIndex >= 0 ? song.lines[lineIndex] : undefined;
  // The current line nudges the mood; the whole song sets the baseline.
  const valence = clamp(songValence * 0.6 + (line?.valence ?? songValence) * 0.4, -1, 1);

  // --- colors: album art, then tinted by mood ---
  const sad = Math.max(0, -valence);
  const happy = Math.max(0, valence);
  const top = mix(adjust(palette.dark, { dl: 0.04 + happy * 0.05 }), COOL, sad * 0.45);
  const bottom = mix(adjust(palette.dark, { l: 0.05 }), [0, 0, 0], 0.3 + sad * 0.3);
  const blobA = mix(palette.vibrant, WARM, happy * 0.25);
  const blobB = mix(palette.secondary, COOL, sad * 0.4);
  const accent = adjust(mix(palette.vibrant, palette.light, 0.15), { ds: 0.1 + happy * 0.1 });
  const text = mix([255, 255, 255], palette.light, 0.15);

  // --- motion: faster lyrics → faster visuals ---
  let speed = 0.15;
  if (isPlaying) {
    const wpmFactor = clamp((song?.wpm ?? 90) / 180, 0, 1.4);
    const lineRush = line?.wordsPerSec != null ? clamp((line.wordsPerSec - 2) / 4, 0, 0.5) : 0;
    speed = 0.45 + wpmFactor * 0.9 + lineRush * 0.4 + valence * 0.12;
  }

  // --- effects: song themes in the background, current line's themes up front ---
  const effects = noEffects();
  song?.topThemes.forEach((t, i) => {
    effects[EFFECT_FOR[t]] = Math.max(effects[EFFECT_FOR[t]], i === 0 ? 0.45 : 0.3);
  });
  line?.themes.forEach((t) => {
    effects[EFFECT_FOR[t]] = 1;
  });
  if (!isPlaying) for (const e of EFFECTS) effects[e] *= 0.4;

  return {
    colors: { top, bottom, blobA, blobB, accent, text },
    speed: clamp(speed, 0.1, 2.2),
    brightness: clamp(0.75 + valence * 0.3, 0.45, 1.2),
    effects,
  };
}
