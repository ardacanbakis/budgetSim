import { describe, expect, it } from "vitest";
import { amountForEditing, parseTypedAmount } from "../money";

describe("parseTypedAmount", () => {
  it.each([
    ["12.465,50", 12465.5],
    ["12,465.50", 12465.5],
    ["12465,50", 12465.5],
    ["12465.50", 12465.5],
    ["₺12.465,50", 12465.5],
    ["12.465,50 TL", 12465.5],
    ["$1,234.56", 1234.56],
    ["1 234,5", 1234.5],
    ["35,5", 35.5],
    ["35.5", 35.5],
    ["35", 35],
    ["1.250.000", 1250000],
    ["1,250,000", 1250000],
    ["12.465", 12465],
    ["1,234", 1234],
    ["0,465", 0.465],
    ["-35", -35],
    ["−12.465,50", -12465.5],
    ["-₺5", -5],
  ])("reads %s as %d", (text, value) => {
    expect(parseTypedAmount(text)).toBe(value);
  });

  it("keeps three decimals where the currency has them", () => {
    expect(parseTypedAmount("0.465", 8)).toBe(0.465);
    expect(parseTypedAmount("0,00012345", 8)).toBe(0.00012345);
  });

  it.each(["", "abc", "12,46,5.5.0", "1.2.3,4,5", "1e307", "12-3", "99999999999999", "--5"])("refuses %j", (text) => {
    expect(parseTypedAmount(text)).toBeNaN();
  });
});

describe("amountForEditing", () => {
  it("writes the currency's decimals, Turkish with a comma", () => {
    expect(amountForEditing(167867, "TRY", "tr")).toBe("167867,00");
    expect(amountForEditing(167867, "TRY", "en")).toBe("167867.00");
  });

  it("never uses exponent form", () => {
    expect(amountForEditing(0.0000005, "BTC", "en")).toBe("0.00000050");
  });

  it("is read back exactly", () => {
    for (const [amount, currency, locale] of [
      [12465.5, "TRY", "tr"],
      [-20.1, "USD", "en"],
      [0.04120001, "BTC", "tr"],
      [36, "XAU_G", "en"],
    ] as const) {
      expect(parseTypedAmount(amountForEditing(amount, currency, locale), currency === "BTC" ? 8 : 2)).toBe(amount);
    }
  });
});
