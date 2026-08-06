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
  /** money that routinely passes through here on its way to a bill */
  routine: boolean;
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
  /** the account it lands in; without one the projection picks a home */
  accountId?: string | null;
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
 * Balances are carried per account, so net worth is always the sum of what you
 * actually hold. An optional `ratePath` (the planner's devaluation assumption)
 * revalues those balances as well as what flows in — a lira balance really
 * does lose value over ten years — and `funding` decides which of them get
 * sold when a month overdraws one.
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
    /** accounts whose draws are routine conversions, not raids on savings */
    routine?: string[];
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
      accountId: extra.accountId ?? undefined,
      direction: extra.direction,
      amount: extra.amount,
      currency: extra.currency,
      isTransfer: false,
      categoryId: extra.categoryId,
      label: extra.label,
    });
  }

  // One ledger, per account. Net worth is the sum of it, revalued each month,
  // so "what I'm worth" and "what I have left to sell" can never drift apart —
  // which is the whole point once a plan starts eating into savings.
  const skipped = new Set(skippedAccountIds);
  const live = accounts.filter((a) => !a.archived && !skipped.has(a.id));
  const balance = new Map<string, number>(live.map((a) => [a.id, balances.get(a.id) ?? 0]));
  const kindOf = new Map(live.map((a) => [a.id, a.kind] as const));

  /**
   * A hypothetical flow has no real account, so it lands on the account that
   * would really carry it: the first funding source in its currency, else the
   * biggest balance in that currency, else a placeholder for that currency.
   */
  const homeFor = (currency: Currency): string => {
    const ranked = (funding?.order ?? []).find(
      (id) => currencyOf.get(id) === currency && balance.has(id)
    );
    if (ranked) return ranked;
    const inCurrency = live.filter((a) => a.currency === currency && a.kind !== "credit_card");
    if (inCurrency.length > 0) {
      return inCurrency.reduce((best, a) =>
        (balance.get(a.id) ?? 0) > (balance.get(best.id) ?? 0) ? a : best
      ).id;
    }
    const placeholder = `virtual:${currency}`;
    if (!balance.has(placeholder)) {
      balance.set(placeholder, 0);
      currencyOf.set(placeholder, currency);
    }
    return placeholder;
  };

  const valueOf = (rates: UsdPerMap): number => {
    let total = 0;
    for (const [id, amount] of balance) {
      const converted = convert(amount, currencyOf.get(id)!, display, rates);
      if (converted != null) total += converted;
    }
    return total;
  };

  // the assets you'll allow to be sold, in the order you'd sell them
  const sourceOrder = (funding?.order ?? []).filter((id) => {
    const a = live.find((acc) => acc.id === id);
    return a != null && a.kind !== "credit_card";
  });
  const sourceCurrency = new Map<string, Currency>(
    sourceOrder.map((id) => [id, currencyOf.get(id)!])
  );
  const routineSources = new Set(funding?.routine ?? []);

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
      const signed = f.direction === "income" ? f.amount : -f.amount;
      // every flow lands on a real account, so the ledger stays the truth
      const acct = f.accountId != null && balance.has(f.accountId) ? f.accountId : homeFor(f.currency);
      balance.set(acct, (balance.get(acct) ?? 0) + signed);

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

    // An account the month has overdrawn has to be topped up out of something
    // you actually hold. Selling never changes what you're worth — it changes
    // what you're holding, which is what matters once the lira is sliding —
    // so this is a transfer, and when there's nothing left to transfer the
    // account simply stays overdrawn and the month is reported as unpaid.
    const draws: FundingDraw[] = [];
    let uncovered = 0;
    const first = funding?.overrides?.[month];
    const order =
      first && sourceOrder.includes(first)
        ? [first, ...sourceOrder.filter((id) => id !== first)]
        : sourceOrder;

    for (const [id, amount] of balance) {
      // card debt is debt, not an overdraft to be covered by selling gold
      if (amount >= 0 || kindOf.get(id) === "credit_card") continue;
      const short = currencyOf.get(id)!;
      let owed = -amount; // in the overdrawn account's own currency

      for (const from of order) {
        if (owed <= 1e-9 || from === id) continue;
        const available = balance.get(from) ?? 0;
        if (available <= 0) continue;
        const fromCurrency = sourceCurrency.get(from)!;
        const needed = convert(owed, short, fromCurrency, rates);
        if (needed == null || needed <= 0) continue;
        const take = Math.min(available, needed);
        const bought = convert(take, fromCurrency, short, rates);
        if (bought == null || bought <= 0) continue;

        balance.set(from, available - take);
        balance.set(id, (balance.get(id) ?? 0) + bought);
        owed -= bought;
        const value = convert(take, fromCurrency, display, rates);
        draws.push({
          accountId: from,
          currency: fromCurrency,
          amount: take,
          value: value ?? 0,
          routine: routineSources.has(from),
        });
      }

      if (owed > 1e-9) {
        const left = convert(owed, short, display, rates);
        if (left != null) uncovered += left;
      }
    }

    result.push({
      month,
      income,
      expense,
      net: income - expense,
      endNetWorth: valueOf(rates),
      // what the month came up short by, before anything was sold to cover it
      shortfall: Math.max(0, expense - income),
      draws,
      uncovered,
      sourceBalances: Object.fromEntries(sourceOrder.map((id) => [id, balance.get(id) ?? 0])),
      expenseByCategory,
      lines,
    });
  });

  return { startNetWorth, months: result, skippedAccountIds };
}
