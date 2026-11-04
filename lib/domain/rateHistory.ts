/**
 * Exchange-rate history for the Gadgets page: how USD, EUR, TRY and BTC
 * moved against each other over the last month, quarter or year, and what an
 * amount was worth on a past date. Gold has no history here.
 *
 * /api/rate-history serves it in the app's own convention, "USD per unit"
 * (lib/domain/fx.ts), one series per currency, so any pair is one division:
 * Frankfurter (ECB) for the fiat currencies, on business days, and CoinGecko
 * for bitcoin, every day. The dollar is 1 on every date.
 */

export const HISTORY_CURRENCIES = ["USD", "TRY", "EUR", "BTC"] as const;
export type HistoryCurrency = (typeof HISTORY_CURRENCIES)[number];

export const HISTORY_RANGES = [30, 90, 365] as const;
export type HistoryRange = (typeof HISTORY_RANGES)[number];

/** [yyyy-mm-dd, USD per unit], oldest first */
export type UsdPerSeries = [string, number][];

export interface RateHistory {
  /** one series per currency the sources answered for; USD is implied */
  series: Partial<Record<Exclude<HistoryCurrency, "USD">, UsdPerSeries>>;
  fetchedAt: string;
}

/** What every currency was worth on one date (the nearest the sources had on or before it). */
export interface RatesOn {
  date: string;
  usdPer: Partial<Record<HistoryCurrency, number>>;
}

export function isHistoryCurrency(value: string): value is HistoryCurrency {
  return (HISTORY_CURRENCIES as readonly string[]).includes(value);
}

export function isHistoryRange(value: number): value is HistoryRange {
  return (HISTORY_RANGES as readonly number[]).includes(value);
}

/**
 * Frankfurter's time series (base USD) as USD-per-unit series. Its rates are
 * "units per dollar", so each is inverted; anything that isn't a positive
 * number is dropped.
 */
export function parseFrankfurterSeries(json: unknown): Partial<Record<"TRY" | "EUR", UsdPerSeries>> {
  const rates = (json as { rates?: Record<string, Record<string, unknown>> })?.rates;
  if (!rates || typeof rates !== "object") return {};
  const out: Partial<Record<"TRY" | "EUR", UsdPerSeries>> = {};
  for (const date of Object.keys(rates).sort()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    for (const code of ["TRY", "EUR"] as const) {
      const perUsd = rates[date]?.[code];
      if (typeof perUsd === "number" && perUsd > 0) (out[code] ??= []).push([date, 1 / perUsd]);
    }
  }
  return out;
}

/**
 * CoinGecko's market chart ({ prices: [[ms, usd], ...] }) as one value per
 * UTC day, the day's last price winning.
 */
export function parseCoinGeckoSeries(json: unknown): UsdPerSeries {
  const prices = (json as { prices?: unknown })?.prices;
  if (!Array.isArray(prices)) return [];
  const byDay = new Map<string, number>();
  for (const point of prices) {
    if (!Array.isArray(point) || typeof point[0] !== "number" || typeof point[1] !== "number" || point[1] <= 0) continue;
    byDay.set(new Date(point[0]).toISOString().slice(0, 10), point[1]);
  }
  return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));
}

export interface PairPoint {
  date: string;
  /** how many `to` one `from` bought that day */
  rate: number;
}

/**
 * One pair's history: the dates both sides have a value on (the dollar has
 * one every day), as `to` per `from`. Empty when a side has no series.
 */
export function pairSeries(history: Pick<RateHistory, "series">, from: HistoryCurrency, to: HistoryCurrency): PairPoint[] {
  if (from === to) return [];
  const side = (c: HistoryCurrency) => (c === "USD" ? null : new Map(history.series[c] ?? []));
  const a = side(from);
  const b = side(to);
  const dates = a ? [...a.keys()] : b ? [...b.keys()] : [];
  const points: PairPoint[] = [];
  for (const date of dates) {
    const fromUsd = a ? a.get(date) : 1;
    const toUsd = b ? b.get(date) : 1;
    if (fromUsd == null || toUsd == null || toUsd === 0) continue;
    points.push({ date, rate: fromUsd / toUsd });
  }
  return points.sort((x, y) => x.date.localeCompare(y.date));
}

export interface PairSummary {
  first: PairPoint;
  last: PairPoint;
  low: PairPoint;
  high: PairPoint;
  /** the change from first to last, in percent */
  changePct: number;
}

export function summarize(points: PairPoint[]): PairSummary | null {
  if (points.length === 0) return null;
  let low = points[0];
  let high = points[0];
  for (const p of points) {
    if (p.rate < low.rate) low = p;
    if (p.rate > high.rate) high = p;
  }
  const first = points[0];
  const last = points[points.length - 1];
  return { first, last, low, high, changePct: ((last.rate - first.rate) / first.rate) * 100 };
}

/** An amount of `from` in `to` at one date's rates; null when either side is missing. */
export function convertOn(amount: number, from: HistoryCurrency, to: HistoryCurrency, rates: RatesOn): number | null {
  if (!Number.isFinite(amount)) return null;
  if (from === to) return amount;
  const a = from === "USD" ? 1 : rates.usdPer[from];
  const b = to === "USD" ? 1 : rates.usdPer[to];
  if (a == null || b == null || b === 0) return null;
  return (amount * a) / b;
}
