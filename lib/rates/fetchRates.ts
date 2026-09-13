import { RateTable } from "@/lib/domain/fx";
import { FALLBACK_SOURCE, FALLBACK_USD_PER } from "./fallback";
import {
  DEFAULT_FX_SOURCE,
  DEFAULT_GOLD_SOURCE,
  FxSourceId,
  fxChain,
  GoldSourceId,
  goldChain,
  SOURCE_URLS,
} from "./sources";
import {
  FxQuote,
  GoldQuote,
  parseCollectApiGold,
  parseGenelParaFx,
  parseGenelParaGold,
  parseTruncgilFx,
  parseTruncgilGold,
} from "./turkishSources";

/**
 * Server-side rate fetching. Every device gets its rates from our single
 * /api/rates endpoint (which caches), so all devices see the same numbers.
 *
 * Sources:
 *  - Truncgil / GenelPara (free, no key, Turkish): gram gold and the lira on
 *    the free market — the price actually paid in Turkey
 *  - Frankfurter (free, no key): USD→TRY, USD→EUR at the ECB reference rate
 *  - CoinGecko (free, no key): BTC price in USD
 *  - CollectAPI (key via COLLECT_API_KEY): gram gold, kept for whoever has one
 *
 * Gold and the lira each walk a chain of providers and take the first that
 * answers with a plausible number, so one provider having a bad afternoon
 * costs a retry rather than a day on stale figures. Whatever served each
 * currency is reported in `sources`, and every attempt — including the
 * failures — in `diagnostics`, because "why is my gold price stale" is
 * otherwise unanswerable from the outside.
 */

export interface RatePrefs {
  gold?: GoldSourceId;
  fx?: FxSourceId;
}

const TIMEOUT_MS = 8_000;

