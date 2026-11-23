import { describe, expect, it } from "vitest";
import { BeatDetector } from "../src/audio";

describe("BeatDetector", () => {
  it("finds a steady kick drum and ignores the quiet between hits", () => {
    const d = new BeatDetector();
    const beats: number[] = [];
    // 120 BPM = a kick every 500 ms; frames every ~16 ms.
    for (let t = 0; t < 4000; t += 16) {
      const energy = t % 500 < 48 ? 0.9 : 0.1;
      if (d.push(energy, t).beat) beats.push(t);
    }
    expect(beats.length).toBeGreaterThanOrEqual(7);
    expect(beats.length).toBeLessThanOrEqual(8);
    for (let i = 1; i < beats.length; i++) expect(beats[i] - beats[i - 1]).toBeGreaterThanOrEqual(450);
  });

  it("doesn't trigger on steady noise", () => {
    const d = new BeatDetector();
    let count = 0;
    for (let t = 0; t < 3000; t += 16) if (d.push(0.5, t).beat) count++;
    expect(count).toBe(0);
  });

  it("reports level between 0 and 1", () => {
    const d = new BeatDetector();
    const { level } = d.push(3, 0);
    expect(level).toBeLessThanOrEqual(1);
    expect(level).toBeGreaterThan(0);
  });
});

import { AutoGain, bandEnergy, FlashLimiter } from "../src/audio";

describe("FlashLimiter", () => {
  it("lets at most 3 flashes through per second", () => {
    const f = new FlashLimiter(3);
    let n = 0;
    for (let t = 0; t < 1000; t += 50) if (f.allow(t)) n++; // 20 beats in a second
    expect(n).toBe(3);
  });
});

describe("bandEnergy", () => {
  // 48 kHz / 2048 ≈ 23.4 Hz per bin
  const hz = 48000 / 2048;
  it("reads only the bins in the range", () => {
    const bins = new Uint8Array(1024);
    for (let i = 2; i <= 7; i++) bins[i] = 255; // ≈47–164 Hz
    expect(bandEnergy(bins, hz, 40, 160)).toBeGreaterThan(0.8);
    expect(bandEnergy(bins, hz, 4000, 12000)).toBe(0);
  });
  it("is 0 for silence and stays in range", () => {
    expect(bandEnergy(new Uint8Array(1024), hz, 400, 2000)).toBe(0);
    expect(bandEnergy(new Uint8Array(1024).fill(255), hz, 400, 2000)).toBe(1);
  });
});

describe("AutoGain", () => {
  it("scales quiet music up toward 1 and never passes 1", () => {
    const g = new AutoGain();
    let v = 0;
    for (let i = 0; i < 2000; i++) v = g.push(0.2);
    expect(v).toBeCloseTo(1, 1);
    expect(g.push(0.9)).toBe(1);
  });
});
