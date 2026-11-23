// Particles: ambient dust that's always there, plus one effect per lyric theme.
//   rain → falling streaks    fire → rising embers   night → twinkling stars
//   snow → drifting flakes    gold → sparkles        love → soft glowing orbs
//   city → neon light streaks nature → tumbling petals

import { css, mix, adjust, type RGB } from "../color";
import { EFFECTS, type Effect, type SceneColors } from "../scene";

interface P {
  kind: Effect | "dust";
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  life: number; // seconds lived
  max: number; // lifespan in seconds
  rot: number;
  vr: number;
  seed: number;
  color: RGB;
}

interface Ring {
  r: number;
  alpha: number;
}

/** New particles per second at full intensity (scaled by screen size). */
const RATE: Record<Effect, number> = {
  rain: 110,
  embers: 26,
  stars: 0, // stars are a fixed field, faded in and out
  snow: 32,
  sparkles: 14,
  glow: 1.6,
  streaks: 5,
  petals: 7,
};

const MAX_PARTICLES = 900;
const rand = (a: number, b: number) => a + Math.random() * (b - a);

export class Effects {
  private ps: P[] = [];
  private stars: { x: number; y: number; size: number; seed: number }[] = [];
  private rings: Ring[] = [];
  private spawnDebt: Record<Effect, number> = Object.fromEntries(EFFECTS.map((e) => [e, 0])) as Record<Effect, number>;
  private w = 1;
  private h = 1;

  resize(w: number, h: number): void {
    const first = this.w === 1;
    this.w = w;
    this.h = h;
    const area = (w * h) / (1280 * 800);
    this.stars = Array.from({ length: Math.round(160 * Math.min(area, 2)) }, () => ({
      x: Math.random() * w,
      y: Math.random() * h * 0.85,
      size: rand(0.5, 1.8),
      seed: Math.random() * 100,
    }));
    if (first) this.ps = []; // dust gets created in update()
  }

  beat(strength = 1, ring = true): void {
    if (ring) this.rings.push({ r: 0, alpha: 0.28 * strength });
    // Push the dust outward from the center.
    const cx = this.w / 2;
    const cy = this.h / 2;
    for (const p of this.ps) {
      if (p.kind !== "dust") continue;
      const dx = p.x - cx;
      const dy = p.y - cy;
      const d = Math.hypot(dx, dy) || 1;
      p.vx += (dx / d) * 60 * strength;
      p.vy += (dy / d) * 60 * strength;
    }
  }

  update(dt: number, speed: number, intensity: Record<Effect, number>, colors: SceneColors): void {
    const { w, h } = this;
    const area = Math.min((w * h) / (1280 * 800), 2.2);

    // Ambient dust count follows the screen size.
    const dustTarget = Math.round(110 * area);
    let dust = 0;
    for (const p of this.ps) if (p.kind === "dust") dust++;
    for (; dust < dustTarget; dust++) this.ps.push(this.make("dust", colors, true));

    // Spawn effect particles. "Debt" carries fractions between frames.
    for (const e of EFFECTS) {
      if (RATE[e] === 0) continue;
      this.spawnDebt[e] += RATE[e] * intensity[e] * area * dt * (e === "rain" ? 1 : 0.6 + speed * 0.4);
      while (this.spawnDebt[e] >= 1 && this.ps.length < MAX_PARTICLES) {
        this.ps.push(this.make(e, colors));
        this.spawnDebt[e] -= 1;
      }
      if (this.spawnDebt[e] > 5) this.spawnDebt[e] = 0; // don't burst after a pause
    }

    const motion = 0.35 + speed * 0.65;
    for (const p of this.ps) {
      p.life += dt;
      const m = p.kind === "rain" || p.kind === "streaks" ? 1 : motion;
      if (p.kind === "dust") {
        // Gentle drift + friction so beat pushes settle down.
        p.vx *= 1 - Math.min(1, dt * 1.5);
        p.vy *= 1 - Math.min(1, dt * 1.5);
        p.x += (p.vx + Math.sin(p.seed + p.life * 0.3) * 10 * motion) * dt;
        p.y += (p.vy - 6 * motion) * dt;
        if (p.x < -10) p.x = w + 10;
        if (p.x > w + 10) p.x = -10;
        if (p.y < -10) p.y = h + 10;
        if (p.y > h + 10) p.y = -10;
        continue;
      }
      if (p.kind === "embers" || p.kind === "snow" || p.kind === "petals") {
        p.x += (p.vx + Math.sin(p.seed + p.life * 1.3) * 18) * dt * m;
      } else {
        p.x += p.vx * dt * m;
      }
      p.y += p.vy * dt * m;
      p.rot += p.vr * dt * m;
    }

    // Drop particles that are dead or off-screen.
    this.ps = this.ps.filter(
      (p) => p.kind === "dust" || (p.life < p.max && p.y > -300 && p.y < h + 300 && p.x > -400 && p.x < w + 400),
    );

    for (const r of this.rings) {
      r.r += dt * Math.max(w, h) * 0.9;
      r.alpha *= 1 - Math.min(1, dt * 2.2);
    }
    this.rings = this.rings.filter((r) => r.alpha > 0.01);
  }

