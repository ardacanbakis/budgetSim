import { describe, expect, it } from "vitest";
import { availableUnits, convertUnits, formatRate, formatUnitAmount, isConverterUnit, unitMeasure, usdPerUnit } from "../converter";

const table = {
  usdPer: { USD: 1, TRY: 1 / 40, EUR: 1.1, BTC: 100000, XAU_G: 100 },
  // gram at 4000 TRY, which is 100 USD at 40 TRY a dollar
  goldTry: { gram: 4000, ceyrek: 6400, tam: 25600 },
};

describe("converter units", () => {
  it("offers the currencies with a rate and the gold types the feed priced", () => {
    expect(availableUnits(table)).toEqual(["TRY", "USD", "EUR", "BTC", "XAU_G", "gold:ceyrek", "gold:tam"]);
  });

  it("leaves out a currency without a rate, and every coin when gold has none", () => {
    const noGold = { ...table, usdPer: { ...table.usdPer, XAU_G: null } };
    expect(availableUnits(noGold)).toEqual(["TRY", "USD", "EUR", "BTC"]);
    expect(availableUnits(undefined)).toEqual([]);
  });

  it("knows its own units", () => {
    expect(isConverterUnit("USD")).toBe(true);
    expect(isConverterUnit("gold:ceyrek")).toBe(true);
    expect(isConverterUnit("gold:gram")).toBe(false);
    expect(isConverterUnit("GBP")).toBe(false);
    expect(unitMeasure("XAU_G")).toBe("g");
    expect(unitMeasure("gold:tam")).toBe("pcs");
    expect(unitMeasure("gold:ayar22")).toBe("g");
    expect(unitMeasure("EUR")).toBeNull();
  });
});

describe("convertUnits", () => {
  it("converts any pair through the dollar", () => {
    expect(convertUnits(100, "USD", "TRY", table)).toBeCloseTo(4000);
    expect(convertUnits(4000, "TRY", "USD", table)).toBeCloseTo(100);
    expect(convertUnits(110, "USD", "EUR", table)).toBeCloseTo(100);
    expect(convertUnits(1, "BTC", "XAU_G", table)).toBeCloseTo(1000);
    expect(convertUnits(5, "EUR", "EUR", table)).toBe(5);
  });

  it("values a coin at its own price against the gram's", () => {
    expect(usdPerUnit("gold:ceyrek", table)).toBeCloseTo(160);
    expect(convertUnits(1, "gold:tam", "TRY", table)).toBeCloseTo(25600);
    expect(convertUnits(4, "gold:ceyrek", "gold:tam", table)).toBeCloseTo(1);
    expect(convertUnits(1, "gold:ceyrek", "XAU_G", table)).toBeCloseTo(1.6);
  });

  it("is null for a unit with no price, or an amount that isn't a number", () => {
    expect(convertUnits(1, "gold:yarim", "TRY", table)).toBeNull();
    expect(convertUnits(Number.NaN, "USD", "TRY", table)).toBeNull();
  });
});

describe("formatting", () => {
  it("keeps small rates readable and big ones short", () => {
    expect(formatRate(41.8)).toBe("41.8");
    expect(formatRate(0.0239234449)).toBe("0.0239234");
    expect(formatRate(1234.56789, "tr")).toBe("1.234,5679");
  });

  it("shows an amount to its unit's decimals, never as a rounded-away 0", () => {
    expect(formatUnitAmount(4000, "TRY")).toBe("4,000.00");
    expect(formatUnitAmount(0.0012, "BTC")).toBe("0.0012");
    expect(formatUnitAmount(0.000000001, "BTC")).toBe("0.000000001");
    expect(formatUnitAmount(1.5, "gold:ceyrek", "tr")).toBe("1,50");
  });
});
