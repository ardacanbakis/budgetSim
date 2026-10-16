import { describe, expect, it } from "vitest";
import { formatCompact, formatRow, formatSigned } from "../pocket/format";

describe("formatSigned", () => {
  it("puts the sign before the symbol, as a true minus", () => {
    expect(formatSigned(-2800, "TRY", "en")).toBe("−₺2,800.00");
    expect(formatSigned(-890.99, "USD", "en")).toBe("−$890.99");
  });

  it("signs on request and never shows −0", () => {
    expect(formatSigned(120, "TRY", "en", "out")).toBe("−₺120.00");
    expect(formatSigned(120, "TRY", "en", "in")).toBe("+₺120.00");
    expect(formatSigned(-0.001, "TRY", "en")).toBe("₺0.00");
    expect(formatSigned(0, "USD", "en", "out")).toBe("$0.00");
  });

  it("follows the locale and the currency's own shape", () => {
    expect(formatSigned(-12465.5, "TRY", "tr")).toBe("−₺12.465,50");
    expect(formatSigned(0.0412, "BTC", "en")).toBe("0.0412 ₿");
    expect(formatSigned(-36, "XAU_G", "en")).toBe("−36.00 g");
  });
});

describe("formatRow", () => {
  it("signs by direction", () => {
    expect(formatRow("income", 900, "USD", "en")).toBe("+$900.00");
    expect(formatRow("expense", 27500, "TRY", "en")).toBe("−₺27,500.00");
  });
});

describe("formatCompact", () => {
  it("stays exact below ten thousand and shortens above", () => {
    expect(formatCompact(1234.5, "USD", "en")).toBe("$1,234.50");
    expect(formatCompact(19011.88, "USD", "en")).toBe("$19.01K");
    expect(formatCompact(-1_250_000, "TRY", "en")).toBe("−₺1.25M");
  });
});