/** A provider that hangs must not hold up every other number on the page. */
async function getJson(url: string, init?: RequestInit & { next?: { revalidate: number } }) {
  const res = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(TIMEOUT_MS),
    next: init?.next ?? { revalidate: 900 },
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

async function fetchGoldFrom(id: string): Promise<GoldQuote | null> {
  if (id === "truncgil") return parseTruncgilGold(await getJson(SOURCE_URLS.truncgil()));
  if (id === "genelpara") return parseGenelParaGold(await getJson(SOURCE_URLS.genelparaGold()));
  if (id === "collectapi") {
    const key = process.env.COLLECT_API_KEY;
    if (!key) return null;
    return parseCollectApiGold(
      await getJson(SOURCE_URLS.collectapi(), {
        headers: { authorization: `apikey ${key}`, "content-type": "application/json" },
      })
    );
  }
  return null;
}

async function fetchFxFrom(id: string): Promise<FxQuote | null> {
  if (id === "truncgil") return parseTruncgilFx(await getJson(SOURCE_URLS.truncgil()));
  if (id === "genelpara") return parseGenelParaFx(await getJson(SOURCE_URLS.genelparaFx()));
  if (id === "frankfurter") {
    const json = (await getJson("https://api.frankfurter.dev/v1/latest?base=USD&symbols=TRY,EUR")) as {
      rates?: { TRY?: number; EUR?: number };
    };
    const tryPerUsd = json.rates?.TRY;
    if (!tryPerUsd || !(tryPerUsd > 0)) return null;
    // Frankfurter quotes EUR per USD; the rest of this file works in lira, so
    // the euro is converted into the same unit before it leaves here
    const eurPerUsd = json.rates?.EUR;
    return {
      tryPerUsd,
      tryPerEur: eurPerUsd && eurPerUsd > 0 ? tryPerUsd / eurPerUsd : null,
      asOf: null,
    };
  }
  return null;
}

export async function fetchRateTable(prefs: RatePrefs = {}): Promise<RateTable> {
  const usdPer = { ...FALLBACK_USD_PER };
  const prevUsdPer: RateTable["prevUsdPer"] = {};
  const sources: RateTable["sources"] = {
    USD: "identity",
    TRY: FALLBACK_SOURCE,
    EUR: FALLBACK_SOURCE,
    BTC: FALLBACK_SOURCE,
    XAU_G: FALLBACK_SOURCE,
  };
  const diagnostics: NonNullable<RateTable["diagnostics"]> = [];
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

  // The lira settles first: gold is quoted in TRY, so converting it to USD
  // with a stale lira would be wrong even when the gold fetch itself won.
  const fx = (async () => {
    for (const id of fxChain(prefs.fx ?? DEFAULT_FX_SOURCE)) {
      try {
        const quote = await fetchFxFrom(id);
        if (!quote) {
          diagnostics.push({ kind: "fx", source: id, ok: false, detail: "no usable rate" });
          continue;
        }
        usdPer.TRY = 1 / quote.tryPerUsd;
        sources.TRY = id;
        if (quote.tryPerEur) {
          usdPer.EUR = quote.tryPerEur / quote.tryPerUsd;
          sources.EUR = id;
        }
        diagnostics.push({ kind: "fx", source: id, ok: true, asOf: quote.asOf ?? undefined });
        return;
      } catch (err) {
        diagnostics.push({ kind: "fx", source: id, ok: false, detail: reason(err) });
      }
    }
  })();

  const gold = (async () => {
    // every gold provider quotes in lira, so wait for the lira either way
    await fx;
    for (const id of goldChain(prefs.gold ?? DEFAULT_GOLD_SOURCE)) {
      try {
        const quote = await fetchGoldFrom(id);
        if (!quote) {
          diagnostics.push({ kind: "gold", source: id, ok: false, detail: "no usable price" });
          continue;
        }
        usdPer.XAU_G = quote.tryPerGram * usdPer.TRY!;
        sources.XAU_G = id;
        diagnostics.push({ kind: "gold", source: id, ok: true, asOf: quote.asOf ?? undefined });
        return;
      } catch (err) {
        diagnostics.push({ kind: "gold", source: id, ok: false, detail: reason(err) });
      }
    }
  })();

  const tasks: Promise<void>[] = [
    fx,
    gold,
    // yesterday's fiat close — best effort, never blocks the live numbers
    (async () => {
      try {
        const json = (await getJson(`https://api.frankfurter.dev/v1/${yesterday}?base=USD&symbols=TRY,EUR`, {
          next: { revalidate: 3600 },
        })) as { rates?: { TRY?: number; EUR?: number } };
        if (json.rates?.TRY && json.rates.TRY > 0) prevUsdPer.TRY = 1 / json.rates.TRY;
        if (json.rates?.EUR && json.rates.EUR > 0) prevUsdPer.EUR = 1 / json.rates.EUR;
      } catch {
        // the ticker simply shows no change; nothing else depends on this
      }
    })(),
    (async () => {
      try {
        const json = (await getJson(
          "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true"
        )) as { bitcoin?: { usd?: number; usd_24h_change?: number } };
        if (json.bitcoin?.usd && json.bitcoin.usd > 0) {
          usdPer.BTC = json.bitcoin.usd;
          sources.BTC = "coingecko";
          const pct = json.bitcoin.usd_24h_change;
          // back out yesterday's price from the 24h move
          if (typeof pct === "number" && Number.isFinite(pct) && pct > -100) {
            prevUsdPer.BTC = json.bitcoin.usd / (1 + pct / 100);
          }
        }
        diagnostics.push({ kind: "btc", source: "coingecko", ok: true });
      } catch (err) {
        diagnostics.push({ kind: "btc", source: "coingecko", ok: false, detail: reason(err) });
      }
    })(),
  ];

  await Promise.allSettled(tasks);

  return {
    usdPer,
    fetchedAt: new Date().toISOString(),
    sources,
    prevUsdPer: Object.keys(prevUsdPer).length ? prevUsdPer : undefined,
    diagnostics,
  };
}

function reason(err: unknown): string {
  if (err instanceof Error) return err.name === "TimeoutError" ? "timed out" : err.message;
  return "failed";
}
