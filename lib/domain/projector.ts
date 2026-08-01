import { Account, RecurringTemplate, Transaction } from "@/lib/data/types";
import { Currency } from "./currencies";
import { convert, UsdPerMap } from "./fx";
import { computeBalances, computeNetWorth } from "./balances";
import { addMonthsClamped, occurrencesBetween } from "./recurrence";

/** One named contribution to a month, in the display currency at that month's rates. */
export interface ProjectionLine {
  label: string;
  direction: "income" | "expense";
  amount: number;
  /** "" when uncategorized — lets the UI fall back to the category name */
  categoryId: string;
}

export interface ProjectionMonth {
  /** yyyy-mm */
  month: string;
  income: number;
  expense: number;
  net: number;
  endNetWorth: number;
  /** expense split by category id ("" = uncategorized), display currency.
   * Lets the planner swap a category's projected spend for a budget you set. */
  expenseByCategory: Record<string, number>;
  /** what made up this month, aggregated by label — drives the expandable
   * timeline rows. Sums to income and expense above. */
  lines: ProjectionLine[];
}

export interface ProjectionResult {
  startNetWorth: number;
  months: ProjectionMonth[];
  /** accounts skipped because their rate is unavailable */
  skippedAccountIds: string[];
}

interface FlowItem {
  date: string;
  direction: "income" | "expense";
  amount: number;
  currency: Currency;
  isTransfer: boolean;
  /** "" when uncategorized */
  categoryId: string;
  /** human name for the expandable breakdown */
  label: string;
}

/** A hypothetical flow the planner injects, already scheduled and priced. */
export interface ExtraFlow {
  /** 0 = the first projected month */
  monthOffset: number;
  direction: "income" | "expense";
  /** in `currency`, nominal for that month */
  amount: number;
  currency: Currency;
  categoryId: string;
  label: string;
}

/**
 * Cashflow projection over an arbitrary horizon (1–120 months) in the display
 * currency. Sources of flow: planned transactions, plus recurring-template
 * occurrences that have no materialized planned transaction yet (deduped by
 * template+date). Transfer legs cancel out in a single net-worth view and are
 * excluded.
 *
 * Holdings are carried per currency rather than as one running total, so an
 * optional `ratePath` (the planner's devaluation assumption) revalues what you
 * already hold as well as what flows in — a lira balance really does lose
 * value over ten years. With no ratePath the rates are constant and the result
 * is identical to summing the monthly nets.
 */
