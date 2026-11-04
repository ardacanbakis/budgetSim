import { describe, expect, it } from "vitest";
import { convertOn, pairSeries, parseCoinGeckoSeries, parseFrankfurterSeries, summarize } from "../rateHistory";

describe("parsing the sources", () => {
  it("turns Frankfurter's units per dollar into dollars per unit, oldest first", () => {
    const series = parseFrankfurterSeries({
      base: "USD",
      rates: { "2026-10-02": { TRY: 40, EUR: 0.8 }, "2026-10-01": { TRY: 50, EUR: "x" } },
    });
    expect(series.TRY).toEqual([
      ["2026-10-01", 1 / 50],
      ["2026-10-02", 1 / 40],
    ]);
    expect(series.EUR).toEqual([["2026-10-02", 1.25]]);
    expect(parseFrankfurterSeries(null)).toEqual({});
  });

  it("keeps CoinGecko's last price of each UTC day", () => {
    const day = Date.UTC(2026, 9, 1);
    expect(
      parseCoinGeckoSeries({
        prices: [
          [day + 1000, 100],
          [day + 3600_000, 110],
          [day + 86_400_000, 120],
          ["bad", 1],
        ],
      })
    ).toEqual([
      ["2026-10-01", 110],
      ["2026-10-02", 120],
    ]);
    expect(parseCoinGeckoSeries({})).toEqual([]);
  });
});

describe("a pair's history", () => {
  const history = {
    series: {
      TRY: [
        ["2026-10-01", 1 / 40],
        ["2026-10-02", 1 / 41],
        ["2026-10-05", 1 / 42],
      ] as [string, number][],
      EUR: [
        ["2026-10-01", 1.1],
        ["2026-10-05", 1.05],
      ] as [string, number][],
      BTC: [
        ["2026-10-01", 100000],
        ["2026-10-03", 90000],
        ["2026-10-05", 95000],
      ] as [string, number][],
    },
  };

  it("divides one side by the other, on the dates both have", () => {
    expect(pairSeries(history, "USD", "TRY").map((p) => [p.date, Math.round(p.rate)])).toEqual([
      ["2026-10-01", 40],
      ["2026-10-02", 41],
      ["2026-10-05", 42],
    ]);
    expect(pairSeries(history, "EUR", "TRY").map((p) => p.date)).toEqual(["2026-10-01", "2026-10-05"]);
    expect(pairSeries(history, "EUR", "TRY")[1].rate).toBeCloseTo(44.1);
    // bitcoin trades on the weekend; against the dollar every day it has counts
    expect(pairSeries(history, "BTC", "USD").map((p) => p.rate)).toEqual([100000, 90000, 95000]);
    expect(pairSeries(history, "USD", "USD")).toEqual([]);
    expect(pairSeries({ series: {} }, "USD", "TRY")).toEqual([]);
  });

  it("sums up the range: first, last, low, high and the change", () => {
    const s = summarize(pairSeries(history, "BTC", "USD"))!;
    expect(s.low.date).toBe("2026-10-03");
    expect(s.high.rate).toBe(100000);
    expect(s.changePct).toBeCloseTo(-5);
    expect(summarize([])).toBeNull();
  });

  it("converts an amount at one date's rates", () => {
    const on = { date: "2025-03-14", usdPer: { TRY: 1 / 36.6, EUR: 1.09 } };
    expect(convertOn(1000, "USD", "TRY", on)).toBeCloseTo(36600);
    expect(convertOn(100, "EUR", "USD", on)).toBeCloseTo(109);
    expect(convertOn(1, "BTC", "USD", on)).toBeNull();
  });
});
