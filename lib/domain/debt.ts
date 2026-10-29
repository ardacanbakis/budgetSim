import { Account, Loan, LoanDirection, Transaction, TxDirection } from "@/lib/data/types";
import { buildCardBook } from "./cards";
import { Currency } from "./currencies";
import { convert, UsdPerMap } from "./fx";
import { buildSchedule, ScheduleResult } from "./loanSchedule";
import { roundTo } from "./money";
import { addDays } from "./recurrence";

/**
 * Debts, in both directions: what you borrowed (from a bank or a person) and
 * what you lent. A debt is a Loan; its rows are the transactions carrying its
 * id: the money itself (borrowed into, or lent out of, the deposit account)
 * and the repayments (out of the paying account for one you owe, into it for
 * one you lent). The two are told apart by direction alone.
 *
 * - loanProgress(loan, transactions): what's left, how far along, when it ends.
 * - computeDebtOverview(...): everything you owe (tracked debts and cards) and
 *   everything owed to you.
 * - replanRepayments(loan, transactions, today): the planned rows a debt
 *   should have after an edit, as a diff for the repos to apply.
 */

export interface DebtItem {
  kind: "loan" | "card";
  id: string;
  name: string;
  currency: Currency;
  /** "lent": owed to you; a card is always "owe" */
  direction: LoanDirection;
  /** outstanding amount in its own currency */
  outstanding: number;
  /** monthly interest %; null for cards (unknown) */
  monthlyRatePct: number | null;
  /** last scheduled payment date; null for a card with nothing billed, and for "when I can" */
  endDate: string | null;
}

export interface DebtOverview {
  items: DebtItem[];
  /** what you owe in display currency (debts you owe + what each card is owed) */
  totalInDisplay: number;
  /** what you're owed in display currency (debts you lent) */
  lentInDisplay: number;
  /** latest scheduled payment across what you owe, i.e. the debt-free date */
  debtFreeDate: string | null;
  /** avalanche: highest-rate debt to attack first */
  avalancheTarget: DebtItem | null;
}

/** A loan as stored before migration 0019 (or in an older backup) is a debt you owe, with nothing else known. */
export function withDebtDefaults(loan: Omit<Loan, "direction" | "counterparty" | "depositAccountId" | "payAccountId" | "payoffDate"> & Partial<Loan>): Loan {
  return {
    ...loan,
    direction: loan.direction === "lent" ? "lent" : "owe",
    counterparty: loan.counterparty ?? null,
    depositAccountId: loan.depositAccountId ?? null,
    payAccountId: loan.payAccountId ?? null,
    payoffDate: loan.payoffDate ?? null,
  };
}

/** Which way a debt's repayments move: out for one you owe, in for one you lent. */
export function repaymentDirection(loan: Pick<Loan, "direction">): TxDirection {
  return loan.direction === "lent" ? "income" : "expense";
}

/** A debt's own rows, apart: the money borrowed or lent, and the repayments. */
export function debtRows(loan: Pick<Loan, "id" | "direction">, transactions: readonly Transaction[]): { money: Transaction[]; repayments: Transaction[] } {
  const back = repaymentDirection(loan);
  const own = transactions.filter((t) => t.loanId === loan.id);
  return { money: own.filter((t) => t.direction !== back), repayments: own.filter((t) => t.direction === back) };
}

/** The repayment schedule a debt was made with: its own shape and levies; a lumpSum's one payment. */
export function scheduleOf(loan: Loan): ScheduleResult {
  return buildSchedule({
    kind: loan.scheduleKind,
    principal: loan.principal,
    monthlyRatePct: loan.monthlyRatePct,
    termMonths: loan.termMonths,
    startDate: loan.startDate,
    currency: loan.currency,
    kkdfPct: loan.kkdfPct,
    bsmvPct: loan.bsmvPct,
    customInstalments: loan.customInstalments ?? undefined,
    payoffDate: loan.payoffDate,
  });
}

/**
 * Without interest, what's left is what was due less what was paid, so a
 * partial payment or an amount different from the plan counts as it was.
 * With interest, a payment's share of principal depends on the schedule, so
 * what's left follows the schedule row by row.
 */
function amountBased(loan: Loan): boolean {
  return loan.scheduleKind === "lumpSum" || loan.scheduleKind === "zeroInterest" || !(loan.monthlyRatePct > 0);
}

