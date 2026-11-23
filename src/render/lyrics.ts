// Draws the current lyric line big in the middle, the next line faded below,
// and the previous line floating away above. Also a title card at the start of a song.

import { css, type RGB } from "../color";
import type { LyricLine } from "../lyrics";

import { FONTS, fontCss, type FontSpec } from "../fonts";
const ENTER_MS = 420;

/** Greedy word wrap. `measure` returns a string's width. (Pure, tested.) */
export function wrapText(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    const tryLine = cur ? `${cur} ${word}` : word;
    if (measure(tryLine) <= maxWidth || !cur) {
      cur = tryLine;
    } else {
      lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

const ease = (t: number) => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;

export interface LyricFrame {
  lines: LyricLine[] | null;
  index: number;
  /** performance.now() when `index` last changed */
  changedAt: number;
  now: number;
  color: RGB;
  glow: RGB;
  pulse: number;
  /** vertical center of the lyrics, fraction of height (default 0.5) */
  centerY?: number;
  /** which font to draw with (default Modern) */
  font?: FontSpec;
  /** user setting: lyric size multiplier */
  size?: number;
  /** 0..1, eases in during the chorus: bigger text */
  chorus?: number;
  title: { name: string; artist: string; shownAt: number } | null;
}

export class LyricsLayer {
  private wrapCache = new Map<string, string[]>();
  private cacheKey = "";

  private font: FontSpec = FONTS.modern;

  /** Forget measured line breaks (call when a font finishes loading: its widths differ). */
  clearCache(): void {
    this.wrapCache.clear();
  }

  draw(ctx: CanvasRenderingContext2D, w: number, h: number, f: LyricFrame): void {
    this.font = f.font ?? FONTS.modern;
    const base = Math.round(Math.min(Math.max(Math.min(w, h) * 0.068, 22), 76) * (f.size ?? 1) * this.font.scale);
    const key = `${w}x${h}|${this.font.family}`;
    if (key !== this.cacheKey) {
      this.wrapCache.clear();
      this.cacheKey = key;
    }

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // Title card for the first few seconds of a song (before any lyric is sung).
    if (f.title && f.index < 0) {
      const age = f.now - f.title.shownAt;
      const a = Math.min(ease(age / 800), 1 - ease((age - 4500) / 900));
      if (a > 0.01) {
        const ty = h * (f.centerY ?? 0.5);
        this.text(ctx, f.title.name, w / 2, ty - base * 0.35, base * 0.95, this.font.bold, css(f.color, a), f.glow, a, w * 0.86);
        this.text(ctx, f.title.artist, w / 2, ty + base * 0.75, base * 0.5, this.font.light, css(f.color, a * 0.7), f.glow, 0, w * 0.86);
      }
    }

    const lines = f.lines;
    if (!lines?.length) return;

    const t = ease((f.now - f.changedAt) / ENTER_MS);
    const cur = lines[f.index]?.text ?? "";
    const prev = f.index > 0 ? lines[f.index - 1].text : "";
    const next = lines[f.index + 1]?.text ?? "";
    const cy = h * (f.centerY ?? 0.5);

    // Previous line: drifts up and fades out.
    if (prev && t < 1) {
      this.block(ctx, prev, w, cy - base * 1.2 * t, base, css(f.color, 0.95 * (1 - t)), f.glow, 0, 1);
    }
    // Current line: rises into place; pulses slightly on beats.
    if (cur) {
      const scale = 1 + f.pulse * 0.035 + (f.chorus ?? 0) * 0.12;
      this.block(ctx, cur, w, cy + base * 0.6 * (1 - t), base * scale, css(f.color, t), f.glow, 0.9 * t, 1);
    }
    // Next line: a quiet preview below.
    if (next) {
      const curH = this.height(ctx, cur || " ", w, base);
      this.block(ctx, next, w, cy + curH / 2 + base * 1.15, base * 0.6, css(f.color, 0.32 * t), f.glow, 0, 0.6);
    }
  }

  private wrap(ctx: CanvasRenderingContext2D, text: string, w: number, size: number): string[] {
    const k = `${size}|${text}`;
    let lines = this.wrapCache.get(k);
    if (!lines) {
      ctx.font = fontCss(this.font, this.font.bold, size);
      lines = wrapText(text, w * 0.84, (s) => ctx.measureText(s).width);
      if (this.wrapCache.size > 400) this.wrapCache.clear(); // stay small over long sessions
      this.wrapCache.set(k, lines);
    }
    return lines;
  }

  /** Font size that keeps a line to at most 3 rows. */
  private fit(ctx: CanvasRenderingContext2D, text: string, w: number, size: number): number {
    let s = size;
    while (s > 16 && this.wrap(ctx, text, w, s).length > 3) s = Math.round(s * 0.88);
    return s;
  }

  private height(ctx: CanvasRenderingContext2D, text: string, w: number, size: number): number {
    const s = this.fit(ctx, text, w, size);
    return this.wrap(ctx, text, w, s).length * s * 1.15;
  }

  private block(ctx: CanvasRenderingContext2D, text: string, w: number, cy: number, size: number, color: string, glow: RGB, glowAmt: number, weightK: number): void {
    const s = this.fit(ctx, text, w, Math.round(size));
    const rows = this.wrap(ctx, text, w, s);
    const lh = s * 1.15;
    const top = cy - ((rows.length - 1) * lh) / 2;
    rows.forEach((row, i) => this.text(ctx, row, w / 2, top + i * lh, s, weightK < 1 ? this.font.light : this.font.bold, color, glow, glowAmt, w * 0.9));
  }

  private text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, weight: number, color: string, glow: RGB, glowAmt: number, maxW: number): void {
    ctx.font = fontCss(this.font, weight, size);
    ctx.shadowColor = glowAmt > 0 ? css(glow, 0.55 * glowAmt) : "rgb(0 0 0 / 0.45)";
    ctx.shadowBlur = glowAmt > 0 ? size * 0.5 : size * 0.3;
    ctx.fillStyle = color;
    ctx.fillText(s, x, y, maxW);
    ctx.shadowBlur = 0;
    ctx.shadowColor = "transparent";
  }
}
