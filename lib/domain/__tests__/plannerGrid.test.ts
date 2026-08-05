import { describe, expect, it } from "vitest";
import { resolveCollisions, type CardBox } from "@/components/plannerGrid";

const box = (x: number, y: number, w: number, h: number): CardBox => ({ x, y, w, h });

describe("free placement", () => {
  it("leaves a canvas alone when nothing overlaps", () => {
    const boxes = { a: box(0, 0, 2, 2), b: box(2, 0, 2, 2) };
    expect(resolveCollisions(boxes, "a")).toEqual(boxes);
  });

  it("keeps the gaps you deliberately left", () => {
    // b sits three rows down with empty space above it; nothing pulls it up
    const boxes = { a: box(0, 0, 2, 1), b: box(0, 4, 2, 1) };
    expect(resolveCollisions(boxes, "a").b).toEqual(box(0, 4, 2, 1));
  });

  it("pushes what's in the way far enough down to clear the card you moved", () => {
    const boxes = { moved: box(0, 0, 2, 3), other: box(1, 1, 2, 2) };
    expect(resolveCollisions(boxes, "moved").other).toEqual(box(1, 3, 2, 2));
  });

  it("cascades a push through everything it lands on", () => {
    const boxes = { moved: box(0, 0, 4, 2), a: box(0, 1, 2, 2), b: box(0, 3, 2, 2) };
    const next = resolveCollisions(boxes, "moved");
    expect(next.a).toEqual(box(0, 2, 2, 2));
    expect(next.b).toEqual(box(0, 4, 2, 2));
  });

  it("doesn't disturb a card beside the one it pushed", () => {
    const boxes = { moved: box(0, 0, 2, 3), below: box(0, 1, 2, 1), beside: box(2, 0, 2, 4) };
    const next = resolveCollisions(boxes, "moved");
    expect(next.below).toEqual(box(0, 3, 2, 1));
    expect(next.beside).toEqual(box(2, 0, 2, 4));
  });
});
