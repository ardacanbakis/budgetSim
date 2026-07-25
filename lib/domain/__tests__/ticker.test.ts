import { describe, expect, it } from "vitest";
import { buildTickerItems, formatTickerValue } from "../ticker";
import { UsdPerMap } from "../fx";

const usdPer: UsdPerMap = { USD: 1, TRY: 1 / 41.8, EUR: 1.09, BTC: 104000, XAU_G: 78.5 };

describe("buildTickerItems", () => {
  it("quotes pairs the way they're spoken (USD/TRY, not TRY/USD)", () => {
    const items = buildTickerItems(usdPer);
    const byId = Object.fromEntries(items.map((i) => [i.id, i]));
    expect(byId.usdtry.value).toBeCloseTo(41.8, 6);
    expect(byId.eurtry.value).toBeCloseTo(1.09 * 41.8, 6);
    expect(byId.eurusd.value).toBeCloseTo(1.09, 6);
    expect(byId.btcusd.value).toBe(104000);
    expect(byId.goldtry.value).toBeCloseTo(78.5 * 41.8, 6);
  });

  it("moves the change with the quote, not with the underlying usdPer", () => {
    // lira weakens: 1 TRY is worth less in USD, so USD/TRY rises
    const prev: UsdPerMap = { ...usdPer, TRY: 1 / 40 };
    const items = buildTickerItems(usdPer, prev);
    const usdtry = items.find((i) => i.id === "usdtry")!;
    expect(usdtry.value).toBeCloseTo(41.8, 6);
    expect(usdtry.changePct).toBeCloseTo(((41.8 - 40) / 40) * 100, 6);
    expect(usdtry.changePct!).toBeGreaterThan(0);
  });

  it("omits pairs whose rate is unavailable and yields null change without history", () => {
    const noGold: UsdPerMap = { ...usdPer, XAU_G: null };
    const items = buildTickerItems(noGold);
    expect(items.map((i) => i.id)).not.toContain("goldtry");
    expect(items.every((i) => i.changePct === null)).toBe(true);
  });

  it("picks precision by magnitude", () => {
    const items = buildTickerItems(usdPer);
    const byId = Object.fromEntries(items.map((i) => [i.id, i]));
    expect(byId.btcusd.decimals).toBe(0);
    expect(byId.eurusd.decimals).toBe(2);
    expect(formatTickerValue(byId.btcusd, "en")).toBe("104,000");
    expect(formatTickerValue(byId.eurusd, "en")).toBe("1.09");
  });
});
