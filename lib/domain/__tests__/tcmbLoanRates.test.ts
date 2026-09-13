import { describe, expect, it } from "vitest";
import { annualToMonthlyPct, evdsAsOf, parseEvdsLoanRates } from "../tcmbLoanRates";

/**
 * EVDS is unreachable from CI, so this fixture is the contract: the real
 * response shape, including the underscore substitution that quietly returns
 * nothing if you look for the series code as written.
 */
const payload = {
  totalCount: 2,
  items: [
    { Tarih: "29-08-2026", TP_KTF10: "59.10", TP_KTF11: "48.20", TP_KTF12: "41.05", TP_KTF17: "55.00" },
    { Tarih: "05-09-2026", TP_KTF10: "58.42", TP_KTF11: "47.80", TP_KTF12: "40.60", TP_KTF17: "54.30" },
  ],
};

describe("annualToMonthlyPct", () => {
  it("de-compounds rather than dividing by twelve", () => {
    // 60%/yr is 3.99%/mo compounded — dividing would say 5%, which is a
    // quarter too much and would misprice every comparison
    expect(annualToMonthlyPct(60)).toBeCloseTo(3.9944, 3);
    expect(annualToMonthlyPct(60)).toBeLessThan(5);
  });

  it("round-trips against compounding", () => {
    const monthly = annualToMonthlyPct(58.42) / 100;
    expect((Math.pow(1 + monthly, 12) - 1) * 100).toBeCloseTo(58.42, 8);
  });

  it("is zero at zero", () => {
    expect(annualToMonthlyPct(0)).toBe(0);
  });
});

describe("parseEvdsLoanRates", () => {
  const offers = parseEvdsLoanRates(payload);

  it("reads every loan type, taking the newest row", () => {
    expect(offers).toHaveLength(4);
    const konut = offers.find((o) => o.product === "Konut")!;
    // newest row is 40.60, not the older 41.05
    expect(konut.monthlyRatePct).toBeCloseTo(annualToMonthlyPct(40.6), 8);
  });

  it("labels them as the central bank's average, not a bank's offer", () => {
    expect(offers.every((o) => o.bank === "TCMB")).toBe(true);
    expect(offers.map((o) => o.product).sort()).toEqual(["Konut", "Taşıt", "Ticari", "İhtiyaç"].sort());
  });

  it("sorts cheapest first", () => {
    const rates = offers.map((o) => o.monthlyRatePct);
    expect([...rates].sort((a, b) => a - b)).toEqual(rates);
  });

  it("converts to monthly, so nothing comes back looking like an annual rate", () => {
    expect(offers.every((o) => o.monthlyRatePct < 10)).toBe(true);
  });

  it("skips a blank newest week and falls back to the one before", () => {
    const sparse = {
      items: [
        { Tarih: "29-08-2026", TP_KTF10: "59.10" },
        { Tarih: "05-09-2026", TP_KTF10: "" },
      ],
    };
    const [offer] = parseEvdsLoanRates(sparse);
    expect(offer.monthlyRatePct).toBeCloseTo(annualToMonthlyPct(59.1), 8);
  });

  it("rejects a series that isn't a rate", () => {
    // a volume series would come back in the thousands
    expect(parseEvdsLoanRates({ items: [{ TP_KTF10: "1450000" }] })).toEqual([]);
    expect(parseEvdsLoanRates({ items: [{ TP_KTF10: "0" }] })).toEqual([]);
  });

  it("gives back nothing rather than throwing on a shape it doesn't know", () => {
    expect(parseEvdsLoanRates(null)).toEqual([]);
    expect(parseEvdsLoanRates({ error: "bad key" })).toEqual([]);
    expect(parseEvdsLoanRates({ items: [] })).toEqual([]);
  });
});

describe("evdsAsOf", () => {
  it("reports the newest row's stamp", () => {
    expect(evdsAsOf(payload)).toBe("05-09-2026");
  });

  it("is null when there is nothing to stamp", () => {
    expect(evdsAsOf({ items: [] })).toBeNull();
    expect(evdsAsOf(undefined)).toBeNull();
  });
});
