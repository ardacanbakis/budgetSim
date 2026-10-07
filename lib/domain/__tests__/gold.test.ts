import { describe, expect, it } from "vitest";
import { Account } from "@/lib/data/types";
import { computeBalances } from "../balances";
import { GOLD_META, GOLD_TYPES, goldRatios, holdingsInGrams, readHoldings } from "../gold";

// dealer buying prices on Truncgil, 6 Oct 2026
const prices = { gram: 6477.8, has: 6445.41, ayar22: 5932.52, ceyrek: 10407.93, yarim: 20750.81, tam: 41631.71 };

describe("gold holdings", () => {
  it("values each holding by its own price, in grams of gram gold", () => {
    const ratios = goldRatios(prices);
    // 2 tam, 2 yarım, 5 çeyrek, 50 g has, 20 g bilezik
    const mix = [
      { type: "tam" as const, qty: 2 },
      { type: "yarim" as const, qty: 2 },
      { type: "ceyrek" as const, qty: 5 },
      { type: "has" as const, qty: 50 },
      { type: "ayar22" as const, qty: 20 },
    ];
    const tryValue = 2 * 41631.71 + 2 * 20750.81 + 5 * 10407.93 + 50 * 6445.41 + 20 * 5932.52;
    expect(holdingsInGrams(mix, ratios) * prices.gram).toBeCloseTo(tryValue, 2);
  });

  it("falls back to the stand-in ratio for a type with no live price", () => {
    const ratios = goldRatios({ gram: 6477.8 });
    expect(ratios.besli).toBe(GOLD_META.besli.ratio);
    expect(goldRatios(undefined).ceyrek).toBe(GOLD_META.ceyrek.ratio);
  });

  it("keeps the stand-in ratios close to the prices they came from", () => {
    const ratios = goldRatios(prices);
    for (const type of ["has", "ayar22", "ceyrek", "yarim", "tam"] as const) {
      expect(ratios[type]).toBeCloseTo(GOLD_META[type].ratio, 3);
    }
  });

  it("reads a stored list, dropping anything it can't use", () => {
    expect(readHoldings([{ type: "tam", qty: 2 }, { type: "silver", qty: 1 }, { type: "ceyrek", qty: -1 }, null])).toEqual([
      { type: "tam", qty: 2 },
    ]);
    expect(readHoldings(null)).toBeNull();
    expect(readHoldings([])).toBeNull();
  });

  it("knows every type's unit", () => {
    expect(GOLD_TYPES.filter((t) => GOLD_META[t].unit === "g")).toEqual(["gram", "has", "ayar22", "ayar18", "ayar14"]);
  });
});

describe("a gold account's balance", () => {
  const gold: Account = {
    id: "gold",
    name: "T&T GOLD",
    currency: "XAU_G",
    kind: "gold",
    openingBalance: 0,
    archived: false,
    paymentAccountId: null,
    paymentDay: null,
    creditLimit: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    holdings: [
      { type: "tam", qty: 2 },
      { type: "has", qty: 50 },
    ],
  };

  it("adds the holdings, in grams of gram gold, to what's on its ledger", () => {
    const ratios = goldRatios(prices);
    const grams = computeBalances([{ ...gold, openingBalance: 10 }], [], ratios).get("gold")!;
    expect(grams).toBeCloseTo(10 + 2 * ratios.tam + 50 * ratios.has, 2);
  });

  it("uses the stand-in ratios when no prices are given", () => {
    expect(computeBalances([gold], []).get("gold")).toBeCloseTo(2 * GOLD_META.tam.ratio + 50 * GOLD_META.has.ratio, 2);
  });
});
