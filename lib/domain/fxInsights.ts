import { Account, Transaction } from "@/lib/data/types";
import { Currency } from "./currencies";
import { convert, effectiveRate, spreadPct, UsdPerMap } from "./fx";

export interface ConversionRecord {
  date: string;
  fromAccountId: string;
  toAccountId: string;
  fromAmount: number;
  fromCurrency: Currency;
  toAmount: number;
  toCurrency: Currency;
  /** dst per src actually received */
  effective: number;
  /** market rate stored at transfer time (null when entered without one) */
  market: number | null;
  /** effective vs market, % (negative = worse than market) */
  spread: number | null;
  /** money lost vs market, in the destination currency */
  spreadCost: number | null;
}

export interface FxInsights {
  conversions: ConversionRecord[];
  avgSpreadPct: number | null;
  /** total lost to spread, converted to the display currency at current rates */
  totalSpreadCost: number;
  best: ConversionRecord | null;
  worst: ConversionRecord | null;
}

/**
 * How well cross-currency transfers were executed: effective vs market rate
 * per conversion, average spread, and the total cost of the spread. Only
 * cross-currency pairs count; the market rate comes from the transfer
 * (falling back to the transfer's own fx snapshot when it wasn't stored).
 */
export function computeFxInsights(params: {
  transactions: Transaction[];
  accounts: Account[];
  usdPer: UsdPerMap;
  display: Currency;
}): FxInsights {
  const { transactions, accounts, usdPer, display } = params;
  const currencyOf = new Map(accounts.map((a) => [a.id, a.currency] as const));

  const byGroup = new Map<string, Transaction[]>();
  for (const t of transactions) {
    if (t.transferGroupId && t.status === "completed") {
      byGroup.set(t.transferGroupId, [...(byGroup.get(t.transferGroupId) ?? []), t]);
    }
  }

  const conversions: ConversionRecord[] = [];
  for (const legs of byGroup.values()) {
    const out = legs.find((l) => l.direction === "expense");
    const inc = legs.find((l) => l.direction === "income");
    if (!out || !inc) continue;
    const fromCurrency = currencyOf.get(out.accountId);
    const toCurrency = currencyOf.get(inc.accountId);
    if (!fromCurrency || !toCurrency || fromCurrency === toCurrency) continue;
    const effective = effectiveRate(out.amount, inc.amount);
    if (effective == null) continue;
    // market rate: stored at entry, else derived from the snapshot frozen on the transfer
    let market = out.transferMarketRate;
    if (market == null && out.fxSnapshot) {
      const viaSnapshot = convert(1, fromCurrency, toCurrency, out.fxSnapshot.usdPer);
      market = viaSnapshot ?? null;
    }
    const spread = market != null && market !== 0 ? spreadPct(market, effective) : null;
    const spreadCost = market != null ? market * out.amount - inc.amount : null;
    conversions.push({
      date: out.dueDate,
      fromAccountId: out.accountId,
      toAccountId: inc.accountId,
      fromAmount: out.amount,
      fromCurrency,
      toAmount: inc.amount,
      toCurrency,
      effective,
      market,
      spread,
      spreadCost,
    });
  }
  conversions.sort((a, b) => (a.date < b.date ? 1 : -1));

  const withSpread = conversions.filter((c) => c.spread != null);
  const avgSpreadPct = withSpread.length
    ? withSpread.reduce((s, c) => s + (c.spread ?? 0), 0) / withSpread.length
    : null;
  let totalSpreadCost = 0;
  for (const c of conversions) {
    if (c.spreadCost == null || c.spreadCost <= 0) continue;
    const converted = convert(c.spreadCost, c.toCurrency, display, usdPer);
    if (converted != null) totalSpreadCost += converted;
  }
  const sortedBySpread = [...withSpread].sort((a, b) => (b.spread ?? 0) - (a.spread ?? 0));
  return {
    conversions,
    avgSpreadPct,
    totalSpreadCost,
    best: sortedBySpread[0] ?? null,
    worst: sortedBySpread[sortedBySpread.length - 1] ?? null,
  };
}
