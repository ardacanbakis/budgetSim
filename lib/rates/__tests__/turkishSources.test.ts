import { describe, expect, it } from "vitest";
import {
  parseCollectApiGold,
  parseGenelParaFx,
  parseGenelParaGold,
  parseTruncgilFx,
  parseTruncgilGold,
  parseTruncgilGoldPrices,
  parseTurkishNumber,
  plausibleGram,
} from "../turkishSources";

/**
 * The network is unreachable from CI, so these fixtures are the contract.
 * They are the real response shapes each provider serves; if a provider
 * changes, this file is where it should break.
 */

describe("parseTurkishNumber", () => {
  it("reads a comma as the decimal separator and dots as grouping", () => {
    expect(parseTurkishNumber("4.123,45")).toBe(4123.45);
    expect(parseTurkishNumber("1.234.567,89")).toBe(1234567.89);
  });

  it("still reads a plain machine decimal", () => {
    expect(parseTurkishNumber("4123.45")).toBe(4123.45);
    expect(parseTurkishNumber("4,123.45")).toBe(4123.45);
  });

  it("takes a real number as it is", () => {
    expect(parseTurkishNumber(4123.45)).toBe(4123.45);
  });

  it("ignores currency symbols and stray spaces", () => {
    expect(parseTurkishNumber(" ₺4.123,45 ")).toBe(4123.45);
  });

  it("never confuses grouping for a decimal", () => {
    // the failure that matters: "4.123" must not become 4.123, because a
    // thousand-fold error in gold still draws a plausible-looking chart
    expect(parseTurkishNumber("4.123,00")).toBe(4123);
    expect(parseTurkishNumber("41,78")).toBe(41.78);
  });

  it("refuses what it can't read", () => {
    expect(parseTurkishNumber("")).toBeNull();
    expect(parseTurkishNumber("n/a")).toBeNull();
    expect(parseTurkishNumber(null)).toBeNull();
    expect(parseTurkishNumber({})).toBeNull();
    expect(parseTurkishNumber(Number.NaN)).toBeNull();
  });
});

describe("plausibleGram", () => {
  it("rejects a price that can only be a parse error", () => {
    // 4.12 TRY a gram would be a thousand-fold slip, not a bargain
    expect(plausibleGram(4.12)).toBe(false);
    expect(plausibleGram(4123.45)).toBe(true);
    expect(plausibleGram(null)).toBe(false);
  });
});

