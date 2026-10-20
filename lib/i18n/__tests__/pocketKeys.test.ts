import { describe, expect, it } from "vitest";
import { en, tr } from "../dictionaries";
import * as core from "../pocket/core";

const PACKAGES = ["add", "lists", "home", "activity", "timeline", "portfolio", "cards", "desk"] as const;

describe("Pocket strings", () => {
  it("never let a package's namespace replace a core key", () => {
    for (const name of PACKAGES) expect(Object.keys(core.en)).not.toContain(name);
  });

  it("keep every core key reachable as a string in both languages", () => {
    for (const [key, value] of Object.entries(core.en)) {
      expect((en.pocket as Record<string, unknown>)[key]).toBe(value);
      expect(typeof (tr.pocket as Record<string, unknown>)[key]).toBe("string");
    }
  });

  it("give each package its own namespace, with the same keys in both languages", () => {
    for (const name of PACKAGES) {
      expect(typeof en.pocket[name]).toBe("object");
      expect(Object.keys(tr.pocket[name])).toEqual(Object.keys(en.pocket[name]));
    }
  });
});
