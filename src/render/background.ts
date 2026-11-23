// Gradient + blurred album art + slow glowing color blobs + vignette.

import { css, type RGB } from "../color";
import type { SceneColors } from "../scene";

/**
 * Pre-blur the album art once per track by shrinking it to a tiny canvas.
 * Scaling it back up with smoothing gives a soft blur that works in every browser
 * (ctx.filter = "blur()" doesn't work everywhere and is slow per frame).
 */
export function blurArt(image: CanvasImageSource | null): HTMLCanvasElement | null {
  if (!image) return null;
  const c = document.createElement("canvas");
  c.width = 20;
  c.height = 20;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, 20, 20);
  return c;
}

export interface BackgroundState {
  colors: SceneColors;
  brightness: number;
  /** 0..1, a quick swell on each beat */
  pulse: number;
  /** seconds of "scene time" (advances faster when the music is faster) */
  t: number;
  art: HTMLCanvasElement | null;
  /** 0..1 cross-fade for a newly loaded album art */
  artAlpha: number;
  prevArt: HTMLCanvasElement | null;
}

export function drawBackground(ctx: CanvasRenderingContext2D, w: number, h: number, s: BackgroundState): void {
  const { colors, t } = s;

  const g = ctx.createLinearGradient(0, 0, w * 0.3, h);
  g.addColorStop(0, css(colors.top));
  g.addColorStop(1, css(colors.bottom));
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // Blurred album art, slowly breathing.
  const drawArt = (art: HTMLCanvasElement, alpha: number) => {
    if (alpha <= 0.01) return;
    const size = Math.max(w, h) * (1.25 + Math.sin(t * 0.07) * 0.05 + s.pulse * 0.03);
    ctx.save();
    ctx.globalAlpha = 0.42 * alpha;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.translate(w / 2, h / 2);
    ctx.rotate(Math.sin(t * 0.03) * 0.08);
    ctx.drawImage(art, -size / 2, -size / 2, size, size);
    ctx.restore();
  };
  if (s.prevArt && s.artAlpha < 1) drawArt(s.prevArt, 1 - s.artAlpha);
  if (s.art) drawArt(s.art, s.artAlpha);

  // Glowing blobs drifting on slow looping paths.
  ctx.globalCompositeOperation = "screen";
  const R = Math.max(w, h);
  blob(ctx, w * (0.3 + 0.18 * Math.sin(t * 0.11)), h * (0.35 + 0.15 * Math.cos(t * 0.09)), R * 0.45 * (1 + s.pulse * 0.12), colors.blobA, 0.38 * s.brightness);
  blob(ctx, w * (0.72 + 0.15 * Math.cos(t * 0.08)), h * (0.65 + 0.18 * Math.sin(t * 0.12)), R * 0.4 * (1 + s.pulse * 0.1), colors.blobB, 0.32 * s.brightness);
  blob(ctx, w * (0.5 + 0.3 * Math.sin(t * 0.05 + 2)), h * (0.5 + 0.3 * Math.cos(t * 0.06 + 1)), R * 0.25, colors.accent, 0.16 * s.brightness);
  ctx.globalCompositeOperation = "source-over";

  // Vignette keeps the edges calm and the lyrics readable.
  const v = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.max(w, h) * 0.75);
  v.addColorStop(0, "rgb(0 0 0 / 0)");
  v.addColorStop(1, "rgb(0 0 0 / 0.6)");
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, w, h);
}

function blob(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: RGB, alpha: number): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, css(color, alpha));
  g.addColorStop(0.5, css(color, alpha * 0.35));
  g.addColorStop(1, css(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}
