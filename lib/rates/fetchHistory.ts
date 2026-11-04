import {
  HistoryRange,
  parseCoinGeckoSeries,
  parseFrankfurterSeries,
  RateHistory,
  RatesOn,
} from "@/lib/domain/rateHistory";

/**
 * Server side of /api/rate-history: the fiat series from Frankfurter (ECB,
 * keyless) and bitcoin from CoinGecko (keyless), each best effort, so one
 * source being down still draws the other's pairs. Past rates don't change,
 * so they're cached for an hour (a series) or a day (one date).
 */

type Fetcher = (url: string, init?: RequestInit & { next?: { revalidate: number } }) => Promise<Response>;

const TIMEOUT_MS = 8_000;

async function getJson(fetcher: Fetcher, url: string, revalidate: number): Promise<unknown> {
  const res = await fetcher(url, { signal: AbortSignal.timeout(TIMEOUT_MS), next: { revalidate } });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export async function fetchRateHistory(days: HistoryRange, now = new Date(), fetcher: Fetcher = fetch): Promise<RateHistory> {
  const start = new Date(now.getTime() - days * 86_400_000);
  const [fx, btc] = await Promise.allSettled([
    getJson(fetcher, `https://api.frankfurter.dev/v1/${isoDay(start)}..${isoDay(now)}?base=USD&symbols=TRY,EUR`, 3600),
    getJson(fetcher, `https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=${days}&interval=daily`, 3600),
  ]);
  const series: RateHistory["series"] = {};
  if (fx.status === "fulfilled") Object.assign(series, parseFrankfurterSeries(fx.value));
  if (btc.status === "fulfilled") {
    const points = parseCoinGeckoSeries(btc.value);
    if (points.length) series.BTC = points;
  }
  return { series, fetchedAt: now.toISOString() };
}

/** Every currency's rate on one date: the ECB's for that day or the business day before, bitcoin's for that day. */
export async function fetchRatesOn(date: string, fetcher: Fetcher = fetch): Promise<RatesOn> {
  const [y, m, d] = date.split("-");
  const [fx, btc] = await Promise.allSettled([
    getJson(fetcher, `https://api.frankfurter.dev/v1/${date}?base=USD&symbols=TRY,EUR`, 86_400),
    getJson(fetcher, `https://api.coingecko.com/api/v3/coins/bitcoin/history?date=${d}-${m}-${y}&localization=false`, 86_400),
  ]);
  const usdPer: RatesOn["usdPer"] = { USD: 1 };
  let used = date;
  if (fx.status === "fulfilled") {
    const json = fx.value as { date?: string; rates?: Record<string, unknown> };
    for (const code of ["TRY", "EUR"] as const) {
      const perUsd = json.rates?.[code];
      if (typeof perUsd === "number" && perUsd > 0) usdPer[code] = 1 / perUsd;
    }
    // a weekend or holiday answers with the business day before it
    if (typeof json.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(json.date)) used = json.date;
  }
  if (btc.status === "fulfilled") {
    const usd = (btc.value as { market_data?: { current_price?: { usd?: unknown } } }).market_data?.current_price?.usd;
    if (typeof usd === "number" && usd > 0) usdPer.BTC = usd;
  }
  return { date: used, usdPer };
}
