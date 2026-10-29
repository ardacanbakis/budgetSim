import { Account, RecurringTemplate, Transaction } from "@/lib/data/types";
import { Currency } from "./currencies";
import { computeFxInsights, ConversionRecord } from "./fxInsights";
import { pairRate, UsdPerMap } from "./fx";
import { roundTo } from "./money";

/**
 * Income paid in one currency and converted into another: a salary paid in
 * dollars that a middleman turns into lira, landing in a lira account. The
 * income item says where it's converted into (convertToAccountId) and from
 * which payday (convertFrom). Each converted payday is two records: the
 * income in its own currency, as before, and a transfer into the lira
 * account for what actually arrived (both legs carry convertsId, the
 * payday's row), so the middleman's cut is a conversion like any other in
 * the FX insights.
 *
 * - usualCut(...): what the middleman usually keeps, from the last few
 *   conversions between the two currencies (their average spread).
 * - expectedArrival(...): what a payday should bring at today's rate less
 *   that cut.
 * - conversionFor(row, ...): the item and account a payday converts into.
 * - pendingConversions(...): paydays done whose lira isn't recorded yet.
 * - conversionCut(...): usualCut for any pair, for the projections.
 * - middlemanCuts(conversions, year): what conversions lost this year, per pair.
 */

/** Conversions the usual cut is read from: the latest ones say most about today's middleman. */
export const CUT_SAMPLES = 3;

/**
 * What a middleman keeps, as a fraction (0.012 = 1.2%): the average spread of
 * the last few completed conversions from `from` into `to`, never below 0.
 * Zero when there are none: the market rate is the best guess then.
 */
export function usualCut(params: CutParams): number {
  return cutFrom(params).cut;
}

interface CutParams {
  transactions: Transaction[];
  accounts: Account[];
  usdPer: UsdPerMap;
  from: Currency;
  to: Currency;
}

/** usualCut, with how many conversions it was read from (0: none, so no cut). */
export function cutFrom(params: CutParams): { cut: number; samples: number } {
  const { transactions, accounts, usdPer, from, to } = params;
  const { conversions } = computeFxInsights({ transactions, accounts, usdPer, display: to });
  const recent = conversions
    .filter((c) => c.fromCurrency === from && c.toCurrency === to && c.spread != null)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, CUT_SAMPLES);
  if (recent.length === 0) return { cut: 0, samples: 0 };
  const avg = recent.reduce((s, c) => s + (c.spread ?? 0), 0) / recent.length;
  // a spread is negative when you got less than the market
  return { cut: Math.max(0, -avg / 100), samples: recent.length };
}

/** usualCut for any pair, as the projections ask for it. */
export function conversionCut(transactions: Transaction[], accounts: Account[], usdPer: UsdPerMap) {
  const cache = new Map<string, number>();
  return (from: Currency, to: Currency): number => {
    const key = `${from}>${to}`;
    if (!cache.has(key)) cache.set(key, usualCut({ transactions, accounts, usdPer, from, to }));
    return cache.get(key)!;
  };
}

/** What `amount` in `from` should bring in `to`, at these rates less the cut; null without a rate. */
export function expectedArrival(amount: number, from: Currency, to: Currency, usdPer: UsdPerMap, cut: number): number | null {
  const rate = pairRate(from, to, usdPer);
  if (rate == null) return null;
  return roundTo(amount * rate * (1 - cut), to);
}

export interface Conversion {
  template: RecurringTemplate;
  /** the account it's converted into */
  to: Account;
  /** the account it's paid into */
  from: Account;
}

/**
 * The item and accounts a payday converts through: an income row of an item
 * converted into another account, in another currency, from that item's
 * first converted payday on. Null for anything else.
 */
export function conversionFor(
  row: Pick<Transaction, "direction" | "recurringTemplateId" | "accountId" | "dueDate" | "legacy">,
  templates: readonly RecurringTemplate[],
  accounts: readonly Account[]
): Conversion | null {
  if (row.direction !== "income" || !row.recurringTemplateId || row.legacy) return null;
  const template = templates.find((t) => t.id === row.recurringTemplateId);
  if (!template?.convertToAccountId) return null;
  if (template.convertFrom && row.dueDate < template.convertFrom) return null;
  const to = accounts.find((a) => a.id === template.convertToAccountId && !a.archived && a.kind !== "credit_card");
  const from = accounts.find((a) => a.id === row.accountId);
  if (!to || !from || to.currency === from.currency) return null;
  return { template, to, from };
}

export interface PendingConversion extends Conversion {
  row: Transaction;
}

/** Paydays done, converted, with nothing recorded yet for what arrived. */
export function pendingConversions(
  transactions: readonly Transaction[],
  templates: readonly RecurringTemplate[],
  accounts: readonly Account[]
): PendingConversion[] {
  const converted = new Set(transactions.map((t) => t.convertsId).filter((id): id is string => id != null));
  const out: PendingConversion[] = [];
  for (const row of transactions) {
    if (row.status !== "completed" || converted.has(row.id)) continue;
    const conversion = conversionFor(row, templates, accounts);
    if (conversion) out.push({ ...conversion, row });
  }
  return out.sort((a, b) => a.row.dueDate.localeCompare(b.row.dueDate));
}

export interface MiddlemanCut {
  from: Currency;
  to: Currency;
  /** what was lost against the market, % (positive = lost) */
  avgPct: number;
  /** lost against the market, in `to` */
  cost: number;
  count: number;
}

/**
 * What conversions lost to the middleman in `year`, per currency pair, most
 * used pair first: the average spread and its cost in the currency received.
 */
export function middlemanCuts(conversions: readonly ConversionRecord[], year: string): MiddlemanCut[] {
  const pairs = new Map<string, MiddlemanCut & { spreadSum: number; spreadCount: number }>();
  for (const c of conversions) {
    if (!c.date.startsWith(year) || c.spread == null) continue;
    const key = `${c.fromCurrency}>${c.toCurrency}`;
    const p = pairs.get(key) ?? { from: c.fromCurrency, to: c.toCurrency, avgPct: 0, cost: 0, count: 0, spreadSum: 0, spreadCount: 0 };
    p.count++;
    p.spreadSum += c.spread;
    p.spreadCount++;
    p.cost += c.spreadCost ?? 0;
    pairs.set(key, p);
  }
  return [...pairs.values()]
    .map(({ spreadSum, spreadCount, ...p }) => ({ ...p, avgPct: -spreadSum / spreadCount, cost: roundTo(p.cost, p.to) }))
    .sort((a, b) => b.count - a.count);
}
