import { describe, expect, it } from "vitest";
import { RateTable } from "@/lib/domain/fx";
import { fallbackTable, FALLBACK_USD_PER, isStaleTable } from "../fallback";

const live: RateTable = {
  usdPer: { ...FALLBACK_USD_PER, TRY: 1 / 49.18, XAU_G: 134.05 },
  fetchedAt: "2026-10-06T20:00:00.000Z",
  sources: { USD: "identity", TRY: "frankfurter", EUR: "frankfurter", BTC: "coingecko", XAU_G: "truncgil" },
};

describe("isStaleTable", () => {
  it("trusts a table where every currency came from a live source", () => {
    expect(isStaleTable(live)).toBe(false);
  });

  it("distrusts a table where the server filled any currency from the static rates", () => {
    expect(isStaleTable({ ...live, sources: { ...live.sources, XAU_G: "fallback" } })).toBe(true);
  });

  it("distrusts the table the client builds when it can't reach the server", () => {
    expect(isStaleTable(fallbackTable())).toBe(true);
    expect(isStaleTable({ ...live, stale: true })).toBe(true);
  });
});

describe("fallbackTable", () => {
  it("is the static rates, marked stale", () => {
    const table = fallbackTable();
    expect(table.usdPer).toEqual(FALLBACK_USD_PER);
    expect(table.stale).toBe(true);
  });
});
