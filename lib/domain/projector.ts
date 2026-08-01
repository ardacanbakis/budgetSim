import { Account, RecurringTemplate, Transaction } from "@/lib/data/types";
import { Currency } from "./currencies";
import { convert, UsdPerMap } from "./fx";
import { computeBalances, computeNetWorth } from "./balances";
import { addMonthsClamped, occurrencesBetween } from "./recurrence";

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
}

/**
 * Cashflow projection over an arbitrary horizon (1–120 months) in the display
 * currency, using current rates (documented simplification — no FX
 * forecasting). Sources of flow:
 * planned transactions, plus recurring-template occurrences that have no
 * materialized planned transaction yet (deduped by template+date).
 * Transfer legs cancel out in a single net-worth view and are excluded.
 */
export function projectCashflow(params: {
  accounts: Account[];
  transactions: Transaction[];
  templates: RecurringTemplate[];
  usdPer: UsdPerMap;
  display: Currency;
  fromDate: string; // yyyy-mm-dd
  months: number;
}): ProjectionResult {
  const { accounts, transactions, templates, usdPer, display, fromDate, months } = params;
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
      });
    }
  }

  const buckets = new Map<string, { income: number; expense: number; expenseByCategory: Record<string, number> }>();
  for (let i = 0; i < months; i++) {
    buckets.set(addMonthsClamped(fromDate, i).slice(0, 7), { income: 0, expense: 0, expenseByCategory: {} });
  }
  for (const f of flows) {
    if (f.isTransfer) continue;
    const bucket = buckets.get(f.date.slice(0, 7));
    if (!bucket) continue;
    const converted = convert(f.amount, f.currency, display, usdPer);
    if (converted == null) continue;
    if (f.direction === "income") bucket.income += converted;
    else {
      bucket.expense += converted;
      bucket.expenseByCategory[f.categoryId] = (bucket.expenseByCategory[f.categoryId] ?? 0) + converted;
    }
  }

  let running = startNetWorth;
  const result: ProjectionMonth[] = [];
  for (const [month, { income, expense, expenseByCategory }] of buckets) {
    const net = income - expense;
    running += net;
    result.push({ month, income, expense, net, endNetWorth: running, expenseByCategory });
  }

  return { startNetWorth, months: result, skippedAccountIds };
}
