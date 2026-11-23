// Vinyl: the album cover as a spinning record. Spin speed follows the music; the grooves
// catch the light on each beat. The lyrics move below the record (see LYRICS_Y).

import { css } from "../../color";
import { baseGradient, blob, blurredArt, vignette, type BackgroundState } from "../background";

/** Where the lyrics go in this style (fraction of screen height). */
export const VINYL_LYRICS_Y = 0.76;

let angle = 0;
let lastT = 0;

export function vinylGeometry(w: number, h: number): { cx: number; cy: number; r: number } {
  const r = Math.min(w * 0.3, h * 0.29);
  return { cx: w / 2, cy: h * 0.4, r };
}

export function drawVinyl(ctx: CanvasRenderingContext2D, w: number, h: number, s: BackgroundState): void {
  const { colors } = s;
  baseGradient(ctx, w, h, colors);
  blurredArt(ctx, w, h, s, 0.3);

  // Spin: scene time already runs faster for faster songs.
  const dt = Math.max(0, Math.min(0.2, s.t - lastT));
  lastT = s.t;
  angle += dt * 0.9;

  const { cx, cy, r } = vinylGeometry(w, h);
  ctx.globalCompositeOperation = "screen";
  blob(ctx, cx, cy, r * 2.1 * (1 + s.pulse * 0.08 + (s.bass ?? 0) * 0.1), colors.blobA, 0.35 * s.brightness);
  ctx.globalCompositeOperation = "source-over";

  ctx.save();
  ctx.translate(cx, cy);
  // Shadow under the record.
  ctx.shadowColor = "rgb(0 0 0 / 0.6)";
  ctx.shadowBlur = r * 0.25;
  ctx.fillStyle = "#0b0b0d";
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.shadowColor = "transparent";

  ctx.rotate(angle);
  // Grooves.
  const glow = 0.05 + s.pulse * 0.12 + s.chorus * 0.05;
  ctx.lineWidth = 1;
  for (let rr = r * 0.46; rr < r * 0.97; rr += r * 0.022) {
    ctx.strokeStyle = css(colors.text, glow * (0.6 + 0.4 * Math.sin(rr)));
    ctx.beginPath();
    ctx.arc(0, 0, rr, 0, Math.PI * 2);
    ctx.stroke();
  }
  // Light catching the vinyl: two soft wedges.
  ctx.globalCompositeOperation = "lighter";
  for (const a0 of [0.6, 0.6 + Math.PI]) {
    const g = ctx.createRadialGradient(0, 0, r * 0.4, 0, 0, r);
    g.addColorStop(0, css(colors.accent, 0));
    g.addColorStop(1, css(colors.accent, 0.1 * s.brightness));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, r, a0 - angle - 0.25, a0 - angle + 0.25); // stays still while the record turns
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";

  // Center label = the album art.
  const lr = r * 0.42;
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, lr, 0, Math.PI * 2);
  ctx.clip();
  if (s.image) {
    ctx.drawImage(s.image, -lr, -lr, lr * 2, lr * 2);
  } else {
    ctx.fillStyle = css(colors.blobB);
    ctx.fillRect(-lr, -lr, lr * 2, lr * 2);
  }
  ctx.restore();
  // Spindle hole.
  ctx.fillStyle = "#0b0b0d";
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.025, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  vignette(ctx, w, h, 0.5);
}
