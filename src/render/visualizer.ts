// Owns the canvas: smooths the scene toward its target every frame and draws the layers.

import { FlashLimiter, SILENT, type Bands } from "../audio";
import { lerp, mix, type RGB } from "../color";
import type { LyricLine } from "../lyrics";
import { EFFECTS, noEffects, type Effect, type SceneColors, type SceneTarget } from "../scene";
import type { VisualStyle } from "../settings";
import { blurArt } from "./background";
import { FONTS, type FontSpec } from "../fonts";
import { drawIdle } from "./idle";
import { LYRICS_Y, STYLE_DRAW } from "./styles";
import { Effects } from "./effects";
import { LyricsLayer } from "./lyrics";

export interface FrameInput {
  now: number;
  target: SceneTarget;
  lyrics: LyricLine[] | null;
  lineIndex: number;
  beat: boolean;
  /** loudness 0..1 (0 when beat sync is off) */
  level: number;
  /** bass / mid / treble 0..1 (all 0 when beat sync is off) */
  bands?: Bands;
  /** heard tempo, for slow swells once per bar */
  tempo?: { bpm: number; lastBeatAt: number } | null;
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
  private wasChorus = false;
  private chorusAmt = 0;
  private bands: Bands = { ...SILENT };
  private flashes = new FlashLimiter(3);
  /** turns off rings and flashes (reduced motion) */
  allowFlashes = true;
  private art: HTMLCanvasElement | null = null;
  private prevArt: HTMLCanvasElement | null = null;
  private artSince = 0;
  private lastIndex = -99;
  private indexChangedAt = 0;
  private title: { name: string; artist: string; shownAt: number } | null = null;

  showLyrics = true;
  style: VisualStyle = "glow";
  /** show the screensaver (set by the app when nothing is playing) */
  idle = false;
  idleHint = "Play something on Spotify";
  private idleAmt = 0;
  private image: CanvasImageSource | null = null;
  /** lyric font (settings, or picked per song by Auto) */
  font: FontSpec = FONTS.modern;
  /** lyric size multiplier (settings) */
  lyricScale = 1;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d", { alpha: false })!;
    // Line breaks measured with a stand-in font are wrong once the real font arrives.
    document.fonts?.addEventListener("loadingdone", () => this.lyricsLayer.clearCache());
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
    this.image = image;
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

    // Bands ease quickly so they feel live but don't jitter.
    const kBand = 1 - Math.exp(-dt * 14);
    const b = input.bands ?? SILENT;
    this.bands = {
      bass: lerp(this.bands.bass, b.bass, kBand),
      mid: lerp(this.bands.mid, b.mid, kBand),
      treble: lerp(this.bands.treble, b.treble, kBand),
    };

    if (input.beat) {
      this.pulse = 1;
      // The gentle pulse follows every beat; rings (a visible flash) max 3 per second.
      const ring = this.allowFlashes && this.flashes.allow(now);
      this.effects.beat(0.6 + input.level * 0.6, ring);
    }
    this.pulse *= Math.exp(-dt * 6);

    // Chorus: a burst when it starts, and the lyrics grow a little while it lasts.
    if (target.chorus && !this.wasChorus) this.effects.burst(s.colors, this.allowFlashes);
    this.wasChorus = target.chorus;
    this.chorusAmt = lerp(this.chorusAmt, target.chorus ? 1 : 0, 1 - Math.exp(-dt * 3));
    this.sceneTime += dt * s.speed;

    if (input.lineIndex !== this.lastIndex) {
      this.lastIndex = input.lineIndex;
      this.indexChangedAt = now;
    }

    this.idleAmt = lerp(this.idleAmt, this.idle ? 1 : 0, 1 - Math.exp(-dt * 1.5));
    this.effects.update(dt, s.speed, s.effects, s.colors);

    const ctx = this.ctx;
    const style: VisualStyle = this.idle ? "aurora" : this.style;
    STYLE_DRAW[style](ctx, this.w, this.h, {
      colors: s.colors,
      brightness: s.brightness,
      pulse: this.pulse,
      bass: Math.min(1, this.bands.bass + this.barSwell(input, now) * 0.35),
      t: this.sceneTime * 6,
      art: this.art,
      prevArt: this.prevArt,
      artAlpha: Math.min(1, (now - this.artSince) / 1500),
      image: this.image,
      chorus: this.chorusAmt,
      speed: s.speed,
    });
    this.effects.draw(ctx, s.effects, s.colors, now / 1000, s.brightness * (1 + this.bands.mid * 0.25), this.bands.treble);

    drawIdle(ctx, this.w, this.h, now, s.colors.text, s.colors.accent, this.idleAmt, this.idleHint, this.font);

    if (this.showLyrics && !this.idle) {
      this.lyricsLayer.draw(ctx, this.w, this.h, {
        lines: input.lyrics,
        index: input.lineIndex,
        changedAt: this.indexChangedAt,
        now,
        color: s.colors.text,
        glow: s.colors.accent,
        pulse: this.pulse,
        chorus: this.chorusAmt,
        size: this.lyricScale * (style === "vinyl" ? 0.8 : 1),
        centerY: LYRICS_Y[style],
        font: this.font,
        title: this.title,
      });
    }
  }

  /** 0..1 swell that peaks once per bar (4 beats), lined up with the last heard beat. */
  private barSwell(input: FrameInput, now: number): number {
    const t = input.tempo;
    if (!t || !t.bpm || !this.allowFlashes) return 0;
    const bar = (60_000 / t.bpm) * 4;
    const phase = (((now - t.lastBeatAt) % bar) + bar) % bar / bar;
    return 0.5 + 0.5 * Math.cos(phase * Math.PI * 2);
  }

  /** For tests and debugging: the current smoothed effect levels. */
  get effectLevels(): Record<Effect, number> {
    return this.s?.effects ?? noEffects();
  }
}
