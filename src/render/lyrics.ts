// Draws the lyrics: the current line big, the next line faded below, the previous line
// leaving (how depends on the chosen animation), or the three-line karaoke layout.
// Also a title card at the start of a song.

import { css, type RGB } from "../color";
import type { LyricLine } from "../lyrics";

import { FONTS, fontCss, type FontSpec } from "../fonts";
import { countdownDots, karaokeLines } from "./karaoke";
import { enter, ENTER_MS, exit, visibleChars, wordProgress, type LyricAnim } from "./lyricAnim";

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
  /** position in the song (ms), for typewriter and karaoke timing */
  songMs?: number;
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
  /** how lines arrive and leave (default Rise) */
  anim?: LyricAnim;
  /** three-line sing-along layout */
  karaoke?: boolean;
  title: { name: string; artist: string; shownAt: number } | null;
}

interface BlockStyle {
  color: RGB;
  alpha: number;
  glow: RGB;
  glowAmt: number;
  light?: boolean;
  /** typewriter: characters showing */
  chars?: number;
  /** karaoke: fill per word (0..1); unfilled text is drawn dim */
  fills?: number[];
  dimAlpha?: number;
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
    ctx.textBaseline = "middle";

    // Title card for the first few seconds of a song (before any lyric is sung).
    if (f.title && f.index < 0) {
      const age = f.now - f.title.shownAt;
      const a = Math.min(ease(age / 800), 1 - ease((age - 4500) / 900));
      if (a > 0.01) {
        const ty = h * (f.karaoke ? 0.38 : (f.centerY ?? 0.5));
        ctx.textAlign = "center";
        this.text(ctx, f.title.name, w / 2, ty - base * 0.35, base * 0.95, this.font.bold, css(f.color, a), f.glow, a, w * 0.86);
        this.text(ctx, f.title.artist, w / 2, ty + base * 0.75, base * 0.5, this.font.light, css(f.color, a * 0.7), f.glow, 0, w * 0.86);
      }
    }

    const lines = f.lines;
    if (!lines?.length) return;
    if (f.karaoke) return this.drawKaraoke(ctx, w, h, f, lines, base);

    const anim = f.anim ?? "rise";
    const p = (f.now - f.changedAt) / ENTER_MS;
    const cur = lines[f.index];
    const prev = f.index > 0 ? lines[f.index - 1] : null;
    const next = lines[f.index + 1] ?? null;
    const cy = h * (f.centerY ?? 0.5);
    const songMs = f.songMs ?? 0;

