import { Currency, CURRENCIES } from "./currencies";
import { roundTo } from "./money";

/**
 * All rates are normalized to "how many USD is 1 unit of X worth" (usdPer).
 * Any pair converts through USD: amount * usdPer[from] / usdPer[to].
 * A missing/unavailable rate is null (e.g. gold source down) — conversions
 * involving it return null and the UI shows "rate unavailable".
 */
export type UsdPerMap = Record<Currency, number | null>;

export interface RateTable {
  usdPer: UsdPerMap;
  /** ISO timestamp the rates were fetched */
  fetchedAt: string;
  /** source per currency, e.g. { TRY: "frankfurter", BTC: "coingecko" } */
  sources: Partial<Record<Currency, string>>;
}

/** Snapshot stored on a transaction at completion time; never mutated after. */
export interface FxSnapshot {
  usdPer: UsdPerMap;
  at: string;
}

export function snapshotFromTable(table: RateTable): FxSnapshot {
  return { usdPer: { ...table.usdPer }, at: table.fetchedAt };
}

/** Convert between currencies using a usdPer map. Returns null when a needed rate is missing. */
export function convert(
  amount: number,
  from: Currency,
  to: Currency,
  usdPer: UsdPerMap
): number | null {
  if (from === to) return amount;
  const fromRate = usdPer[from];
  const toRate = usdPer[to];
  if (fromRate == null || toRate == null || toRate === 0) return null;
  return roundTo((amount * fromRate) / toRate, to);
}

/** Market rate for a pair: how many `to` units per 1 `from` unit. */
export function pairRate(from: Currency, to: Currency, usdPer: UsdPerMap): number | null {
  if (from === to) return 1;
  const fromRate = usdPer[from];
  const toRate = usdPer[to];
  if (fromRate == null || toRate == null || toRate === 0) return null;
  return fromRate / toRate;
}

/** Effective rate actually received on a transfer: dstAmount per 1 src unit. */
export function effectiveRate(srcAmount: number, dstAmount: number): number | null {
  if (srcAmount === 0) return null;
  return dstAmount / srcAmount;
}

/** Percent difference of effective vs market rate (negative = you got less than market). */
export function spreadPct(marketRate: number, effective: number): number {
  if (marketRate === 0) return 0;
  return ((effective - marketRate) / marketRate) * 100;
}

export function emptyUsdPer(): UsdPerMap {
  return Object.fromEntries(CURRENCIES.map((c) => [c, null])) as UsdPerMap;
}
