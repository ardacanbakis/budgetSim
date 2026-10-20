import { Currency } from "./currencies";
import { UsdPerMap } from "./fx";

/**
 * Market ticker quotes, in the shape a Turkish finance channel shows them:
 * the pair people actually quote (USD/TRY, not TRY/USD), with the 24h move
 * of that same quote. Derived purely from the rate table, so the displayed
 * value and its change can never disagree.
 */

export interface TickerItem {
  id: string;
  label: string;
  /** the quote itself, e.g. 41.83 for USD/TRY */
  value: number;
  /** 24h move of the quote in percent; null when no comparison is available */
  changePct: number | null;
  /** sensible precision for this magnitude */
  decimals: number;
}

/** `to` units per 1 `from` unit; null when either leg is missing. */
function quote(from: keyof UsdPerMap, to: keyof UsdPerMap, usdPer: Partial<UsdPerMap>): number | null {
  const f = usdPer[from];
  const t = usdPer[to];
  if (f == null || t == null || t === 0) return null;
  return f / t;
}

function decimalsFor(value: number): number {
  if (value >= 1000) return 0;
  if (value >= 100) return 1;
  if (value >= 1) return 2;
  return 4;
}

type Pair = { id: string; label: string; from: keyof UsdPerMap; to: keyof UsdPerMap };

const PAIRS: Pair[] = [
  { id: "usdtry", label: "USD/TRY", from: "USD", to: "TRY" },
  { id: "eurtry", label: "EUR/TRY", from: "EUR", to: "TRY" },
  { id: "eurusd", label: "EUR/USD", from: "EUR", to: "USD" },
  { id: "btcusd", label: "BTC/USD", from: "BTC", to: "USD" },
  { id: "goldtry", label: "GRAM GOLD/TRY", from: "XAU_G", to: "TRY" },
];

/**
 * Build the ticker row. `prevUsdPer` (roughly 24h old) is optional and may be
 * partial — a pair only gets a change indicator when both its legs have
 * history; everything else still renders, just without one.
 */
export function buildTickerItems(
  usdPer: UsdPerMap,
  prevUsdPer?: Partial<UsdPerMap> | null
): TickerItem[] {
  return PAIRS.map((pair) => tickerItem(pair, usdPer, prevUsdPer)).filter((item): item is TickerItem => item != null);
}

function tickerItem(pair: Pair, usdPer: UsdPerMap, prevUsdPer?: Partial<UsdPerMap> | null): TickerItem | null {
  const value = quote(pair.from, pair.to, usdPer);
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  const previous = prevUsdPer ? quote(pair.from, pair.to, prevUsdPer) : null;
  const changePct = previous != null && previous > 0 ? ((value - previous) / previous) * 100 : null;
  return {
    id: pair.id,
    label: pair.label,
    value,
    changePct: changePct != null && Number.isFinite(changePct) ? changePct : null,
    decimals: decimalsFor(value),
  };
}

// the pair each currency is quoted by in currencyQuotes
const CURRENCY_PAIRS: Record<Currency, Pair> = {
  TRY: { id: "tryusd", label: "TRY/USD", from: "TRY", to: "USD" },
  USD: PAIRS[0],
  EUR: PAIRS[1],
  BTC: PAIRS[3],
  XAU_G: PAIRS[4],
};

/**
 * One quote per currency, for a list of currencies (Pocket's display-currency
 * sheet): each the way it's usually quoted, which is the ticker's pair for it
 * (USD/TRY, EUR/TRY, BTC/USD, gram gold in TRY), and the lira itself in
 * dollars, since quoting TRY in TRY says nothing. The change follows the same
 * rule as the ticker: only where the table has both legs' history.
 */
export function currencyQuotes(
  usdPer: UsdPerMap,
  prevUsdPer?: Partial<UsdPerMap> | null
): Partial<Record<Currency, TickerItem>> {
  const out: Partial<Record<Currency, TickerItem>> = {};
  for (const [currency, pair] of Object.entries(CURRENCY_PAIRS) as Array<[Currency, Pair]>) {
    const item = tickerItem(pair, usdPer, prevUsdPer);
    if (item) out[currency] = item;
  }
  return out;
}

export function formatTickerValue(item: TickerItem, locale: string): string {
  return item.value.toLocaleString(locale === "tr" ? "tr-TR" : "en-US", {
    minimumFractionDigits: item.decimals,
    maximumFractionDigits: item.decimals,
  });
}
