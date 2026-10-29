import { describe, expect, it } from "vitest";
import { initialFold } from "../monthFold";

const groups = [
  ["2027", [{ month: "2027-02" }, { month: "2027-01" }]],
  ["2026", [{ month: "2026-12" }, { month: "2026-11" }, { month: "2026-10" }, { month: "2026-09" }]],
  ["2025", [{ month: "2025-12" }]],
] as const;

describe("initialFold", () => {
  it("folds what's ahead, months and years, and leaves now and what's behind open", () => {
    expect([...initialFold(groups, "2026-10", false)].sort()).toEqual(["2026-11", "2026-12", "2027", "2027-01", "2027-02"]);
  });

  it("folds earlier years too when history collapses", () => {
    expect(initialFold(groups, "2026-10", true).has("2025")).toBe(true);
    expect(initialFold(groups, "2026-10", true).has("2026-09")).toBe(false);
  });
});
