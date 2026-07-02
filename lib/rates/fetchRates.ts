import { RateTable } from "@/lib/domain/fx";
import { FALLBACK_SOURCE, FALLBACK_USD_PER } from "./fallback";

/**
 * Server-side rate fetching. Every device gets its rates from our single
 * /api/rates endpoint (which caches), so all devices see the same numbers.
 *
 * Sources:
 *  - Frankfurter (free, no key): USD→TRY, USD→EUR
 *  - CoinGecko (free, no key): BTC price in USD
 *  - CollectAPI (key via COLLECT_API_KEY): gram gold in TRY
 * Each source degrades independently to the static fallback, flagged per
 * currency in `sources`.
 */
export async function fetchRateTable(): Promise<RateTable> {
  const usdPer = { ...FALLBACK_USD_PER };
  const sources: RateTable["sources"] = {
    USD: "identity",
    TRY: FALLBACK_SOURCE,
    EUR: FALLBACK_SOURCE,
    BTC: FALLBACK_SOURCE,
    XAU_G: FALLBACK_SOURCE,
  };

  const tasks: Promise<void>[] = [
    (async () => {
      const res = await fetch("https://api.frankfurter.dev/v1/latest?base=USD&symbols=TRY,EUR", {
        next: { revalidate: 900 },
      });
      if (!res.ok) throw new Error(`frankfurter ${res.status}`);
      const json = (await res.json()) as { rates: { TRY: number; EUR: number } };
      if (json.rates?.TRY > 0) {
        usdPer.TRY = 1 / json.rates.TRY;
        sources.TRY = "frankfurter";
      }
      if (json.rates?.EUR > 0) {
        usdPer.EUR = 1 / json.rates.EUR;
        sources.EUR = "frankfurter";
      }
    })(),
    (async () => {
      const res = await fetch(
        "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
        { next: { revalidate: 900 } }
      );
      if (!res.ok) throw new Error(`coingecko ${res.status}`);
      const json = (await res.json()) as { bitcoin?: { usd?: number } };
      if (json.bitcoin?.usd && json.bitcoin.usd > 0) {
        usdPer.BTC = json.bitcoin.usd;
        sources.BTC = "coingecko";
      }
    })(),
    (async () => {
      const key = process.env.COLLECT_API_KEY;
      if (!key) return;
      const res = await fetch("https://api.collectapi.com/economy/goldPrice", {
        headers: { authorization: `apikey ${key}`, "content-type": "application/json" },
        next: { revalidate: 900 },
      });
      if (!res.ok) throw new Error(`collectapi ${res.status}`);
      const json = (await res.json()) as {
        result?: Array<{ name?: string; selling?: number | string }>;
      };
      const gram = json.result?.find((r) => r.name?.toLocaleLowerCase("tr").includes("gram altın"));
      const priceTry = gram ? Number(gram.selling) : NaN;
      // gold is quoted in TRY; convert to USD via the (just fetched or fallback) TRY rate
      if (Number.isFinite(priceTry) && priceTry > 0 && usdPer.TRY) {
        usdPer.XAU_G = priceTry * usdPer.TRY;
        sources.XAU_G = "collectapi";
      }
    })(),
  ];

  const results = await Promise.allSettled(tasks);
  for (const r of results) {
    if (r.status === "rejected") console.warn("rate source failed:", r.reason);
  }

  return { usdPer, fetchedAt: new Date().toISOString(), sources };
}
