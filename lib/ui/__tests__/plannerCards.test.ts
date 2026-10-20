import { describe, expect, it } from "vitest";
import {
  CARD_HEIGHTS,
  CARD_SIZES,
  CARD_WIDTHS,
  cardHeightPx,
  heightFor,
  normalizeBoxes,
  packBoxes,
  readingRows,
  rowHeightPx,
  rowsToPx,
  snapHeight,
  snapWidth,
  stepHeight,
  stepWidth,
} from "../plannerCards";

describe("the row unit", () => {
  it("counts the gaps between rows", () => {
    expect(rowsToPx(1)).toBe(128);
    expect(rowsToPx(2)).toBe(272);
    expect(rowsToPx(4)).toBe(560);
    expect(cardHeightPx("M")).toBe(416);
  });

  it("gives every preset an allowed width and height", () => {
    for (const { w, h } of Object.values(CARD_SIZES)) {
      expect(CARD_WIDTHS).toContain(w);
      expect(CARD_HEIGHTS).toContain(h);
    }
  });
});

describe("snapping a size onto the presets", () => {
  it("takes the nearest width that fits, the narrower on a tie", () => {
    expect(snapWidth(1)).toBe(1);
    expect(snapWidth(3)).toBe(2);
    expect(snapWidth(4)).toBe(4);
    expect(snapWidth(9)).toBe(4);
    // from the third column only two fit; from the last, one
    expect(snapWidth(4, 2)).toBe(2);
    expect(snapWidth(2, 3)).toBe(1);
  });

  it("takes the nearest height, the taller on a tie", () => {
    expect(snapHeight(1)).toBe(1);
    expect(snapHeight(3)).toBe(3);
    expect(snapHeight(5)).toBe(6);
    expect(snapHeight(7)).toBe(6);
    expect(snapHeight(16)).toBe(6);
  });

  it("fits content to the smallest height that holds it", () => {
    expect(heightFor(100)).toBe(1);
    expect(heightFor(272)).toBe(2);
    expect(heightFor(273)).toBe(3);
    expect(heightFor(5000)).toBe(6);
  });

  it("steps through the allowed sizes, and stops at the edges", () => {
    expect(stepWidth(2, -1)).toBe(1);
    expect(stepWidth(1, -1)).toBe(1);
    expect(stepWidth(2, 1)).toBe(4);
    expect(stepWidth(2, 1, 2)).toBe(2); // four columns don't fit from the third
    expect(stepHeight(4, 1)).toBe(6);
    expect(stepHeight(6, 1)).toBe(6);
    expect(stepHeight(2, -1)).toBe(1);
    expect(stepHeight(1, -1)).toBe(1);
  });
});

describe("normalizeBoxes: a canvas saved before the presets", () => {
  it("maps every old size onto a preset size", () => {
    const boxes = normalizeBoxes({
      tiles: { x: 0, y: 0, w: 4, h: 1 },
      chart: { x: 0, y: 1, w: 2, h: 4 },
      projections: { x: 2, y: 1, w: 2, h: 5 },
      sales: { x: 0, y: 6, w: 3, h: 7 },
    });
    expect(boxes.tiles).toEqual({ x: 0, y: 0, w: 4, h: 1 });
    expect(boxes.chart).toEqual({ x: 0, y: 1, w: 2, h: 4 });
    expect(boxes.projections).toEqual({ x: 2, y: 1, w: 2, h: 6 });
    expect(boxes.sales).toEqual({ x: 0, y: 6, w: 2, h: 6 }); // three columns become two, clear of the projections
  });

  it("moves down only what a taller card now overlaps, and keeps the gaps", () => {
    const boxes = normalizeBoxes({
      a: { x: 0, y: 0, w: 2, h: 5 }, // becomes 6 tall
      b: { x: 0, y: 5, w: 2, h: 2 }, // sat right under it
      c: { x: 2, y: 9, w: 2, h: 2 }, // a gap above it, nothing over it
    });
    expect(boxes.a).toEqual({ x: 0, y: 0, w: 2, h: 6 });
    expect(boxes.b).toEqual({ x: 0, y: 6, w: 2, h: 2 });
    expect(boxes.c).toEqual({ x: 2, y: 9, w: 2, h: 2 });
  });

  it("keeps a card inside the canvas", () => {
    expect(normalizeBoxes({ a: { x: 3, y: 0, w: 4, h: 3 } }).a).toEqual({ x: 3, y: 0, w: 1, h: 3 });
    expect(normalizeBoxes({ a: { x: 7, y: -2, w: 2, h: 3 } }).a).toEqual({ x: 3, y: 0, w: 1, h: 3 });
  });

  it("drops what isn't a box, so the card is placed again below", () => {
    const boxes = normalizeBoxes({ a: null, b: "x", c: { x: 0, y: 0, w: "wide", h: 3 } } as Record<string, unknown>);
    expect(Object.keys(boxes)).toEqual(["c"]);
    expect(boxes.c).toEqual({ x: 0, y: 0, w: 2, h: 3 });
  });

  it("leaves a canvas already on the presets as it was", () => {
    const fresh = packBoxes([
      { id: "tiles", size: "strip" },
      { id: "chart", size: "L" },
      { id: "projections", size: "L" },
      { id: "dev", size: "S" },
      { id: "lost", size: "S" },
      { id: "items", size: "M" },
    ]);
    expect(normalizeBoxes(fresh as Record<string, unknown>)).toEqual(fresh);
  });
});

describe("packBoxes", () => {
  it("packs cards across the canvas at their preset sizes", () => {
    expect(
      packBoxes([
        { id: "tiles", size: "strip" },
        { id: "chart", size: "L" },
        { id: "projections", size: "L" },
        { id: "dev", size: "S" },
        { id: "lost", size: "S" },
        { id: "milestones", size: "S" },
        { id: "savings", size: "S" },
        { id: "items", size: "M" },
      ])
    ).toEqual({
      tiles: { x: 0, y: 0, w: 4, h: 1 },
      chart: { x: 0, y: 1, w: 2, h: 4 },
      projections: { x: 2, y: 1, w: 2, h: 4 },
      dev: { x: 0, y: 5, w: 1, h: 2 },
      lost: { x: 1, y: 5, w: 1, h: 2 },
      milestones: { x: 2, y: 5, w: 1, h: 2 },
      savings: { x: 3, y: 5, w: 1, h: 2 },
      items: { x: 0, y: 7, w: 2, h: 3 },
    });
  });
});

describe("readingRows: the two-column layout", () => {
  it("pairs each card with the next one of its height", () => {
    expect(
      readingRows([
        { id: "tiles", size: "strip" },
        { id: "chart", size: "L" },
        { id: "dev", size: "S" },
        { id: "projections", size: "L" },
        { id: "lost", size: "S" },
      ])
    ).toEqual([["tiles"], ["chart", "projections"], ["dev", "lost"]]);
  });

  it("leaves a card alone when nothing its height is left", () => {
    expect(
      readingRows([
        { id: "a", size: "M" },
        { id: "b", size: "M" },
        { id: "c", size: "M" },
        { id: "d", size: "L" },
        { id: "e", size: "L" },
      ])
    ).toEqual([["a", "b"], ["c"], ["d", "e"]]);
  });

  it("gives a row its tallest card's height", () => {
    expect(rowHeightPx(["S", "S"])).toBe(272);
    expect(rowHeightPx(["M", "L"])).toBe(560);
  });
});
