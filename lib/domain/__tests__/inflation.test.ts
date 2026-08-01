import { describe, expect, it } from "vitest";
import { deflateTryToLatest, latestCpiMonth, TUIK_CPI_INDEX } from "@/lib/data/inflation";

describe("inflation deflator", () => {
  it("deflates older lira into latest-month lira", () => {
    const latest = latestCpiMonth();
    expect(deflateTryToLatest(1000, latest)).toBe(1000);
    const older = deflateTryToLatest(1000, "2024-06");
    expect(older).toBeCloseTo(1000 * (TUIK_CPI_INDEX[latest] / TUIK_CPI_INDEX["2024-06"]), 6);
    expect(older).toBeGreaterThan(1500); // that much inflation happened
  });

  it("clamps months outside the series", () => {
    expect(deflateTryToLatest(100, "2020-01")).toBe(deflateTryToLatest(100, "2024-01"));
    expect(deflateTryToLatest(100, "2030-01")).toBe(100);
  });
});