export function projectCashflow(params: {
  accounts: Account[];
  transactions: Transaction[];
  templates: RecurringTemplate[];
  usdPer: UsdPerMap;
  display: Currency;
  fromDate: string; // yyyy-mm-dd
  months: number;
  /** rates for month `offset` (0 = first projected month); defaults to constant */
  ratePath?: (offset: number) => UsdPerMap;
  /** hypothetical flows from the planner */
  extraFlows?: ExtraFlow[];
  /** expense categories whose ledger-projected flows are replaced by a budget */
  replaceCategories?: ReadonlySet<string>;
}): ProjectionResult {
  const {
    accounts,
    transactions,
    templates,
    usdPer,
    display,
    fromDate,
    months,
    ratePath,
    extraFlows,
    replaceCategories,
  } = params;
  const ratesAt = ratePath ?? (() => usdPer);
  const horizonEnd = addMonthsClamped(fromDate, months);
  const currencyOf = new Map(accounts.map((a) => [a.id, a.currency] as const));

  const balances = computeBalances(accounts, transactions);
  const { total: startNetWorth, skippedAccountIds } = computeNetWorth(
    accounts,
    balances,
    usdPer,
    display
  );

  const flows: FlowItem[] = [];
  const materialized = new Set<string>();

  for (const t of transactions) {
    if (t.status !== "planned") continue;
    if (t.dueDate < fromDate || t.dueDate > horizonEnd) continue;
    const currency = currencyOf.get(t.accountId);
    if (!currency) continue;
    if (t.recurringTemplateId) materialized.add(`${t.recurringTemplateId}|${t.dueDate}`);
    flows.push({
      date: t.dueDate,
      direction: t.direction,
      amount: t.amount,
      currency,
      isTransfer: t.transferGroupId != null,
      categoryId: t.categoryId ?? "",
      label: t.description,
    });
  }

  for (const tpl of templates) {
    const currency = currencyOf.get(tpl.accountId);
    if (!currency) continue;
    for (const date of occurrencesBetween(tpl, fromDate, horizonEnd)) {
      if (materialized.has(`${tpl.id}|${date}`)) continue;
      flows.push({
        date,
        direction: tpl.direction,
        amount: tpl.amount,
        currency,
        isTransfer: false,
        categoryId: tpl.categoryId ?? "",
        label: tpl.name,
      });
    }
  }

  // flows grouped by month, kept in their native currency so each month can be
  // valued at that month's rates
  const monthKeys: string[] = [];
  const buckets = new Map<string, FlowItem[]>();
  for (let i = 0; i < months; i++) {
    const key = addMonthsClamped(fromDate, i).slice(0, 7);
    monthKeys.push(key);
    buckets.set(key, []);
  }
  for (const f of flows) {
    if (f.isTransfer) continue;
    // a category with a budget is modelled by that budget instead of by
    // whatever the ledger happens to project for it — no double counting
    if (f.direction === "expense" && replaceCategories?.has(f.categoryId)) continue;
    buckets.get(f.date.slice(0, 7))?.push(f);
  }
  for (const extra of extraFlows ?? []) {
    const key = monthKeys[extra.monthOffset];
    if (key == null) continue;
    buckets.get(key)?.push({
      date: key,
      direction: extra.direction,
      amount: extra.amount,
      currency: extra.currency,
      isTransfer: false,
      categoryId: extra.categoryId,
      label: extra.label,
    });
  }

  // what you already hold, per currency — this is what devaluation revalues
  const holdings = new Map<Currency, number>();
  const skipped = new Set(skippedAccountIds);
  for (const a of accounts) {
    if (a.archived || skipped.has(a.id)) continue;
    holdings.set(a.currency, (holdings.get(a.currency) ?? 0) + (balances.get(a.id) ?? 0));
  }

  const valueOf = (rates: UsdPerMap): number => {
    let total = 0;
    for (const [currency, amount] of holdings) {
      const converted = convert(amount, currency, display, rates);
      if (converted != null) total += converted;
    }
    return total;
  };

  const result: ProjectionMonth[] = [];
  monthKeys.forEach((month, offset) => {
    const rates = ratesAt(offset);
    let income = 0;
    let expense = 0;
    const expenseByCategory: Record<string, number> = {};
    // several occurrences of the same thing read better as one line
    const byLabel = new Map<string, ProjectionLine>();
    for (const f of buckets.get(month) ?? []) {
      const converted = convert(f.amount, f.currency, display, rates);
      if (converted == null) continue;
      holdings.set(
        f.currency,
        (holdings.get(f.currency) ?? 0) + (f.direction === "income" ? f.amount : -f.amount)
      );
      if (f.direction === "income") income += converted;
      else {
        expense += converted;
        expenseByCategory[f.categoryId] = (expenseByCategory[f.categoryId] ?? 0) + converted;
      }
      const key = `${f.direction}|${f.categoryId}|${f.label}`;
      const line = byLabel.get(key);
      if (line) line.amount += converted;
      else byLabel.set(key, { label: f.label, direction: f.direction, amount: converted, categoryId: f.categoryId });
    }
    const lines = [...byLabel.values()].sort((a, b) => b.amount - a.amount);
    result.push({
      month,
      income,
      expense,
      net: income - expense,
      endNetWorth: valueOf(rates),
      expenseByCategory,
      lines,
    });
  });

  return { startNetWorth, months: result, skippedAccountIds };
}
