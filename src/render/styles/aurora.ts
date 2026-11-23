// Aurora: slow curtains of light in the album colors, like northern lights.

import { css, mix, type RGB } from "../../color";
import { baseGradient, blurredArt, vignette, type BackgroundState } from "../background";

export function drawAurora(ctx: CanvasRenderingContext2D, w: number, h: number, s: BackgroundState): void {
  const { colors, t } = s;
  baseGradient(ctx, w, h, colors);
  blurredArt(ctx, w, h, s, 0.18);

  ctx.globalCompositeOperation = "lighter";
  const ribbons: { color: RGB; y: number; amp: number; freq: number; phase: number; height: number }[] = [
    { color: colors.blobA, y: 0.38, amp: 0.09, freq: 1.3, phase: 0, height: 0.42 },
    { color: colors.blobB, y: 0.52, amp: 0.07, freq: 1.8, phase: 2.1, height: 0.36 },
    { color: mix(colors.accent, colors.text, 0.2), y: 0.3, amp: 0.06, freq: 2.4, phase: 4.2, height: 0.26 },
  ];
  const beat = s.beat ?? 0;
  const lift = 1 + (s.bass ?? 0) * 0.35 + s.pulse * 0.12 + s.chorus * 0.25 + beat * 0.22;
  const steps = 64;
  for (const r of ribbons) {
    // A curtain: a wavy top edge, and light hanging down from it that fades out.
    const top: [number, number][] = [];
    for (let i = 0; i <= steps; i++) {
      const x = (i / steps) * w;
      const u = i / steps;
      const wave =
        Math.sin(u * Math.PI * r.freq + t * 0.35 + r.phase) * r.amp +
        Math.sin(u * Math.PI * r.freq * 2.3 - t * 0.22 + r.phase) * r.amp * 0.4;
      top.push([x, h * (r.y + wave)]);
    }
    const hang = h * r.height * lift;
    const g = ctx.createLinearGradient(0, h * (r.y - r.amp * 1.4), 0, h * (r.y + r.amp) + hang);
    const a = 0.32 * s.brightness * (1 + beat * 0.3);
    g.addColorStop(0, css(r.color, 0));
    g.addColorStop(0.18, css(r.color, a));
    g.addColorStop(0.45, css(r.color, a * 0.45));
    g.addColorStop(1, css(r.color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(top[0][0], top[0][1] - 6);
    for (const [x, y] of top) ctx.lineTo(x, y - 6);
    for (let i = top.length - 1; i >= 0; i--) {
      const [x, y] = top[i];
      // Uneven bottom edge so it looks like hanging light, not a band.
      const u = i / steps;
      const drip = 0.7 + 0.2 * Math.sin(u * Math.PI * 3 + t * 0.4 + r.phase) + 0.1 * Math.sin(u * Math.PI * 7 - t * 0.3);
      ctx.lineTo(x, y + hang * drip);
    }
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";
  vignette(ctx, w, h, 0.5);
}
