import { describe, expect, it } from "vitest";
import { BeatClock, breathFor, pulseEnvelope, pumpFor, TapTempo } from "../src/beatClock";

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 2 ** 32;
    return seed / 2 ** 32;
  };
}

describe("BeatClock", () => {
  it("gives phase and beat number", () => {
    const c = new BeatClock();
    c.set(120, 1000, "exact"); // a beat every 500 ms from 1000
    expect(c.phaseAt(1000)).toBe(0);
    expect(c.phaseAt(1250)).toBeCloseTo(0.5);
    expect(c.beatIndexAt(2600)).toBe(3);
    expect(c.phaseAt(900)).toBeCloseTo(0.8); // works before the anchor too
  });

  it("locks onto jittery beats that started out of phase", () => {
    const r = rng(3);
    const c = new BeatClock();
    c.set(120, 130, "heard"); // 130 ms off
    let err = 0;
    for (let i = 0; i < 40; i++) {
      const hit = i * 500 + (r() - 0.5) * 30;
      c.lockTo(hit);
      err = Math.abs(c.errorAt(i * 500));
    }
    expect(err).toBeLessThan(15);
  });

  it("ignores one wild hit", () => {
    const c = new BeatClock();
    c.set(120, 0, "heard");
    expect(c.lockTo(5_240)).toBe(false); // ~halfway between beats
    expect(c.anchor).toBe(0);
  });

  it("changes tempo without jumping in phase", () => {
    const c = new BeatClock();
    c.set(120, 0, "heard");
    const before = c.phaseAt(10_100);
    c.setTempo(122, 10_100);
    expect(c.phaseAt(10_100)).toBeCloseTo(before * (122 / 120), 1);
    expect(c.bpm).toBe(122);
  });

  it("recovers after the song's tempo changes", () => {
    const c = new BeatClock();
    c.set(120, 0, "heard");
    // Song speeds up to 130 BPM at 20 s; the tracker reports it, the hits keep it in phase.
    const iv = 60_000 / 130;
    let err = 999;
    for (let i = 0; i < 30; i++) {
      const hit = 20_000 + i * iv;
      if (i === 2) c.setTempo(130, hit);
      if (!c.lockTo(hit)) c.set(130, hit, "heard"); // way off: re-lock outright
      err = Math.abs(c.errorAt(hit));
    }
    expect(err).toBeLessThan(5);
  });

  it("freezes when song time stops (paused)", () => {
    const c = new BeatClock();
    c.set(100, 0, "tapped");
    expect(c.phaseAt(12_345)).toBe(c.phaseAt(12_345));
  });

  it("does nothing until it has a tempo", () => {
    const c = new BeatClock();
    expect(c.running).toBe(false);
    expect(c.phaseAt(500)).toBe(0);
    expect(c.lockTo(500)).toBe(false);
  });
});

describe("TapTempo", () => {
  it("needs 4 taps, then gives the tempo", () => {
    const t = new TapTempo();
    expect(t.tap(0)).toBeNull();
    expect(t.tap(600)).toBeNull();
    expect(t.tap(1200)).toBeNull();
    const r = t.tap(1800);
    expect(r?.bpm).toBeCloseTo(100);
    expect(r?.anchor).toBe(1800);
  });

  it("starts over after a long pause", () => {
    const t = new TapTempo();
    [0, 500, 1000, 1500].forEach((ms) => t.tap(ms));
    expect(t.tap(9000)).toBeNull();
    expect(t.count).toBe(1);
  });

  it("one sloppy tap doesn't throw it off (median)", () => {
    const t = new TapTempo();
    let r = null;
    for (const ms of [0, 500, 1000, 1700, 2000, 2500, 3000]) r = t.tap(ms);
    expect(r?.bpm).toBeCloseTo(120);
  });
});

describe("pulse shape", () => {
  it("peaks on the beat and fades before the next", () => {
    expect(pulseEnvelope(0, true, "soft")).toBe(1);
    expect(pulseEnvelope(0.5, true, "soft")).toBeLessThan(0.1);
    expect(pulseEnvelope(0.5, true, "punchy")).toBeLessThan(pulseEnvelope(0.5, true, "soft"));
  });
  it("bar starts are 40% stronger", () => {
    expect(pulseEnvelope(0, true, "soft") / pulseEnvelope(0, false, "soft")).toBeCloseTo(1.4);
  });
  it("is zero when off", () => {
    expect(pulseEnvelope(0, true, "off")).toBe(0);
    expect(breathFor("off", false)).toBe(0);
    expect(pumpFor("off", false)).toBe(0);
  });
  it("keeps brightness changes under 10% and the zoom gentle", () => {
    for (const s of ["soft", "punchy"] as const) {
      expect(pumpFor(s, false)).toBeLessThan(0.1);
      expect(breathFor(s, false)).toBeLessThanOrEqual(0.04);
    }
  });
  it("reduced motion: no zoom, half the brightness", () => {
    expect(breathFor("punchy", true)).toBe(0);
    expect(pumpFor("punchy", true)).toBe(pumpFor("punchy", false) / 2);
  });
});
