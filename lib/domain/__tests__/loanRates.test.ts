import { describe, expect, it } from "vitest";
import { extractRows, normalizeLoanOffers, parseRate, toMonthly } from "../loanRates";

describe("parseRate", () => {
  it("reads a Turkish decimal comma as a decimal point", () => {
    expect(parseRate("2,89")).toBeCloseTo(2.89);
  });

  it("ignores percent signs and stray spaces", () => {
    expect(parseRate("%2.89")).toBeCloseTo(2.89);
    expect(parseRate("2.89 %")).toBeCloseTo(2.89);
    expect(parseRate(" 3,15 ")).toBeCloseTo(3.15);
  });

  it("takes a number as it is", () => {
    expect(parseRate(2.89)).toBe(2.89);
  });

  it("refuses what it can't read", () => {
    expect(parseRate("n/a")).toBeNull();
    expect(parseRate(null)).toBeNull();
    expect(parseRate({})).toBeNull();
    expect(parseRate(Number.NaN)).toBeNull();
  });
});

describe("toMonthly", () => {
  it("leaves a plausible monthly rate alone", () => {
    expect(toMonthly(2.89)).toBeCloseTo(2.89);
  });

  it("de-compounds a rate that can only be annual", () => {
    // 40.79%/yr is 2.89%/mo compounded, so it has to come back as 2.89
    expect(toMonthly(40.79)).toBeCloseTo(2.89, 2);
  });

  it("never turns an annual rate into a bigger monthly one", () => {
    for (const annual of [25, 45, 60, 90]) {
      expect(toMonthly(annual)).toBeLessThan(annual);
    }
  });
});

describe("extractRows", () => {
  const rows = [{ bank: "A" }, { bank: "B" }];

  it("finds the array however the provider wrapped it", () => {
    expect(extractRows(rows)).toHaveLength(2);
    expect(extractRows({ result: rows })).toHaveLength(2);
    expect(extractRows({ data: rows })).toHaveLength(2);
    expect(extractRows({ result: { data: rows } })).toHaveLength(2);
  });

  it("gives back nothing rather than throwing on a shape it doesn't know", () => {
    expect(extractRows(null)).toEqual([]);
    expect(extractRows("nope")).toEqual([]);
    expect(extractRows({ success: false })).toEqual([]);
  });
});

describe("normalizeLoanOffers", () => {
  it("reads the field names different endpoints use for the same thing", () => {
    const offers = normalizeLoanOffers({
      result: [
        { bank: "Garanti", rate: "2,89", vade: "24", tutar: "100000", urun: "İhtiyaç" },
        { banka: "Ziraat", oran: "%3.15", month: 36 },
        { bankName: "Akbank", faiz: 2.5 },
      ],
    });
    expect(offers.map((o) => o.bank)).toEqual(["Akbank", "Garanti", "Ziraat"]);
    expect(offers[1]).toMatchObject({
      bank: "Garanti",
      product: "İhtiyaç",
      termMonths: 24,
      amount: 100_000,
    });
    expect(offers[1].monthlyRatePct).toBeCloseTo(2.89);
  });

  it("sorts cheapest first, because that's the only reason to look", () => {
    const offers = normalizeLoanOffers([
      { bank: "Expensive", rate: 4.1 },
      { bank: "Cheap", rate: 2.2 },
      { bank: "Middle", rate: 3.0 },
    ]);
    expect(offers.map((o) => o.bank)).toEqual(["Cheap", "Middle", "Expensive"]);
  });

  it("drops a row it can't attribute or can't price", () => {
    const offers = normalizeLoanOffers([
      { bank: "Good", rate: 2.5 },
      { rate: 1.9 }, // no bank
      { bank: "No rate" },
      { bank: "Zero", rate: 0 },
      { bank: "Junk", rate: "ask us" },
    ]);
    expect(offers.map((o) => o.bank)).toEqual(["Good"]);
  });

  it("survives a payload that isn't offers at all", () => {
    expect(normalizeLoanOffers({ success: false, message: "invalid key" })).toEqual([]);
    expect(normalizeLoanOffers(undefined)).toEqual([]);
  });

  it("leaves term and amount null when the provider didn't say", () => {
    const [offer] = normalizeLoanOffers([{ bank: "Vakıf", rate: 2.75 }]);
    expect(offer.termMonths).toBeNull();
    expect(offer.amount).toBeNull();
    expect(offer.product).toBeNull();
  });
});
