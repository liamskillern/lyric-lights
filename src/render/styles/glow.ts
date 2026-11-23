// Glow: blurred album art with big soft color blobs drifting around. The original look.

import { baseGradient, blob, blurredArt, vignette, type BackgroundState } from "../background";

export function drawGlow(ctx: CanvasRenderingContext2D, w: number, h: number, s: BackgroundState): void {
  const { colors, t } = s;
  baseGradient(ctx, w, h, colors);
  blurredArt(ctx, w, h, s);

  ctx.globalCompositeOperation = "screen";
  const beat = s.beat ?? 0;
  const R = Math.max(w, h) * (1 + (s.bass ?? 0) * 0.18 + beat * 0.14);
  blob(ctx, w * (0.3 + 0.18 * Math.sin(t * 0.11)), h * (0.35 + 0.15 * Math.cos(t * 0.09)), R * 0.45 * (1 + s.pulse * 0.12), colors.blobA, 0.38 * s.brightness);
  blob(ctx, w * (0.72 + 0.15 * Math.cos(t * 0.08)), h * (0.65 + 0.18 * Math.sin(t * 0.12)), R * 0.4 * (1 + s.pulse * 0.1), colors.blobB, 0.32 * s.brightness);
  blob(ctx, w * (0.5 + 0.3 * Math.sin(t * 0.05 + 2)), h * (0.5 + 0.3 * Math.cos(t * 0.06 + 1)), R * 0.25, colors.accent, 0.16 * s.brightness);
  vignette(ctx, w, h);
}
