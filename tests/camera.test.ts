import { describe, expect, it } from "vitest";
import { CAMERA_CAP, overscan, SpringCamera } from "../src/render/camera";

function run(c: SpringCamera, seconds: number, track?: (c: SpringCamera) => void) {
  for (let t = 0; t < seconds; t += 1 / 60) {
    c.update(1 / 60);
    track?.(c);
  }
}

describe("SpringCamera", () => {
  it("a kick punches in a few percent, then springs back to center", () => {
    const c = new SpringCamera();
    c.kick(1);
    let peak = 0;
    run(c, 0.3, (cc) => (peak = Math.max(peak, cc.pos.zoom)));
    expect(peak).toBeGreaterThan(0.015);
    expect(peak).toBeLessThanOrEqual(CAMERA_CAP.zoom);
    run(c, 2);
    expect(Math.abs(c.pos.zoom)).toBeLessThan(0.001);
    expect(Math.abs(c.pos.y)).toBeLessThan(0.001);
  });

  it("bounces a little past center (it rides the beat, not just snaps back)", () => {
    const c = new SpringCamera();
    c.kick(1);
    let min = 0;
    run(c, 1, (cc) => (min = Math.min(min, cc.pos.zoom)));
    expect(min).toBeLessThan(0);
  });

  it("turns the push direction each kick: down, left, up, right", () => {
    const dirs: string[] = [];
    const c = new SpringCamera();
    for (let i = 0; i < 4; i++) {
      c.reset();
      // Same camera instance keeps its kick count across resets of position.
      c.kick(1);
      run(c, 0.08);
      dirs.push(Math.abs(c.pos.x) > Math.abs(c.pos.y) ? (c.pos.x > 0 ? "right" : "left") : c.pos.y > 0 ? "down" : "up");
    }
    expect(dirs).toEqual(["down", "left", "up", "right"]);
  });

  it("snares shake sideways and alternate sides", () => {
    const c = new SpringCamera();
    c.snare(1);
    run(c, 0.08);
    const first = Math.sign(c.pos.x);
    c.reset();
    c.snare(1);
    run(c, 0.08);
    expect(Math.sign(c.pos.x)).toBe(-first);
    expect(c.pos.rot).not.toBe(0);
  });

  it("never passes the caps, even with a pile of strong hits", () => {
    const c = new SpringCamera();
    c.strength = 1.8;
    let worst = { shift: 0, zoom: 0, rot: 0 };
    for (let i = 0; i < 40; i++) {
      c.kick(1, 1.5);
      c.snare(1, 1.5);
      run(c, 0.05, (cc) => {
        worst = {
          shift: Math.max(worst.shift, Math.abs(cc.pos.x), Math.abs(cc.pos.y)),
          zoom: Math.max(worst.zoom, cc.pos.zoom),
          rot: Math.max(worst.rot, Math.abs(cc.pos.rot)),
        };
      });
    }
    expect(worst.shift).toBeLessThanOrEqual(CAMERA_CAP.shift);
    expect(worst.zoom).toBeLessThanOrEqual(CAMERA_CAP.zoom);
    expect(worst.rot).toBeLessThanOrEqual(CAMERA_CAP.rot);
  });

  it("does nothing when turned off", () => {
    const c = new SpringCamera();
    c.strength = 0;
    c.kick(1);
    c.snare(1);
    run(c, 0.2);
    expect(c.pos).toEqual({ x: 0, y: 0, zoom: 0, rot: 0 });
  });
});

describe("overscan", () => {
  it("is 1 (plus a hair) at rest and grows with shift and tilt", () => {
    expect(overscan({ x: 0, y: 0, zoom: 0, rot: 0 }, 1280, 800)).toBeCloseTo(1.005);
    expect(overscan({ x: 0.04, y: 0, zoom: 0, rot: 0 }, 1280, 800)).toBeGreaterThan(1.04);
    expect(overscan({ x: 0, y: 0, zoom: 0, rot: 0.03 }, 1280, 800)).toBeGreaterThan(1.04);
  });
});
