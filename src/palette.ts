// Pull a color palette out of the album art with median-cut quantization.
// Written by hand (no library) so it's small, deterministic and testable.

import { adjust, hslToRgb, rgbToHsl, type RGB } from "./color";
import { LruCache } from "./storage";

export interface Palette {
  /** quantized colors, most common first */
  swatches: { color: RGB; population: number }[];
  /** the most common color */
  dominant: RGB;
  /** bright, saturated accent for particles and effects */
  vibrant: RGB;
  /** a second accent with a different hue when the art has one */
  secondary: RGB;
  /** deep shade for the background */
  dark: RGB;
  /** light tint for highlights */
  light: RGB;
}

export const DEFAULT_PALETTE: Palette = buildPalette([
  { color: [40, 30, 90], population: 5 },
  { color: [120, 60, 200], population: 3 },
  { color: [30, 180, 200], population: 2 },
  { color: [240, 200, 255], population: 1 },
]);

type Box = RGB[];

function range(box: Box, ch: 0 | 1 | 2): number {
  let lo = 255;
  let hi = 0;
  for (const p of box) {
    if (p[ch] < lo) lo = p[ch];
    if (p[ch] > hi) hi = p[ch];
  }
  return hi - lo;
}

/**
 * Where to split a sorted box: the place where the channel value changes that's
 * closest to the median, so one solid color never gets cut in half.
 */
function splitPoint(box: Box, ch: 0 | 1 | 2): number {
  const mid = box.length >> 1;
  for (let d = 0; d < box.length; d++) {
    const lo = mid - d;
    const hi = mid + d;
    if (lo > 0 && box[lo - 1][ch] !== box[lo][ch]) return lo;
    if (hi < box.length && hi > 0 && box[hi - 1][ch] !== box[hi][ch]) return hi;
  }
  return mid;
}

/** Median cut: keep splitting the box with the widest color range until we have `count`. */
export function quantize(pixels: RGB[], count = 8): { color: RGB; population: number }[] {
  if (!pixels.length) return [];
  const boxes: Box[] = [pixels];

  while (boxes.length < count) {
    // Split the box whose widest channel range × size is biggest.
    let best = -1;
    let bestScore = 0;
    let bestCh: 0 | 1 | 2 = 0;
    boxes.forEach((box, i) => {
      if (box.length < 2) return;
      for (const ch of [0, 1, 2] as const) {
        const score = range(box, ch) * Math.sqrt(box.length);
        if (score > bestScore) {
          bestScore = score;
          best = i;
          bestCh = ch;
        }
      }
    });
    if (best === -1) break; // nothing left to split (flat image)

    const box = boxes[best].sort((a, b) => a[bestCh] - b[bestCh]);
    const mid = splitPoint(box, bestCh);
    boxes.splice(best, 1, box.slice(0, mid), box.slice(mid));
  }

  return boxes
    .map((box) => {
      const sum = box.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1], acc[2] + p[2]], [0, 0, 0]);
      return {
        color: sum.map((v) => Math.round(v / box.length)) as RGB,
        population: box.length,
      };
    })
    .sort((a, b) => b.population - a.population);
}

/** Pick the roles (vibrant, dark, light…) from quantized swatches. */
export function buildPalette(swatches: { color: RGB; population: number }[]): Palette {
  if (!swatches.length) return DEFAULT_PALETTE;
  const total = swatches.reduce((s, w) => s + w.population, 0);
  const withHsl = swatches.map((w) => ({ ...w, hsl: rgbToHsl(w.color), share: w.population / total }));

  // Vibrant = saturated, mid-light, and not a tiny speck.
  const vibrancy = (x: (typeof withHsl)[number]) =>
    x.hsl.s * (1 - Math.abs(x.hsl.l - 0.55) * 1.6) * (0.4 + Math.sqrt(x.share));
  const byVibrancy = [...withHsl].sort((a, b) => vibrancy(b) - vibrancy(a));
  const vibrantSrc = byVibrancy[0];

  // Secondary = next vibrant color at least 40° away in hue, else a hue-shifted vibrant.
  const hueDist = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
  const secondarySrc = byVibrancy.find((x) => x !== vibrantSrc && x.hsl.s > 0.15 && hueDist(x.hsl.h, vibrantSrc.hsl.h) > 40);

  // Grayscale art (s≈0) still gets a little color so the visuals aren't dead.
  const vibrant = adjust(vibrantSrc.color, {
    s: Math.max(vibrantSrc.hsl.s, 0.35),
    l: Math.min(Math.max(vibrantSrc.hsl.l, 0.5), 0.68),
  });
  const secondary = secondarySrc
    ? adjust(secondarySrc.color, {
        s: Math.max(secondarySrc.hsl.s, 0.3),
        l: Math.min(Math.max(secondarySrc.hsl.l, 0.45), 0.7),
      })
    : rotateHue(vibrant, 40);

  const darkest = [...withHsl].sort((a, b) => a.hsl.l - b.hsl.l)[0];
  const lightest = [...withHsl].sort((a, b) => b.hsl.l - a.hsl.l)[0];
  const dominant = withHsl[0].color;

  return {
    swatches,
    dominant,
    vibrant,
    secondary,
    // Background always dark enough for white lyrics on top.
    dark: adjust(darkest.hsl.s < 0.1 ? dominant : darkest.color, { l: Math.min(darkest.hsl.l, 0.12) }),
    light: adjust(lightest.color, { l: Math.max(lightest.hsl.l, 0.82) }),
  };
}

function rotateHue(c: RGB, deg: number): RGB {
  const hsl = rgbToHsl(c);
  return hslToRgb({ ...hsl, h: hsl.h + deg });
}

/** Read RGBA bytes into pixels, skipping transparent ones. */
export function pixelsFromImageData(data: Uint8ClampedArray, step = 1): RGB[] {
  const out: RGB[] = [];
  for (let i = 0; i < data.length; i += 4 * step) {
    if (data[i + 3] < 125) continue;
    out.push([data[i], data[i + 1], data[i + 2]]);
  }
  return out;
}

/** Palette from anything drawable (image, canvas). Throws if the image isn't CORS-clean. */
export function paletteFromImage(image: CanvasImageSource): Palette {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);
  return buildPalette(quantize(pixelsFromImageData(data), 8));
}

const paletteCache = new LruCache<string, Palette>(50);

/** Load album art and build its palette. Falls back to DEFAULT_PALETTE on failure. */
export async function paletteFromUrl(url: string): Promise<{ palette: Palette; image: HTMLImageElement | null }> {
  let image: HTMLImageElement | null = null;
  try {
    image = await loadImage(url);
    const palette = paletteCache.get(url) ?? paletteFromImage(image);
    paletteCache.set(url, palette);
    return { palette, image };
  } catch {
    // No CORS: the art can still be shown (we never read its pixels), just not sampled.
    if (!image) image = await loadImage(url, false).catch(() => null);
    return { palette: DEFAULT_PALETTE, image };
  }
}

export function loadImage(url: string, cors = true): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (cors) img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`image failed: ${url}`));
    img.src = url;
  });
}
