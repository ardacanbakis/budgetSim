import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { defaultShape, isShapeFor, SURFACES, SURFACE_SPECS } from "../views";

/** Where each surface's screen lives, so the wiring can be checked. */
const PAGE: Record<string, string> = {
  accounts: "app/(app)/accounts/page.tsx",
  transactions: "app/(app)/transactions/page.tsx",
  cards: "app/(app)/cards/page.tsx",
  recurring: "app/(app)/recurring/page.tsx",
  loans: "app/(app)/loans/page.tsx",
};

describe("surface registry", () => {
  it("gives every surface at least two shapes, or it isn't a choice", () => {
    for (const id of SURFACES) {
      expect(SURFACE_SPECS[id].shapes.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("has no duplicate shapes within a surface", () => {
    for (const id of SURFACES) {
      const shapes = SURFACE_SPECS[id].shapes;
      expect(new Set(shapes).size).toBe(shapes.length);
    }
  });

  it("defaults to a shape it actually offers", () => {
    for (const id of SURFACES) {
      expect(isShapeFor(id, defaultShape(id))).toBe(true);
    }
  });

  it("only offers columns where a grid exists to put them in", () => {
    for (const id of SURFACES) {
      const spec = SURFACE_SPECS[id];
      if (spec.columns) expect(spec.shapes).toContain("grid");
    }
  });

  /**
   * The bug this exists to prevent: Settings renders a picker for every
   * registered surface, so registering one whose screen ignores the setting
   * ships a control that silently does nothing. Shipped exactly that once.
   */
  it("registers only surfaces whose screen reads the setting", () => {
    for (const id of SURFACES) {
      const path = PAGE[id];
      expect(path, `no page mapped for surface "${id}"`).toBeTruthy();
      const source = readFileSync(path, "utf8");
      expect(source, `${id} is registered but its page never calls useSurfaceView`).toContain(
        "useSurfaceView"
      );
      expect(source, `${id} reads the setting but never branches on shape`).toMatch(
        /view\.shape|shape ===/
      );
    }
  });

  it("puts a switcher on every screen that has a choice", () => {
    for (const id of SURFACES) {
      const source = readFileSync(PAGE[id], "utf8");
      expect(source, `${id} has no ViewSwitcher, so the choice is Settings-only`).toContain(
        "ViewSwitcher"
      );
    }
  });
});