describe("Truncgil", () => {
  const v4 = {
    Update_Date: "2026-09-13 16:45:02",
    USD: { Type: "Currency", Name: "Amerikan Doları", Buying: 41.72, Selling: 41.81, Change: 0.12 },
    EUR: { Type: "Currency", Name: "Euro", Buying: 45.4, Selling: 45.56, Change: -0.04 },
    GRA: { Type: "Gold", Name: "Gram Altın", Buying: 4118.2, Selling: 4125.6, Change: 0.42 },
  };

  const v3 = {
    Update_Date: "13.09.2026 16:45:02",
    "Gram Altın": { Alış: "4.118,20", Satış: "4.125,60", Tür: "Altın", Değişim: "%0,42" },
    "Amerikan Doları": { Alış: "41,72", Satış: "41,81", Tür: "Döviz", Değişim: "%0,12" },
    Euro: { Alış: "45,40", Satış: "45,56", Tür: "Döviz", Değişim: "%-0,04" },
  };

  it("reads gram gold from the v4 shape", () => {
    expect(parseTruncgilGold(v4)).toEqual({ tryPerGram: 4118.2, asOf: "2026-09-13 16:45:02" });
  });

  it("reads gram gold from the older Turkish-keyed shape", () => {
    expect(parseTruncgilGold(v3)).toEqual({ tryPerGram: 4118.2, asOf: "13.09.2026 16:45:02" });
  });

  it("values gold at the buying price, what a dealer pays you for it", () => {
    expect(parseTruncgilGold(v4)!.tryPerGram).toBe(4118.2);
    expect(parseTruncgilGold(v4)!.tryPerGram).not.toBe(4125.6);
  });

  it("falls back to selling when only that is quoted", () => {
    expect(parseTruncgilGold({ GRA: { Selling: 4125.6 } })!.tryPerGram).toBe(4125.6);
  });

  it("reads the lira from both shapes", () => {
    expect(parseTruncgilFx(v4)).toEqual({ tryPerUsd: 41.81, tryPerEur: 45.56, asOf: "2026-09-13 16:45:02" });
    expect(parseTruncgilFx(v3)!.tryPerUsd).toBe(41.81);
    expect(parseTruncgilFx(v3)!.tryPerEur).toBe(45.56);
  });

  // what finance.truncgil.com/api/today.json, the default URL, serves as of
  // October 2026: the v4 rows nested under "Rates", the date under "Meta_Data"
  const wrapped = {
    Meta_Data: { Minutes_Ago: -0.02, Current_Date: "2026-10-06 22:58:05", Update_Date: "2026-10-06 22:58:04" },
    Rates: {
      USD: { Buying: 49.1714, Type: "Currency", Selling: 49.1804, Change: 0.07 },
      EUR: { Buying: 55.3986, Type: "Currency", Selling: 55.4198, Change: 0.41 },
      GRA: { Selling: 6592.07, Type: "Gold", Name: "GRAMALTIN", Change: 0.77, Buying: 6591.18 },
    },
  };

  it("reads gram gold and the lira from the rows nested under Rates", () => {
    expect(parseTruncgilGold(wrapped)).toEqual({ tryPerGram: 6591.18, asOf: "2026-10-06 22:58:04" });
    expect(parseTruncgilFx(wrapped)).toEqual({ tryPerUsd: 49.1804, tryPerEur: 55.4198, asOf: "2026-10-06 22:58:04" });
  });

  it("reads every gold type's buying price, coins by the piece and ayar gold by the gram", () => {
    const feed = {
      Meta_Data: { Update_Date: "2026-10-06 22:58:04" },
      Rates: {
        GRA: { Buying: 6477.8, Selling: 6478.78 },
        HAS: { Buying: 6445.41, Selling: 6446.39 },
        YIA: { Buying: 5932.52, Selling: 5942.75, Name: "22AYARBILEZIK" },
        CEYREKALTIN: { Buying: 10407.93, Selling: 10653.94 },
        TAMALTIN: { Buying: 41631.71, Selling: 42485.44 },
        BESLIALTIN: { Buying: 210760.54, Selling: 215033.68 },
        ONS: { Buying: 0, Selling: 0 },
      },
    };
    expect(parseTruncgilGoldPrices(feed)).toEqual({
      gram: 6477.8,
      has: 6445.41,
      ayar22: 5932.52,
      ceyrek: 10407.93,
      tam: 41631.71,
      besli: 210760.54,
    });
    expect(parseTruncgilGoldPrices({ Rates: { CEYREKALTIN: { Buying: 0 } } })).toEqual({});
    expect(parseTruncgilGoldPrices(null)).toEqual({});
  });

  it("gives back nothing rather than guessing at a shape it doesn't know", () => {
    expect(parseTruncgilGold({ Rates: { error: "rate limited" } })).toBeNull();
    expect(parseTruncgilGold({ error: "rate limited" })).toBeNull();
    expect(parseTruncgilGold(null)).toBeNull();
    expect(parseTruncgilGold("<html>502</html>")).toBeNull();
    expect(parseTruncgilFx({})).toBeNull();
  });
});

describe("GenelPara", () => {
  const gold = {
    GA: { alis: "4118.2000", satis: "4125.6000", dusuk: "4100.0000", yuksek: "4140.0000", tarih: "13.09.2026 16:45" },
    C: { alis: "6750.0000", satis: "6790.0000" },
  };
  const fx = {
    USD: { alis: "41.7200", satis: "41.8100", degisim: "0.12", tarih: "13.09.2026 16:45" },
    EUR: { alis: "45.4000", satis: "45.5600", degisim: "-0.04" },
  };

  it("reads gram gold from the GA row, at the buying price", () => {
    expect(parseGenelParaGold(gold)).toEqual({ tryPerGram: 4118.2, asOf: "13.09.2026 16:45" });
  });

  it("reads the lira and the euro", () => {
    expect(parseGenelParaFx(fx)).toEqual({ tryPerUsd: 41.81, tryPerEur: 45.56, asOf: "13.09.2026 16:45" });
  });

  it("survives a euro it wasn't given", () => {
    expect(parseGenelParaFx({ USD: { satis: "41.81" } })).toEqual({
      tryPerUsd: 41.81,
      tryPerEur: null,
      asOf: null,
    });
  });

  it("gives back nothing on an unexpected payload", () => {
    expect(parseGenelParaGold({ GA: { satis: "0" } })).toBeNull();
    expect(parseGenelParaGold([])).toBeNull();
    expect(parseGenelParaFx(undefined)).toBeNull();
  });
});

describe("CollectAPI", () => {
  const payload = {
    success: true,
    result: [
      { name: "Gram Altın", buying: 4118.2, selling: 4125.6 },
      { name: "Çeyrek Altın", buying: 6800, selling: 6900 },
    ],
  };

  it("picks the gram row out of the list, at the buying price", () => {
    expect(parseCollectApiGold(payload)).toEqual({ tryPerGram: 4118.2, asOf: null });
  });

  it("matches the Turkish name case-insensitively", () => {
    expect(parseCollectApiGold({ result: [{ name: "GRAM ALTIN", selling: 4125.6 }] })!.tryPerGram).toBe(4125.6);
  });

  it("gives back nothing when there's no gram row", () => {
    expect(parseCollectApiGold({ result: [{ name: "Çeyrek Altın", selling: 6900 }] })).toBeNull();
    expect(parseCollectApiGold({ success: false })).toBeNull();
  });
});
