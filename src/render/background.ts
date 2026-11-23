// Shared background pieces used by the visual styles (see styles/).

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
  /** 0..1 live bass level (0 without beat sync) */
  bass?: number;
  /** seconds of "scene time" (advances faster when the music is faster) */
  t: number;
  art: HTMLCanvasElement | null;
  /** 0..1 cross-fade for a newly loaded album art */
  artAlpha: number;
  prevArt: HTMLCanvasElement | null;
  /** the sharp album art (for Vinyl) */
  image: CanvasImageSource | null;
  /** 0..1 while the chorus plays */
  chorus: number;
  /** current motion speed (≈0.15..2.4) */
  speed: number;
  /** beat clock pulse 0..1: peaks on each beat (0 when off) */
  beat?: number;
}

export function baseGradient(ctx: CanvasRenderingContext2D, w: number, h: number, colors: SceneColors): void {
  const g = ctx.createLinearGradient(0, 0, w * 0.3, h);
  g.addColorStop(0, css(colors.top));
  g.addColorStop(1, css(colors.bottom));
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/** Blurred album art covering the screen, slowly breathing, cross-faded between songs. */
export function blurredArt(ctx: CanvasRenderingContext2D, w: number, h: number, s: BackgroundState, strength = 0.42): void {
  const { t } = s;
  const drawArt = (art: HTMLCanvasElement, alpha: number) => {
    if (alpha <= 0.01) return;
    const size = Math.max(w, h) * (1.25 + Math.sin(t * 0.07) * 0.05 + s.pulse * 0.03);
    ctx.save();
    ctx.globalAlpha = strength * alpha;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.translate(w / 2, h / 2);
    ctx.rotate(Math.sin(t * 0.03) * 0.08);
    ctx.drawImage(art, -size / 2, -size / 2, size, size);
    ctx.restore();
  };
  if (s.prevArt && s.artAlpha < 1) drawArt(s.prevArt, 1 - s.artAlpha);
  if (s.art) drawArt(s.art, s.artAlpha);
}

/** Dark edges keep things calm and the lyrics readable. */
export function vignette(ctx: CanvasRenderingContext2D, w: number, h: number, strength = 0.6): void {
  ctx.globalCompositeOperation = "source-over";
  const v = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.max(w, h) * 0.75);
  v.addColorStop(0, "rgb(0 0 0 / 0)");
  v.addColorStop(1, `rgb(0 0 0 / ${strength})`);
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, w, h);
}

export function blob(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: RGB, alpha: number): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, css(color, alpha));
  g.addColorStop(0.5, css(color, alpha * 0.35));
  g.addColorStop(1, css(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}
