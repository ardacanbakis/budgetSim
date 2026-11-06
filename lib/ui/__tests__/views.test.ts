import { describe, expect, it } from "vitest";
import { defaultShape, defaultShapeKey, isShapeFor, SHAPES, SURFACES, SURFACE_SPECS } from "../views";

describe("surface shapes", () => {
  it("offers each screen only shapes that suit its data", () => {
    for (const id of SURFACES) {
      const spec = SURFACE_SPECS[id];
      expect(spec.shapes.length).toBeGreaterThan(0);
      for (const s of spec.shapes) expect(SHAPES).toContain(s);
      // the first is what the screen opens on before anyone chooses
      expect(defaultShape(id)).toBe(spec.shapes[0]);
    }
  });

  it("keeps the Cards lenses to the Cards screen", () => {
    for (const lens of ["matrix", "calendar", "payoff"] as const) {
      expect(isShapeFor("cards", lens)).toBe(true);
      for (const id of SURFACES) if (id !== "cards") expect(isShapeFor(id, lens)).toBe(false);
    }
  });

  it("rejects a stored shape a screen doesn't offer", () => {
    expect(isShapeFor("transactions", "grid")).toBe(false);
    expect(isShapeFor("cards", "nonsense")).toBe(false);
  });

  it("keeps the pinned default under a key of its own, so it can't be read as the last used", () => {
    for (const id of SURFACES) expect(defaultShapeKey(id)).not.toBe(`renovator-shape-${id}`);
    expect(defaultShapeKey("cards")).toBe("renovator-default-shape-cards");
  });
});
