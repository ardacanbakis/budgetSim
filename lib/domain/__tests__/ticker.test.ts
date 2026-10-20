import { describe, expect, it } from "vitest";
import { buildTickerItems, currencyQuotes, formatTickerValue } from "../ticker";
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

describe("currencyQuotes", () => {
  it("quotes every currency, the lira in dollars and the rest as the ticker does", () => {
    const quotes = currencyQuotes(usdPer);
    expect(Object.keys(quotes).sort()).toEqual(["BTC", "EUR", "TRY", "USD", "XAU_G"]);
    expect(quotes.TRY!.label).toBe("TRY/USD");
    expect(quotes.TRY!.value).toBeCloseTo(1 / 41.8, 8);
    expect(quotes.TRY!.decimals).toBe(4);
    expect(quotes.USD!.value).toBeCloseTo(41.8, 6);
    expect(quotes.EUR!.label).toBe("EUR/TRY");
    expect(quotes.BTC!.label).toBe("BTC/USD");
    expect(quotes.XAU_G!.value).toBeCloseTo(78.5 * 41.8, 6);
  });

  it("gives a change only where both legs have history, inventing none for USD or gold", () => {
    // what the providers supply: TRY, EUR and BTC a day back, never USD or gold
    const prev = { TRY: 1 / 40, EUR: 1.08, BTC: 100000 };
    const quotes = currencyQuotes(usdPer, prev);
    expect(quotes.EUR!.changePct).toBeCloseTo(((1.09 * 41.8 - 1.08 * 40) / (1.08 * 40)) * 100, 6);
    // every other pair has a USD or gold leg, which has no history
    expect(quotes.TRY!.changePct).toBeNull();
    expect(quotes.USD!.changePct).toBeNull();
    expect(quotes.BTC!.changePct).toBeNull();
    expect(quotes.XAU_G!.changePct).toBeNull();
    // given that history, the lira's own quote moves against it
    const lira = currencyQuotes(usdPer, { ...prev, USD: 1 }).TRY!;
    expect(lira.changePct).toBeCloseTo(((1 / 41.8 - 1 / 40) / (1 / 40)) * 100, 6);
  });

  it("leaves out a currency whose rate is missing", () => {
    const quotes = currencyQuotes({ ...usdPer, XAU_G: null });
    expect(quotes.XAU_G).toBeUndefined();
    expect(quotes.USD).toBeDefined();
  });
});
