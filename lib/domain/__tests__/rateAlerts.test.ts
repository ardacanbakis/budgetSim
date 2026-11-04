import { describe, expect, it } from "vitest";
import { alertRate, distancePct, isMet, newlyMet } from "../rateAlerts";

const table = {
  usdPer: { USD: 1, TRY: 1 / 40, EUR: 1.1, BTC: 100000, XAU_G: 100 },
  goldTry: { gram: 4000, ceyrek: 6400 },
};
const alert = (over: Partial<Parameters<typeof newlyMet>[0][number]> = {}) => ({
  fromUnit: "USD",
  toUnit: "TRY",
  direction: "above" as const,
  threshold: 42,
  triggeredAt: null as string | null,
  ...over,
});

describe("rate alerts", () => {
  it("read the pair's rate off the table, coins included", () => {
    expect(alertRate(alert(), table)).toBeCloseTo(40);
    expect(alertRate(alert({ fromUnit: "gold:ceyrek" }), table)).toBeCloseTo(6400);
    expect(alertRate(alert({ fromUnit: "GBP" }), table)).toBeNull();
  });

  it("are met at or past the threshold, in their direction", () => {
    expect(isMet(alert({ threshold: 40 }), 40)).toBe(true);
    expect(isMet(alert({ threshold: 42 }), 41.9)).toBe(false);
    expect(isMet(alert({ direction: "below", threshold: 40 }), 39.5)).toBe(true);
    expect(isMet(alert({ direction: "below", threshold: 40 }), 40.1)).toBe(false);
  });

  it("say how far the rate has to go", () => {
    expect(distancePct(alert({ threshold: 42 }), 40)).toBeCloseTo(5);
    expect(distancePct(alert({ direction: "below", threshold: 38 }), 40)).toBeCloseTo(5);
    expect(distancePct(alert({ threshold: 39 }), 40)).toBeLessThan(0);
  });

  it("fire once: only armed alerts the table meets are new", () => {
    const met = alert({ threshold: 39 });
    const fired = alert({ threshold: 39, triggeredAt: "2026-11-01T10:00:00Z" });
    const waiting = alert({ threshold: 45 });
    const result = newlyMet([met, fired, waiting], table);
    expect(result).toHaveLength(1);
    expect(result[0].alert).toBe(met);
    expect(result[0].rate).toBeCloseTo(40);
  });
});