    // Previous line leaving.
    if (prev?.text && p < 1) {
      const a = exit(anim, p);
      this.block(ctx, prev.text, w, w / 2 + a.dx * w, cy + a.dy * base, base * a.scale, { color: f.color, alpha: 0.95 * a.alpha, glow: f.glow, glowAmt: 0 });
    }
    // Current line arriving (then staying); pulses a little on beats, grows in the chorus.
    if (cur?.text) {
      const a = enter(anim, p);
      const scale = a.scale * (1 + f.pulse * 0.035 + (f.chorus ?? 0) * 0.12);
      const style: BlockStyle = { color: f.color, alpha: a.alpha, glow: f.glow, glowAmt: 0.9 * a.alpha };
      if (anim === "typewriter") style.chars = visibleChars(cur, next?.timeMs ?? null, songMs);
      if (anim === "karaoke") {
        style.fills = wordProgress(cur, next?.timeMs ?? null, songMs);
        style.dimAlpha = 0.35;
      }
      this.block(ctx, cur.text, w, w / 2 + a.dx * w, cy + a.dy * base, base * scale, style);
    }
    // Next line: a quiet preview below.
    if (next?.text) {
      const t = enter(anim === "typewriter" ? "fade" : anim, p).alpha;
      const curH = this.height(ctx, cur?.text || " ", w, base);
      this.block(ctx, next.text, w, w / 2, cy + curH / 2 + base * 1.15, base * 0.6, { color: f.color, alpha: 0.32 * t, glow: f.glow, glowAmt: 0, light: true });
    }
  }

  /** Karaoke mode: a dark band, three lines (current filling word by word), countdown dots. */
  private drawKaraoke(ctx: CanvasRenderingContext2D, w: number, h: number, f: LyricFrame, lines: LyricLine[], base: number): void {
    const songMs = f.songMs ?? 0;
    const big = base * 1.15;
    const cy = h * 0.6;
    const { current, upcoming } = karaokeLines(lines, f.index);

    // Soft dark band behind the text so it reads over any background.
    const band = ctx.createLinearGradient(0, cy - big * 2.4, 0, cy + big * 3.6);
    band.addColorStop(0, "rgb(0 0 0 / 0)");
    band.addColorStop(0.3, "rgb(0 0 0 / 0.45)");
    band.addColorStop(0.75, "rgb(0 0 0 / 0.45)");
    band.addColorStop(1, "rgb(0 0 0 / 0)");
    ctx.fillStyle = band;
    ctx.fillRect(0, cy - big * 2.4, w, big * 6);

    // Lines glide up one slot when the line changes.
    const shift = (1 - ease((f.now - f.changedAt) / 350)) * big * 1.4;
    let y = cy + shift;

    if (current) {
      const nextStart = lines.slice(f.index + 1).find((l) => l.text.trim())?.timeMs ?? null;
      const fills = wordProgress(current, nextStart, songMs);
      const scale = 1 + f.pulse * 0.02 + (f.chorus ?? 0) * 0.08;
      this.block(ctx, current.text, w, w / 2, y, big * scale, { color: f.color, alpha: 1, glow: f.glow, glowAmt: 0.8, fills, dimAlpha: 0.42 });
      y += this.height(ctx, current.text, w, big) / 2 + big * 0.95;
    }
    upcoming.forEach((line, i) => {
      const size = big * (i === 0 ? 0.72 : 0.6);
      const hgt = this.height(ctx, line.text, w, size);
      this.block(ctx, line.text, w, w / 2, y + hgt / 2 - size / 2, size, { color: f.color, alpha: i === 0 ? 0.5 : 0.3, glow: f.glow, glowAmt: 0, light: true });
      y += hgt + size * 0.45;
    });

    // Countdown dots above the lines: ● ● ● → ● ● → ●
    const dots = countdownDots(lines, songMs);
    if (dots > 0) {
      const r = Math.max(5, big * 0.13);
      const gap = r * 3.2;
      const dy = cy - big * 1.35;
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = css(f.color, i < dots ? 0.95 : 0.18);
        ctx.beginPath();
        ctx.arc(w / 2 + (i - 1) * gap, dy, r, 0, Math.PI * 2);
        ctx.fill();
      }
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

  private block(ctx: CanvasRenderingContext2D, text: string, w: number, cx: number, cy: number, size: number, st: BlockStyle): void {
    if (st.alpha <= 0.005) return;
    const s = this.fit(ctx, text, w, Math.round(size));
    const rows = this.wrap(ctx, text, w, s);
    const lh = s * 1.15;
    const top = cy - ((rows.length - 1) * lh) / 2;
    const weight = st.light ? this.font.light : this.font.bold;
    const color = css(st.color, st.alpha);

    // Simple case: whole rows, centered.
    if (st.chars === undefined && !st.fills) {
      ctx.textAlign = "center";
      rows.forEach((row, i) => this.text(ctx, row, cx, top + i * lh, s, weight, color, st.glow, st.glowAmt, w * 0.9));
      return;
    }

    // Typewriter / karaoke: draw left-aligned from where the centered row would start,
    // so the text doesn't jump around as it appears or fills.
    ctx.textAlign = "left";
    ctx.font = fontCss(this.font, weight, s);
    let charsBefore = 0;
    let wordIdx = 0;
    rows.forEach((row, i) => {
      const y = top + i * lh;
      const rowW = Math.min(ctx.measureText(row).width, w * 0.9);
      const x0 = cx - rowW / 2;

      if (st.chars !== undefined) {
        const vis = Math.max(0, Math.min(row.length, st.chars - charsBefore));
        charsBefore += row.length + 1;
        if (vis > 0) this.text(ctx, row.slice(0, vis), x0, y, s, weight, color, st.glow, st.glowAmt, w * 0.9);
        return;
      }

      // Karaoke: dim row, then the sung part again in full color, clipped to how far it's filled.
      const words = row.split(" ");
      let litW = 0;
      for (let k = 0; k < words.length; k++) {
        const fill = st.fills![wordIdx + k] ?? 0;
        const wordW = ctx.measureText(words[k]).width;
        if (fill >= 1) {
          litW = ctx.measureText(words.slice(0, k + 1).join(" ") + (k < words.length - 1 ? " " : "")).width;
          continue;
        }
        if (fill > 0) litW = ctx.measureText(words.slice(0, k).join(" ") + (k > 0 ? " " : "")).width + wordW * fill;
        break;
      }
      wordIdx += words.length;
      this.text(ctx, row, x0, y, s, weight, css(st.color, st.alpha * (st.dimAlpha ?? 0.35)), st.glow, 0, w * 0.9);
      if (litW > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x0 - s, y - s, litW + s, s * 2);
        ctx.clip();
        this.text(ctx, row, x0, y, s, weight, color, st.glow, st.glowAmt, w * 0.9);
        ctx.restore();
      }
    });
    ctx.textAlign = "center";
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
