import { describe, expect, it } from "vitest";
import { annualLossPct, planRate, projectTryPerUsd, windowAverages, yearByYear } from "../liraDevaluation";

const history = {
  points: [
    { yearsAgo: 0, date: "2026-11-04", tryPerUsd: 40 },
    { yearsAgo: 1, date: "2025-11-04", tryPerUsd: 32 },
    { yearsAgo: 2, date: "2024-11-04", tryPerUsd: 25 },
    { yearsAgo: 3, date: "2023-11-03", tryPerUsd: 20 },
    { yearsAgo: 5, date: "2021-11-04", tryPerUsd: 10 },
  ],
};

describe("annualLossPct", () => {
  it("is the yearly share of its dollar value the lira loses, compounding", () => {
    expect(annualLossPct(32, 40, 1)).toBeCloseTo(20);
    // 20 → 40 in two years: half kept, 1 − √0.5 a year
    expect(annualLossPct(20, 40, 2)).toBeCloseTo(29.29, 1);
    // a stronger lira is a negative loss
    expect(annualLossPct(40, 32, 1)).toBeCloseTo(-25);
    expect(annualLossPct(0, 40, 1)).toBeNull();
  });
});

describe("windowAverages", () => {
  it("averages over each window it has both ends of", () => {
    const avg = windowAverages(history);
    expect(avg.map((a) => a.years)).toEqual([1, 3, 5]);
    expect(avg[0].pct).toBeCloseTo(20);
    // 20 → 40 over three years
    expect(avg[1].pct).toBeCloseTo((1 - Math.pow(0.5, 1 / 3)) * 100);
    // 10 → 40 over five
    expect(avg[2].pct).toBeCloseTo((1 - Math.pow(0.25, 1 / 5)) * 100);
    expect(windowAverages({ points: history.points.filter((p) => p.yearsAgo !== 0) })).toEqual([]);
    // a malformed answer is no history, not a crash
    expect(windowAverages({} as never)).toEqual([]);
    expect(yearByYear({ points: null } as never)).toEqual([]);
  });

  it("matches the Plan's own model: the average, compounded, lands on today's rate", () => {
    const [, three] = windowAverages(history);
    expect(projectTryPerUsd(three.from.tryPerUsd, three.pct, 3)).toBeCloseTo(40);
  });
});

describe("yearByYear", () => {
  it("goes back one year at a time until a year is missing", () => {
    const years = yearByYear(history);
    expect(years.map((y) => [y.from.date, y.to.date])).toEqual([
      ["2025-11-04", "2026-11-04"],
      ["2024-11-04", "2025-11-04"],
      ["2023-11-03", "2024-11-04"],
    ]);
    expect(years[0].pct).toBeCloseTo(20);
  });
});

describe("projections and the plan's slider", () => {
  it("project the rate forward at a pace", () => {
    expect(projectTryPerUsd(40, 20, 1)).toBeCloseTo(50);
    expect(projectTryPerUsd(40, 0, 3)).toBe(40);
    expect(projectTryPerUsd(40, 100, 1)).toBeNull();
  });

  it("round to a whole percent within 1–60", () => {
    expect(planRate(20.6)).toBe(21);
    expect(planRate(-3)).toBe(1);
    expect(planRate(75)).toBe(60);
  });
});
