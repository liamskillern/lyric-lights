// Tunnel: rings of light rushing toward you. Faster with faster songs, in the chorus and on beats.

import { css, mix } from "../../color";
import { baseGradient, vignette, type BackgroundState } from "../background";

const RINGS = 22;
let travel = 0;
let lastT = 0;

export function drawTunnel(ctx: CanvasRenderingContext2D, w: number, h: number, s: BackgroundState): void {
  const { colors, t } = s;
  baseGradient(ctx, w, h, colors);

  const dt = Math.max(0, Math.min(0.2, t - lastT));
  lastT = t;
  travel += dt * (0.25 + s.chorus * 0.15 + s.pulse * 0.25);

  // The vanishing point drifts gently so it feels like flying, not a static target.
  const cx = w / 2 + Math.sin(t * 0.05) * w * 0.06;
  const cy = h / 2 + Math.cos(t * 0.04) * h * 0.05;
  const maxR = Math.hypot(w, h) * 0.6;

  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < RINGS; i++) {
    // depth 0 (far) .. 1 (near); rings move toward the viewer and wrap around.
    const depth = (i / RINGS + travel) % 1;
    const z = 0.05 + depth * depth * 0.95;
    const r = maxR * z * (1 + s.pulse * 0.04);
    const fade = Math.sin(depth * Math.PI); // fade in far away, fade out as it passes
    const ringIndex = Math.floor(i + travel * RINGS);
    const color = ringIndex % 3 === 0 ? colors.blobA : ringIndex % 3 === 1 ? colors.blobB : mix(colors.accent, colors.text, 0.3);
    ctx.strokeStyle = css(color, 0.45 * fade * s.brightness);
    ctx.lineWidth = 1 + z * 10 * (1 + (s.bass ?? 0) * 0.8);
    ctx.beginPath();
    // Slightly squashed rounded square: more "tunnel", less "target".
    const k = 0.82;
    ctx.ellipse(cx, cy, r, r * k, Math.sin(t * 0.03 + i * 0.05) * 0.2, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = "source-over";
  vignette(ctx, w, h, 0.55);
}
