// Owns the canvas: smooths the scene toward its target every frame and draws the layers.

import { lerp, mix, type RGB } from "../color";
import type { LyricLine } from "../lyrics";
import { EFFECTS, noEffects, type Effect, type SceneColors, type SceneTarget } from "../scene";
import { blurArt, drawBackground } from "./background";
import { Effects } from "./effects";
import { LyricsLayer } from "./lyrics";

export interface FrameInput {
  now: number;
  target: SceneTarget;
  lyrics: LyricLine[] | null;
  lineIndex: number;
  beat: boolean;
  /** mic loudness 0..1 (0 when the mic is off) */
  level: number;
}

interface Smoothed {
  colors: SceneColors;
  speed: number;
  brightness: number;
  effects: Record<Effect, number>;
}

export class Visualizer {
  private ctx: CanvasRenderingContext2D;
  private effects = new Effects();
  private lyricsLayer = new LyricsLayer();
  private s: Smoothed | null = null;
  private w = 0;
  private h = 0;
  private lastNow = 0;
  private sceneTime = 0;
  private pulse = 0;
  private art: HTMLCanvasElement | null = null;
  private prevArt: HTMLCanvasElement | null = null;
  private artSince = 0;
  private lastIndex = -99;
  private indexChangedAt = 0;
  private title: { name: string; artist: string; shownAt: number } | null = null;

  showLyrics = true;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d", { alpha: false })!;
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(canvas);
    this.resize();
  }

  private resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    // Sharp on phones, but cap the pixel count so 4K screens stay smooth.
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    while (dpr > 1 && w * h * dpr * dpr > 4_500_000) dpr -= 0.25;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = w;
    this.h = h;
    this.effects.resize(w, h);
  }

  setArt(image: CanvasImageSource | null, now = performance.now()): void {
    this.prevArt = this.art;
    this.art = blurArt(image);
    this.artSince = now;
  }

  showTitle(name: string, artist: string, now = performance.now()): void {
    this.title = { name, artist, shownAt: now };
    this.lastIndex = -99;
  }

  frame(input: FrameInput): void {
    const { now, target } = input;
    const dt = this.lastNow ? Math.min((now - this.lastNow) / 1000, 0.1) : 1 / 60;
    this.lastNow = now;

    // Ease everything toward the target so changes feel like transitions, not cuts.
    if (!this.s) this.s = { ...target, colors: { ...target.colors }, effects: { ...target.effects } };
    const s = this.s;
    const kColor = 1 - Math.exp(-dt * 1.6);
    const kEffectUp = 1 - Math.exp(-dt * 3);
    const kEffectDown = 1 - Math.exp(-dt * 0.7); // effects linger after their line ends
    for (const key of Object.keys(s.colors) as (keyof SceneColors)[]) {
      s.colors[key] = mix(s.colors[key], target.colors[key], kColor) as RGB;
    }
    s.speed = lerp(s.speed, target.speed, 1 - Math.exp(-dt * 1.2));
    s.brightness = lerp(s.brightness, target.brightness * (1 + input.level * 0.25), kColor);
    for (const e of EFFECTS) {
      const goal = target.effects[e] ?? 0;
      s.effects[e] = lerp(s.effects[e], goal, goal > s.effects[e] ? kEffectUp : kEffectDown);
    }

    if (input.beat) {
      this.pulse = 1;
      this.effects.beat(0.6 + input.level * 0.6);
    }
    this.pulse *= Math.exp(-dt * 6);
    this.sceneTime += dt * s.speed;

    if (input.lineIndex !== this.lastIndex) {
      this.lastIndex = input.lineIndex;
      this.indexChangedAt = now;
    }

    this.effects.update(dt, s.speed, s.effects, s.colors);

    const ctx = this.ctx;
    drawBackground(ctx, this.w, this.h, {
      colors: s.colors,
      brightness: s.brightness,
      pulse: this.pulse,
      t: this.sceneTime * 6,
      art: this.art,
      prevArt: this.prevArt,
      artAlpha: Math.min(1, (now - this.artSince) / 1500),
    });
    this.effects.draw(ctx, s.effects, s.colors, now / 1000, s.brightness);

    if (this.showLyrics) {
      this.lyricsLayer.draw(ctx, this.w, this.h, {
        lines: input.lyrics,
        index: input.lineIndex,
        changedAt: this.indexChangedAt,
        now,
        color: s.colors.text,
        glow: s.colors.accent,
        pulse: this.pulse,
        title: this.title,
      });
    }
  }

  /** For tests and debugging: the current smoothed effect levels. */
  get effectLevels(): Record<Effect, number> {
    return this.s?.effects ?? noEffects();
  }
}
