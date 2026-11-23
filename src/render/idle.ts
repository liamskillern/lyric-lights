// Idle screensaver: when nothing is playing, a calm Aurora scene with a big clock.
// The clock drifts slowly so it never sits in one spot (no burn-in on TVs and OLED phones).

import { css, type RGB } from "../color";

/** After a pause, wait this long before going idle. */
export const PAUSE_IDLE_MS = 30_000;

/**
 * Should the screensaver show? Right away when nothing is loaded at all, after
 * PAUSE_IDLE_MS when a song is paused. (Pure, tested.)
 */
export function shouldIdle(hasTrack: boolean, isPlaying: boolean, lastPlayingAt: number, now: number): boolean {
  if (isPlaying) return false;
  if (!hasTrack) return true;
  return now - lastPlayingAt >= PAUSE_IDLE_MS;
}

/** Where the clock is at time `now` (ms): a slow loop around the middle of the screen. (Pure, tested.) */
export function clockPosition(w: number, h: number, now: number): { x: number; y: number } {
  const t = now / 1000;
  return {
    x: w / 2 + Math.sin(t / 47) * w * 0.16,
    y: h * 0.45 + Math.sin(t / 31 + 1) * h * 0.12,
  };
}

export function drawIdle(ctx: CanvasRenderingContext2D, w: number, h: number, now: number, color: RGB, glow: RGB, alpha: number, hint: string): void {
  if (alpha <= 0.01) return;
  const { x, y } = clockPosition(w, h, now);
  const time = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const size = Math.round(Math.min(Math.max(Math.min(w, h) * 0.18, 56), 180));
  const font = `"Inter", "Segoe UI", system-ui, -apple-system, Roboto, sans-serif`;

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `200 ${size}px ${font}`;
  ctx.shadowColor = css(glow, 0.5 * alpha);
  ctx.shadowBlur = size * 0.35;
  ctx.fillStyle = css(color, 0.92 * alpha);
  ctx.fillText(time, x, y);
  ctx.shadowBlur = 0;
  ctx.shadowColor = "transparent";
  ctx.font = `500 ${Math.round(size * 0.14)}px ${font}`;
  ctx.fillStyle = css(color, 0.55 * alpha);
  ctx.fillText(hint, x, y + size * 0.72, w * 0.9);
  ctx.restore();
}
