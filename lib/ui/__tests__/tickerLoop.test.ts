import { describe, expect, it } from "vitest";
import { coast, tickerCopies, wrapOffset } from "../tickerLoop";

describe("tickerCopies", () => {
  it("fills the width with whole sets, plus one sliding in", () => {
    // a 500px set on a 1440px screen: three to fill it, one more to slide in
    expect(tickerCopies(1440, 500)).toBe(4);
    expect(tickerCopies(1000, 500)).toBe(3);
  });

  it("never goes below two, and copes with nothing measured yet", () => {
    expect(tickerCopies(300, 900)).toBe(2);
    expect(tickerCopies(0, 500)).toBe(2);
    expect(tickerCopies(1440, 0)).toBe(2);
  });
});

describe("wrapOffset", () => {
  it("keeps the offset within one set, either way round", () => {
    expect(wrapOffset(120, 500)).toBe(120);
    expect(wrapOffset(620, 500)).toBe(120);
    expect(wrapOffset(-80, 500)).toBe(420);
    expect(wrapOffset(-1080, 500)).toBe(420);
  });

  it("is 0 without a set or a number", () => {
    expect(wrapOffset(50, 0)).toBe(0);
    expect(wrapOffset(Number.NaN, 500)).toBe(0);
  });
});

describe("coast", () => {
  it("slows a fling down, and stops it once too slow to see", () => {
    expect(coast(1000, 1)).toBeCloseTo(50, 6);
    expect(coast(-1000, 0.5)).toBeCloseTo(-1000 * Math.sqrt(0.05), 6);
    expect(coast(80, 1)).toBe(0);
  });
});
