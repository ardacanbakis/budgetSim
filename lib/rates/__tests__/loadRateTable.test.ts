import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { RateTable } from "@/lib/domain/fx";
import { FALLBACK_USD_PER, isStaleTable } from "../fallback";
import { loadRateTable } from "../loadRateTable";

const live: RateTable = {
  usdPer: { ...FALLBACK_USD_PER, TRY: 1 / 49.18, XAU_G: 134.05 },
  fetchedAt: "2026-10-06T20:00:00.000Z",
  sources: { USD: "identity", TRY: "frankfurter", EUR: "frankfurter", BTC: "coingecko", XAU_G: "truncgil" },
};

const ok = (table: RateTable) => async () => table;
const offline = async (): Promise<RateTable> => {
  throw new Error("fetch failed");
};

/** Loads the way useRates does, through a real QueryClient. */
function load(client: QueryClient, fetchTable: () => Promise<RateTable>) {
  const queryKey = ["rates", "truncgil", "frankfurter"];
  return client.fetchQuery({
    queryKey,
    queryFn: () => loadRateTable(fetchTable, client.getQueryData(queryKey)),
    staleTime: 0,
    retry: false,
  });
}

const cached = (client: QueryClient) => client.getQueryData<RateTable>(["rates", "truncgil", "frankfurter"]);

describe("loadRateTable", () => {
  it("serves the live table", async () => {
    const client = new QueryClient();
    expect(await load(client, ok(live))).toEqual(live);
  });

  it("keeps the last good table when a refetch fails", async () => {
    const client = new QueryClient();
    await load(client, ok(live));
    await expect(load(client, offline)).rejects.toThrow("fetch failed");
    // still the live numbers, not the static ones
    expect(cached(client)).toEqual(live);
    expect(isStaleTable(cached(client)!)).toBe(false);
  });

  it("stands in the stale fallback only when no table has arrived yet", async () => {
    const client = new QueryClient();
    const table = await load(client, offline);
    expect(table.usdPer).toEqual(FALLBACK_USD_PER);
    expect(isStaleTable(table)).toBe(true);
  });

  it("lets the next good fetch replace the fallback", async () => {
    const client = new QueryClient();
    await load(client, offline);
    await load(client, ok(live));
    expect(cached(client)).toEqual(live);
  });
});
