import { describe, expect, it } from "vitest";
import { clockPosition, PAUSE_IDLE_MS, shouldIdle } from "../src/render/idle";

describe("shouldIdle", () => {
  it("never while music plays", () => expect(shouldIdle(true, true, 0, 1e9)).toBe(false));
  it("right away when nothing is loaded", () => expect(shouldIdle(false, false, 1000, 1000)).toBe(true));
  it("only after a while when paused", () => {
    expect(shouldIdle(true, false, 0, PAUSE_IDLE_MS - 1)).toBe(false);
    expect(shouldIdle(true, false, 0, PAUSE_IDLE_MS)).toBe(true);
  });
});

describe("clockPosition", () => {
  it("stays on screen and keeps moving", () => {
    const seen = new Set<string>();
    for (let t = 0; t < 3_600_000; t += 60_000) {
      const { x, y } = clockPosition(1920, 1080, t);
      expect(x).toBeGreaterThan(1920 * 0.3);
      expect(x).toBeLessThan(1920 * 0.7);
      expect(y).toBeGreaterThan(1080 * 0.3);
      expect(y).toBeLessThan(1080 * 0.6);
      seen.add(`${Math.round(x / 40)},${Math.round(y / 40)}`);
    }
    expect(seen.size).toBeGreaterThan(20); // not parked in one spot
  });
});