export interface LoanProgress {
  schedule: ScheduleResult;
  /** instalments paid: by amount without interest, else the completed repayments; never more than the schedule has */
  paid: number;
  /** instalments in all (0 for "when I can") */
  term: number;
  /** what's left in the loan's currency: principal still owed with interest, the rest to pay without */
  remaining: number;
  /** repayments made, in the loan's currency */
  paidAmount: number;
  /** what the debt comes to: every scheduled payment, or the principal when there's no schedule yet */
  total: number;
  /** how far along, 0–100, rounded */
  pct: number;
  /** the last payment: the payoff date when there is one, else the schedule's last; null for "when I can" */
  endDate: string | null;
  /** the first repayment still planned, if any */
  nextDue: Transaction | null;
}

/**
 * One debt's standing: its schedule, what's been repaid (completed repayment
 * rows, legacy ones too: they were paid), what's left and when it ends. An
 * early payoff that's been paid ends it whatever the schedule said.
 */
export function loanProgress(loan: Loan, transactions: readonly Transaction[]): LoanProgress {
  const schedule = scheduleOf(loan);
  const term = schedule.rows.length;
  const { repayments } = debtRows(loan, transactions);
  const done = repayments.filter((t) => t.status === "completed");
  const paidAmount = roundTo(
    done.reduce((s, t) => s + t.amount, 0),
    loan.currency
  );
  const total = term > 0 ? schedule.totalPaid : loan.principal;
  const nextDue =
    repayments.filter((t) => t.status === "planned").sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0] ?? null;
  const payoffPaid = loan.payoffDate != null && done.some((t) => t.dueDate >= loan.payoffDate!);
  const endDate = loan.payoffDate ?? (term > 0 ? schedule.rows[term - 1].date : null);

  if (payoffPaid) return { schedule, paid: term, term, remaining: 0, paidAmount, total, pct: 100, endDate, nextDue };

  if (amountBased(loan)) {
    const remaining = Math.max(0, roundTo(total - paidAmount, loan.currency));
    let paid = 0;
    let due = 0;
    for (const row of schedule.rows) {
      due += row.payment;
      if (due <= paidAmount + 0.005) paid++;
    }
    const pct = total > 0 ? Math.round(Math.min(1, paidAmount / total) * 100) : 0;
    return { schedule, paid, term, remaining, paidAmount, total, pct, endDate, nextDue };
  }

  const paid = Math.min(done.length, term);
  const remaining = paid > 0 ? schedule.rows[paid - 1].remaining : loan.principal;
  return { schedule, paid, term, remaining, paidAmount, total, pct: term > 0 ? Math.round((paid / term) * 100) : 0, endDate, nextDue };
}

/** Combined debt picture: tracked debts both ways + what each credit card is owed (see lib/domain/cards.ts). */
export function computeDebtOverview(params: {
  loans: Loan[];
  accounts: Account[];
  balances: Map<string, number>;
  transactions: Transaction[];
  usdPer: UsdPerMap;
  display: Currency;
  today: string;
}): DebtOverview {
  const { loans, accounts, transactions, usdPer, display, today } = params;
  const items: DebtItem[] = [];

  for (const loan of loans) {
    const { remaining, endDate } = loanProgress(loan, transactions);
    if (remaining <= 0.005) continue;
    items.push({
      kind: "loan",
      id: loan.id,
      name: loan.name,
      currency: loan.currency,
      direction: loan.direction,
      outstanding: remaining,
      monthlyRatePct: loan.monthlyRatePct,
      endDate,
    });
  }

  const book = buildCardBook(accounts, transactions);
  for (const account of accounts) {
    if (account.kind !== "credit_card" || account.archived) continue;
    const outstanding = book.owed(account.id, today);
    if (outstanding <= 0.005) continue;
    // the last bill: a payment still to make, or the month an uncovered charge is paid in
    const dates = [
      ...book.payments(account.id).filter((p) => !p.made).map((p) => p.date),
      ...book.uncovered(account.id).map((c) => `${book.paidInMonth(c)}-01`),
    ];
    const lastDue = dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null;
    items.push({
      kind: "card",
      id: account.id,
      name: account.name,
      currency: account.currency,
      direction: "owe",
      outstanding,
      monthlyRatePct: null,
      endDate: lastDue,
    });
  }

  let totalInDisplay = 0;
  let lentInDisplay = 0;
  let debtFreeDate: string | null = null;
  for (const item of items) {
    const converted = convert(item.outstanding, item.currency, display, usdPer);
    if (item.direction === "lent") {
      if (converted != null) lentInDisplay += converted;
      continue;
    }
    if (converted != null) totalInDisplay += converted;
    // a card ends with its last bill, or today when nothing is billed yet; "when I can" has no end to count
    const end = item.kind === "card" ? (item.endDate ?? today) : item.endDate;
    if (end != null && (debtFreeDate == null || end > debtFreeDate)) debtFreeDate = end;
  }

  const rated = items.filter((i) => i.direction === "owe" && i.monthlyRatePct != null && i.monthlyRatePct > 0);
  const avalancheTarget = rated.length
    ? rated.reduce((max, i) => ((i.monthlyRatePct ?? 0) > (max.monthlyRatePct ?? 0) ? i : max))
    : null;

  return { items, totalInDisplay, lentInDisplay, debtFreeDate, avalancheTarget };
}

