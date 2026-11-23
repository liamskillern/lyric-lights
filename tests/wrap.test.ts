import { describe, expect, it } from "vitest";
import { wrapText } from "../src/render/lyrics";

const measure = (s: string) => s.length * 10;

describe("wrapText", () => {
  it("wraps on word boundaries", () => {
    expect(wrapText("one two three four", 100, measure)).toEqual(["one two", "three four"]);
  });
  it("keeps a single long word on its own line", () => {
    expect(wrapText("supercalifragilistic yes", 50, measure)).toEqual(["supercalifragilistic", "yes"]);
  });
  it("returns nothing for empty text", () => {
    expect(wrapText("   ", 100, measure)).toEqual([]);
  });
});
