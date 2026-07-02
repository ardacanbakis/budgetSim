import { describe, expect, it } from "vitest";
import { roundTo, subtractAmounts, sumAmounts, toMinor } from "../money";
import { convert, effectiveRate, emptyUsdPer, pairRate, spreadPct, UsdPerMap } from "../fx";
import { formatAmount } from "../currencies";

const rates: UsdPerMap = {
  USD: 1,
  TRY: 1 / 41.5, // 41.50 TRY per USD
  EUR: 1.08,
  BTC: 100000,
  XAU_G: 75,
};

describe("money", () => {
  it("sums without float drift", () => {
    // 0.1 + 0.2 !== 0.3 with raw floats
    expect(sumAmounts("USD", [0.1, 0.2])).toBe(0.3);
    expect(sumAmounts("TRY", Array(100).fill(0.01))).toBe(1);
  });

  it("respects BTC 8-decimal precision", () => {
    expect(toMinor(0.00000001, "BTC")).toBe(1);
    expect(sumAmounts("BTC", [0.1, 0.2, 0.00000003])).toBe(0.30000003);
  });

  it("subtracts exactly", () => {
    expect(subtractAmounts("USD", 100, 99.99)).toBe(0.01);
  });

  it("rounds to currency precision", () => {
    expect(roundTo(1.005, "USD")).toBe(1.01);
    expect(roundTo(1.123456789, "BTC")).toBe(1.12345679);
  });
});

describe("fx", () => {
  it("converts identity", () => {
    expect(convert(100, "USD", "USD", rates)).toBe(100);
  });

  it("converts through USD", () => {
    // 1000 USD → TRY at 41.5
    expect(convert(1000, "USD", "TRY", rates)).toBe(41500);
    // 41500 TRY → USD back
    expect(convert(41500, "TRY", "USD", rates)).toBe(1000);
    // 1 BTC → EUR: 100000 / 1.08
    expect(convert(1, "BTC", "EUR", rates)).toBe(roundTo(100000 / 1.08, "EUR"));
  });

  it("returns null when a rate is missing", () => {
    const withMissing = { ...rates, XAU_G: null };
    expect(convert(10, "XAU_G", "TRY", withMissing)).toBeNull();
    expect(convert(10, "TRY", "XAU_G", withMissing)).toBeNull();
    expect(convert(10, "TRY", "TRY", emptyUsdPer())).toBe(10); // same-currency needs no rate
  });

  it("computes pair rate, effective rate, spread", () => {
    const market = pairRate("USD", "TRY", rates)!;
    expect(market).toBeCloseTo(41.5, 10);
    // Bank gave 41,000 TRY for $1,000 → effective 41.0, spread ≈ -1.2%
    const eff = effectiveRate(1000, 41000)!;
    expect(eff).toBe(41);
    expect(spreadPct(market, eff)).toBeCloseTo(-1.2048, 3);
  });
});

describe("formatAmount", () => {
  it("formats fiat, btc, gold", () => {
    expect(formatAmount(1234.5, "USD")).toBe("$1,234.50");
    expect(formatAmount(0.05, "BTC")).toBe("0.05 ₿");
    expect(formatAmount(20, "XAU_G")).toBe("20.00 g");
  });
});