  draw(ctx: CanvasRenderingContext2D, intensity: Record<Effect, number>, colors: SceneColors, time: number, brightness: number, treble = 0): void {
    const { w, h } = this;

    // Stars: a fixed field that fades with intensity.
    if (intensity.stars > 0.01) {
      ctx.fillStyle = css([255, 255, 255]);
      for (const s of this.stars) {
        const tw = 0.55 + 0.45 * Math.sin(time * (1.2 + (s.seed % 1.7)) + s.seed);
        ctx.globalAlpha = intensity.stars * tw * 0.9;
        ctx.fillRect(s.x, s.y, s.size, s.size);
      }
      ctx.globalAlpha = 1;
    }

    ctx.globalCompositeOperation = "lighter";
    for (const p of this.ps) {
      const fadeIn = Math.min(1, p.life / 0.4);
      const fadeOut = p.kind === "dust" ? 1 : Math.min(1, (p.max - p.life) / 0.6);
      const a = Math.max(0, Math.min(fadeIn, fadeOut));
      switch (p.kind) {
        case "dust": {
          const tw = 0.5 + 0.5 * Math.sin(time * 0.8 + p.seed);
          // Dust follows the live palette so it recolors when the song changes.
          ctx.fillStyle = css(p.seed < 50 ? colors.blobA : colors.text, (0.12 + 0.25 * tw + treble * 0.35 * tw) * brightness);
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case "rain": {
          ctx.strokeStyle = css(p.color, 0.35 * a);
          ctx.lineWidth = p.size;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.vx * 0.025, p.y - p.vy * 0.025);
          ctx.stroke();
          break;
        }
        case "embers": {
          const flick = 0.7 + 0.3 * Math.sin(time * 9 + p.seed * 7);
          ctx.fillStyle = css(p.color, 0.18 * a * flick);
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * 3.2, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = css(mix(p.color, [255, 215, 140], 0.35), 0.9 * a * flick);
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case "snow": {
          ctx.fillStyle = css(p.color, 0.7 * a);
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case "sparkles": {
          const k = Math.sin((p.life / p.max) * Math.PI); // grow then shrink
          sparkle(ctx, p.x, p.y, p.size * k, p.rot, css(p.color, 0.9 * k));
          break;
        }
        case "glow": {
          const k = Math.sin((p.life / p.max) * Math.PI);
          const r = p.size * (0.85 + 0.15 * Math.sin(time * 2 + p.seed));
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
          g.addColorStop(0, css(p.color, 0.32 * k));
          g.addColorStop(1, css(p.color, 0));
          ctx.fillStyle = g;
          ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);
          break;
        }
        case "streaks": {
          const len = p.size;
          const dir = Math.sign(p.vx);
          const g = ctx.createLinearGradient(p.x, p.y, p.x - dir * len, p.y);
          g.addColorStop(0, css(p.color, 0.75 * a));
          g.addColorStop(1, css(p.color, 0));
          ctx.strokeStyle = g;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - dir * len, p.y);
          ctx.stroke();
          break;
        }
        case "petals": {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.scale(1, 0.55 + 0.45 * Math.sin(p.life * 3 + p.seed)); // flutter
          ctx.fillStyle = css(p.color, 0.6 * a);
          ctx.beginPath();
          ctx.ellipse(0, 0, p.size, p.size * 0.5, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
          break;
        }
        case "stars":
          break;
      }
    }

    // Beat rings.
    for (const r of this.rings) {
      ctx.strokeStyle = css(colors.accent, r.alpha);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, r.r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = "source-over";
  }

  private make(kind: P["kind"], c: SceneColors, anywhere = false): P {
    const { w, h } = this;
    const scale = Math.max(0.6, Math.min(w, h) / 800);
    const base: P = { kind, x: rand(0, w), y: rand(0, h), vx: 0, vy: 0, size: 2, life: 0, max: 5, rot: 0, vr: 0, seed: Math.random() * 100, color: c.accent };
    switch (kind) {
      case "dust":
        return { ...base, size: rand(0.6, 2.2) * scale, max: Infinity, y: anywhere ? rand(0, h) : h + 5 };
      case "rain":
        return { ...base, x: rand(-0.1 * w, 1.1 * w), y: rand(-60, -10), vx: -90, vy: rand(900, 1300) * (h / 900), size: rand(1, 1.8), max: 3, color: mix(c.text, c.blobB, 0.3) };
      case "embers":
        // Start in the lower part of the screen so a fire line shows embers right away.
        return { ...base, y: h - rand(-30, h * 0.45), vx: rand(-15, 15), vy: -rand(50, 130) * scale, size: rand(1.4, 3.2) * scale, max: rand(2.5, 5), color: mix([255, 110, 20], c.blobA, 0.2) };
      case "snow":
        return { ...base, y: rand(-30, -5), vx: rand(-10, 10), vy: rand(30, 75) * scale, size: rand(1.2, 3.8) * scale, max: 30, color: [240, 246, 255] };
      case "sparkles":
        return { ...base, size: rand(5, 12) * scale, max: rand(0.6, 1.4), rot: rand(0, Math.PI), vr: rand(-1, 1), color: mix(c.accent, [255, 215, 110], 0.6) };
      case "glow":
        return { ...base, size: rand(60, 170) * scale, max: rand(4, 7), vx: rand(-10, 10), vy: rand(-12, 4), color: mix(c.blobB, [255, 110, 160], 0.45) };
      case "streaks": {
        const right = Math.random() < 0.5;
        return { ...base, x: right ? -50 : w + 50, y: rand(h * 0.15, h * 0.9), vx: (right ? 1 : -1) * rand(600, 1100) * (w / 1280), size: rand(80, 240) * scale, max: 4, color: adjust(c.accent, { s: 1, l: 0.62 }) };
      }
      case "petals":
        return { ...base, x: rand(-0.2 * w, w), y: rand(-30, -5), vx: rand(20, 55), vy: rand(30, 70) * scale, size: rand(4, 8) * scale, max: 25, rot: rand(0, Math.PI * 2), vr: rand(-2, 2), color: mix(c.blobB, [255, 200, 215], 0.35) };
      case "stars":
        return base;
    }
  }
}

function sparkle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number, color: string): void {
  if (r <= 0.2) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const rr = i % 2 === 0 ? r : r * 0.22;
    ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
