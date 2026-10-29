import { Account, Loan, RecurringTemplate, Transaction } from "@/lib/data/types";
import { Currency } from "./currencies";
import { debtRows, loanProgress, remainingBefore, scheduleOf } from "./debt";
import { convert, UsdPerMap } from "./fx";
import { GoldRatios } from "./gold";
import { roundTo } from "./money";
import { ProjectionMonth, projectCashflow } from "./projector";
import { addDays, addMonthsClamped } from "./recurrence";

/**
 * When a debt you owe can be repaid in one payment: the first month that
 * paying what's left then doesn't leave a later month short, and doesn't sell
 * anything you'd rather keep (gold, dollars: whatever isn't a routine account
 * in your plan's funding order) that the plan wouldn't have sold anyway.
 *
 * Each candidate month is checked with the projector (lib/domain/projector.ts)
 * against the debt as it's planned now: its installments before that month
 * stay, the ones after it go, and one payment of what's left is added, out of
 * the account the debt is paid from. "If you allow selling" is the first
 * month it can be paid at all, with what that sells; it's offered only when
 * it's earlier.
 */

export interface PayoffSale {
  accountId: string;
  currency: Currency;
  /** sold beyond what the plan sells anyway, in the account's own currency */
  amount: number;
}

export interface PayoffOption {
  /** yyyy-mm */
  month: string;
  /** the month's last day: the date the payment is planned on */
  date: string;
  /** what's left to pay by then, in the debt's currency */
  amount: number;
  /** what it sells that the plan wouldn't (empty without selling) */
  sells: PayoffSale[];
}

export interface PayoffSuggestion {
  withoutSelling: PayoffOption | null;
  /** earlier than withoutSelling, or the only option */
  ifSelling: PayoffOption | null;
}

export interface PayoffInput {
  loan: Loan;
  accounts: Account[];
  transactions: Transaction[];
  templates: RecurringTemplate[];
  usdPer: UsdPerMap;
  goldRatios?: GoldRatios;
  display: Currency;
  today: string;
  /** the plan's funding order and routine accounts (lib/domain/planner.ts planFundingOrder) */
  funding: { order: string[]; routine: string[] };
  /** a month short by less than this (display currency) isn't short */
  threshold: number;
  /** months to look for a payoff in, this one first */
  months?: number;
}

const NONE: PayoffSuggestion = { withoutSelling: null, ifSelling: null };
/** months checked after the latest candidate, so a payoff that empties an account too early shows */
const AFTER = 6;

function lastDayOf(month: string): string {
  return addDays(addMonthsClamped(`${month}-01`, 1), -1);
}

function sold(month: ProjectionMonth): Map<string, { currency: Currency; amount: number; value: number }> {
  const out = new Map<string, { currency: Currency; amount: number; value: number }>();
  for (const d of month.draws) {
    if (d.routine) continue;
    const prev = out.get(d.accountId) ?? { currency: d.currency, amount: 0, value: 0 };
    out.set(d.accountId, { currency: d.currency, amount: prev.amount + d.amount, value: prev.value + d.value });
  }
  return out;
}

export function suggestPayoff(input: PayoffInput): PayoffSuggestion {
  const { loan, accounts, transactions, templates, usdPer, goldRatios, display, today, funding, threshold } = input;
  if (loan.direction !== "owe") return NONE;
  const progress = loanProgress(loan, transactions);
  if (progress.remaining <= 0.005) return NONE;

  const template = loan.recurringTemplateId ? templates.find((t) => t.id === loan.recurringTemplateId) : undefined;
  const { repayments } = debtRows(loan, transactions);
  const payFrom = accounts.find(
    (a) => a.id === (loan.payAccountId ?? template?.accountId ?? repayments[0]?.accountId) && a.kind !== "credit_card" && !a.archived
  );
  if (!payFrom) return NONE;

  const candidates = input.months ?? 24;
  const horizon = candidates + AFTER;
  const schedule = scheduleOf(loan);
  const done = repayments.filter((t) => t.status === "completed");
  const planned = repayments.filter((t) => t.status === "planned");
  const amountBased = loan.scheduleKind === "lumpSum" || loan.scheduleKind === "zeroInterest" || !(loan.monthlyRatePct > 0);
  const total = schedule.rows.length > 0 ? schedule.totalPaid : loan.principal;
  const common = { accounts, usdPer, goldRatios, display, fromDate: today, months: horizon, funding };

  // the debt as it's planned now: what a payoff is measured against
  const asIs = projectCashflow({ ...common, transactions, templates });

  /** what's left to pay on `date` when every repayment planned before it is made */
  const leftOn = (date: string): number => {
    if (!amountBased) return remainingBefore(loan, schedule, date);
    const paid = done.reduce((s, t) => s + t.amount, 0);
    // an overdue row isn't in the projection (it's past): it's still owed
    const before = planned.filter((t) => t.dueDate >= today && t.dueDate < date).reduce((s, t) => s + t.amount, 0);
    // a recurring item's months not yet on the ledger
    const fromTemplate = template
      ? schedule.rows.filter((r) => r.date >= today && r.date < date && !repayments.some((t) => t.dueDate === r.date)).reduce((s, r) => s + r.payment, 0)
      : 0;
    return roundTo(total - paid - before - fromTemplate, loan.currency);
  };

  let ifSelling: PayoffOption | null = null;
  for (let k = 0; k < candidates; k++) {
    const month = asIs.months[k]?.month;
    if (!month) break;
    const date = lastDayOf(month);
    const amount = leftOn(date);
    if (amount <= 0.005) break;
    // in the paying account's own currency, at today's rates
    const paid = payFrom.currency === loan.currency ? amount : convert(amount, loan.currency, payFrom.currency, usdPer);
    if (paid == null) return NONE;

    const removed = new Set(planned.filter((t) => t.dueDate >= date || t.dueDate < today).map((t) => t.id));
    const withPayoff = projectCashflow({
      ...common,
      transactions: transactions.filter((t) => !removed.has(t.id)),
      templates: template
        ? templates.map((t) => (t.id === template.id ? { ...t, endDate: addDays(date, -1) < (t.endDate ?? "9999") ? addDays(date, -1) : t.endDate } : t))
        : templates,
      extraFlows: [{ monthOffset: k, direction: "expense", amount: paid, currency: payFrom.currency, accountId: payFrom.id, categoryId: "", label: loan.name }],
    });

    let short = false;
    let sells = false;
    const extra = new Map<string, PayoffSale>();
    for (let i = k; i < horizon; i++) {
      const a = asIs.months[i];
      const b = withPayoff.months[i];
      if (!a || !b) break;
      if (b.uncovered > a.uncovered + threshold) short = true;
      const before = sold(a);
      for (const [accountId, s] of sold(b)) {
        const was = before.get(accountId);
        if (s.value <= (was?.value ?? 0) + threshold) continue;
        sells = true;
        const more = s.amount - (was?.amount ?? 0);
        const prev = extra.get(accountId);
        extra.set(accountId, { accountId, currency: s.currency, amount: (prev?.amount ?? 0) + more });
      }
    }
    if (short) continue;
    const option = { month, date, amount, sells: [] as PayoffSale[] };
    if (!sells) return { withoutSelling: option, ifSelling };
    ifSelling ??= { ...option, sells: [...extra.values()] };
  }
  return { withoutSelling: null, ifSelling };
}