/**
 * What's left of a debt just before `date`, if everything scheduled before
 * then is paid: the schedule's balance after its last row before that day.
 */
export function remainingBefore(loan: Loan, schedule: ScheduleResult, date: string): number {
  const before = schedule.rows.filter((r) => r.date < date);
  return before.length > 0 ? before[before.length - 1].remaining : loan.principal;
}

export interface PlannedRow {
  dueDate: string;
  amount: number;
  description: string;
}

export interface RepaymentPlan {
  /** planned repayment rows to delete: the ones the new plan replaces */
  remove: string[];
  /** planned repayment rows to add */
  add: PlannedRow[];
  /** the recurring item's new end date; undefined leaves it as it is */
  templateEnd?: string;
}

/**
 * The planned repayments a debt should have, as a change to the ones it has.
 * Paid rows never change; neither does a planned row the new plan keeps.
 *
 * - One payment (lumpSum): what's still due (the total less what was repaid)
 *   on the payoff date; "when I can" plans nothing.
 * - Installments planned by a recurring item: it ends the day before an early
 *   payoff (or runs to the schedule's end again without one), and the payoff
 *   is one row for what's left then.
 * - Installments planned as dated rows: the schedule's rows from today on
 *   that aren't paid, up to an early payoff, and the payoff.
 */
export function replanRepayments(loan: Loan, transactions: readonly Transaction[], today: string): RepaymentPlan {
  const schedule = scheduleOf(loan);
  const { repayments } = debtRows(loan, transactions);
  const planned = repayments.filter((t) => t.status === "planned");
  const done = repayments.filter((t) => t.status === "completed");
  const payoff = loan.payoffDate;

  if (loan.scheduleKind === "lumpSum") {
    const total = schedule.rows.length > 0 ? schedule.totalPaid : loan.principal;
    const left = roundTo(total - done.reduce((s, t) => s + t.amount, 0), loan.currency);
    return {
      remove: planned.map((t) => t.id),
      add: payoff && left > 0.005 ? [{ dueDate: payoff, amount: left, description: loan.name }] : [],
    };
  }

  const payoffRow = (date: string): PlannedRow[] => {
    const left = remainingBefore(loan, schedule, date);
    return left > 0.005 ? [{ dueDate: date, amount: left, description: `${loan.name} payoff` }] : [];
  };

  if (loan.recurringTemplateId) {
    const fromTemplate = (t: Transaction) => t.recurringTemplateId === loan.recurringTemplateId;
    const last = schedule.rows[schedule.rows.length - 1]?.date;
    if (payoff) {
      return {
        // the item's rows from the payoff on, and an earlier payoff row
        remove: planned.filter((t) => (fromTemplate(t) ? t.dueDate >= payoff : t.dueDate >= today)).map((t) => t.id),
        add: payoffRow(payoff),
        templateEnd: addDays(payoff, -1),
      };
    }
    return {
      remove: planned.filter((t) => !fromTemplate(t) && t.dueDate >= today).map((t) => t.id),
      add: [],
      ...(last ? { templateEnd: last } : {}),
    };
  }

  const paidDates = new Set(done.map((t) => t.dueDate));
  const overdue = planned.filter((t) => t.dueDate < today);
  const overdueDates = new Set(overdue.map((t) => t.dueDate));
  const rows = schedule.rows
    .filter((r) => r.date >= today && (!payoff || r.date < payoff) && !paidDates.has(r.date) && !overdueDates.has(r.date))
    .map((r) => ({ dueDate: r.date, amount: r.payment, description: `${loan.name} ${r.n}/${schedule.rows.length}` }));
  return {
    remove: planned.filter((t) => t.dueDate >= today).map((t) => t.id),
    add: [...rows, ...(payoff ? payoffRow(payoff) : [])],
  };
}
