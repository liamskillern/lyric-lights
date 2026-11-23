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
