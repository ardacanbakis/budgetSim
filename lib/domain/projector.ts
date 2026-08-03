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

/** An asset sold during a month to keep that month's bills paid. */
export interface FundingDraw {
  accountId: string;
  currency: Currency;
  /** taken out, in the account's own currency */
  amount: number;
  /** what that was worth in the display currency, at this month's rates */
  value: number;
}

export interface ProjectionMonth {
  /** yyyy-mm */
  month: string;
  income: number;
  expense: number;
  net: number;
  endNetWorth: number;
  /** what this month's bills came up short by before selling anything, display currency */
  shortfall: number;
  /** the assets sold to close that gap */
  draws: FundingDraw[];
  /** still short after selling everything you allowed, display currency */
  uncovered: number;
  /** end-of-month balance of each funding source, in its own currency */
  sourceBalances: Record<string, number>;
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
  /** the real account it lands on; absent for the planner's hypothetical flows */
  accountId?: string;
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
  /** income categories to drop entirely — "what if I lost this income" */
  dropIncomeCategories?: ReadonlySet<string>;
  /**
   * Which assets may be sold to cover a month that doesn't pay for itself, and
   * in what order. Without this a currency simply goes negative and stays
   * there; with it, the projection sells the way you actually would.
   */
  funding?: {
    /** account ids, highest priority first */
    order: string[];
    /** month key ("yyyy-MM") → account to raid first, overriding the order */
    overrides?: Record<string, string>;
  };
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
    dropIncomeCategories,
    funding,
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
      accountId: t.accountId,
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
        accountId: tpl.accountId,
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
    // "lose this income": the category stops arriving altogether
    if (f.direction === "income" && dropIncomeCategories?.has(f.categoryId)) continue;
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

  // Funding sources, tracked per account so the timeline can say *which* asset
  // paid. A source can never give up more than its own currency pool holds —
  // the pool is the truth, the per-account figure just attributes it.
  const sourceOrder = (funding?.order ?? []).filter((id) => {
    const a = accounts.find((acc) => acc.id === id);
    return a != null && !a.archived && !skipped.has(id) && a.kind !== "credit_card";
  });
  const sourceBalance = new Map<string, number>(
    sourceOrder.map((id) => [id, balances.get(id) ?? 0])
  );
  const sourceCurrency = new Map<string, Currency>(
    sourceOrder.map((id) => [id, currencyOf.get(id)!])
  );

  const result: ProjectionMonth[] = [];
  monthKeys.forEach((month, offset) => {
    const rates = ratesAt(offset);
    let income = 0;
    let expense = 0;
    const expenseByCategory: Record<string, number> = {};
    // what each currency took in minus what it paid out this month — the
    // deficit that has to come from somewhere
    const monthFlow = new Map<Currency, number>();
    // several occurrences of the same thing read better as one line
    const byLabel = new Map<string, ProjectionLine>();
    for (const f of buckets.get(month) ?? []) {
      const converted = convert(f.amount, f.currency, display, rates);
      if (converted == null) continue;
      const signed = f.direction === "income" ? f.amount : -f.amount;
      holdings.set(f.currency, (holdings.get(f.currency) ?? 0) + signed);
      monthFlow.set(f.currency, (monthFlow.get(f.currency) ?? 0) + signed);
      // a source account also grows and shrinks with what actually lands on
      // it; a hypothetical flow lands on the first source in its currency
      const target =
        f.accountId != null && sourceBalance.has(f.accountId)
          ? f.accountId
          : sourceOrder.find((id) => sourceCurrency.get(id) === f.currency);
      if (target != null) sourceBalance.set(target, (sourceBalance.get(target) ?? 0) + signed);
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

    // A month that takes in less than it spends has to be paid for out of
    // something you already hold. Each currency that ran a deficit is covered
    // from the assets you allowed, in the order you set — paying out of a lira
    // account just draws that account down, while paying out of gold or
    // dollars also shifts what you're holding, which is what really matters
    // once the lira is sliding. Selling never changes what you're worth.
    const draws: FundingDraw[] = [];
    let shortfall = 0;
    let uncovered = 0;
    const first = funding?.overrides?.[month];
    const tryOrder =
      first && sourceOrder.includes(first)
        ? [first, ...sourceOrder.filter((id) => id !== first)]
        : sourceOrder;

    // Only a month that ends down needs funding. A month that takes in more
    // than it spends pays for itself, even if one currency ran dry and another
    // piled up — that's a conversion you'd make without thinking about it.
    shortfall = Math.max(0, expense - income);
    if (shortfall > 1e-9) {
      // the deficit currencies, and how much of the gap each one accounts for
      const gaps: { currency: Currency; share: number }[] = [];
      let gapTotal = 0;
      for (const [currency, flow] of monthFlow) {
        if (flow >= 0) continue;
        const value = convert(-flow, currency, display, rates);
        if (value == null || value <= 0) continue;
        gaps.push({ currency, share: value });
        gapTotal += value;
      }

      let remaining = shortfall; // still to be found, in the display currency
      for (const id of tryOrder) {
        if (remaining <= 1e-9) break;
        const from = sourceCurrency.get(id)!;
        const available = sourceBalance.get(id) ?? 0;
        if (available <= 0) continue;
        const needed = convert(remaining, display, from, rates);
        if (needed == null || needed <= 0) continue;
        const take = Math.min(available, needed);
        const value = convert(take, from, display, rates);
        if (value == null || value <= 0) continue;

        sourceBalance.set(id, available - take);
        holdings.set(from, (holdings.get(from) ?? 0) - take);
        // the money lands back in whatever ran short, so what you're worth is
        // unchanged by the sale — only what you're holding moves
        for (const gap of gaps) {
          const slice = gapTotal > 0 ? (value * gap.share) / gapTotal : value;
          const inGapCurrency = convert(slice, display, gap.currency, rates);
          if (inGapCurrency != null) {
            holdings.set(gap.currency, (holdings.get(gap.currency) ?? 0) + inGapCurrency);
          }
        }
        remaining -= value;
        draws.push({ accountId: id, currency: from, amount: take, value });
      }
      uncovered = Math.max(0, remaining);
    }

    result.push({
      month,
      income,
      expense,
      net: income - expense,
      endNetWorth: valueOf(rates),
      shortfall,
      draws,
      uncovered,
      sourceBalances: Object.fromEntries(sourceBalance),
      expenseByCategory,
      lines,
    });
  });

  return { startNetWorth, months: result, skippedAccountIds };
}
