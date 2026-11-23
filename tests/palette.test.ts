import { describe, expect, it } from "vitest";
import { buildPalette, pixelsFromImageData, quantize } from "../src/palette";
import { luminance, rgbToHsl, type RGB } from "../src/color";

function fill(color: RGB, n: number): RGB[] {
  return Array.from({ length: n }, () => [...color] as RGB);
}

describe("quantize", () => {
  it("separates distinct colors and orders by how common they are", () => {
    const px = [...fill([250, 20, 20], 300), ...fill([20, 20, 250], 100), ...fill([10, 10, 10], 600)];
    const out = quantize(px, 4);
    expect(out[0].color).toEqual([10, 10, 10]);
    const colors = out.map((s) => s.color.join(","));
    expect(colors).toContain("250,20,20");
    expect(colors).toContain("20,20,250");
    expect(out.reduce((n, s) => n + s.population, 0)).toBe(1000);
  });

  it("handles flat and empty images", () => {
    expect(quantize(fill([5, 5, 5], 50), 8)).toEqual([{ color: [5, 5, 5], population: 50 }]);
    expect(quantize([], 8)).toEqual([]);
  });
});

describe("buildPalette", () => {
  it("picks a saturated vibrant color and a dark background", () => {
    const p = buildPalette(quantize([...fill([240, 30, 120], 200), ...fill([30, 30, 40], 700), ...fill([30, 200, 220], 100)], 6));
    expect(rgbToHsl(p.vibrant).s).toBeGreaterThan(0.5);
    expect(luminance(p.dark)).toBeLessThan(0.03);
    expect(rgbToHsl(p.light).l).toBeGreaterThanOrEqual(0.8);
    // secondary should be a different hue from vibrant
    const dh = Math.abs(rgbToHsl(p.vibrant).h - rgbToHsl(p.secondary).h);
    expect(Math.min(dh, 360 - dh)).toBeGreaterThan(40);
  });

  it("gives black-and-white covers some color", () => {
    const p = buildPalette(quantize([...fill([0, 0, 0], 500), ...fill([255, 255, 255], 500)], 4));
    expect(p.vibrant).toBeDefined();
    expect(luminance(p.dark)).toBeLessThan(0.03);
  });
});

describe("pixelsFromImageData", () => {
  it("skips transparent pixels", () => {
    const data = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 0, 0, 0, 255, 200]);
    expect(pixelsFromImageData(data)).toEqual([
      [255, 0, 0],
      [0, 0, 255],
    ]);
  });
});
