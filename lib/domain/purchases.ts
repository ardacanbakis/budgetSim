import { Account, Purchase, Transaction } from "@/lib/data/types";
import { Currency } from "./currencies";
import { convert, UsdPerMap } from "./fx";
import { fromMinor, toMinor } from "./money";
import { addMonthsClamped } from "./recurrence";

export interface InstallmentRow {
  n: number;
  dueDate: string;
  amount: number;
}

/**
 * Equal monthly split (taksit): amount ÷ count in minor units, last row
 * absorbs the rounding remainder so the rows always sum to the exact total.
 * Dates step monthly from firstDue with month-end clamping.
 */
export function buildInstallmentPlan(params: {
  amount: number;
  currency: Currency;
  count: number;
  firstDue: string;
}): InstallmentRow[] {
  const { amount, currency, count, firstDue } = params;
  if (count < 1) return [];
  const totalMinor = toMinor(amount, currency);
  const baseMinor = Math.floor(totalMinor / count);
  const rows: InstallmentRow[] = [];
  let assigned = 0;
  for (let n = 1; n <= count; n++) {
    const minor = n === count ? totalMinor - assigned : baseMinor;
    assigned += minor;
    rows.push({ n, dueDate: addMonthsClamped(firstDue, n - 1), amount: fromMinor(minor, currency) });
  }
  return rows;
}

/** Default first-due: one month after purchase (how taksit hits the next statement). */
export function defaultFirstDue(purchaseDate: string): string {
  return addMonthsClamped(purchaseDate, 1);
}

export function lastDueDate(firstDue: string, count: number): string {
  return addMonthsClamped(firstDue, Math.max(0, count - 1));
}

export interface PurchaseTxSpec {
  amount: number;
  dueDate: string;
  status: "planned" | "completed";
  /** true = settled before this app was in use; excluded from balances */
  legacy: boolean;
  description: string;
}

/**
 * The transactions a reflected purchase generates: a single completed expense
 * for one-shots, or one row per installment — rows already due (<= today)
 * completed, the rest planned. Installment rows from earlier calendar months
 * are additionally flagged legacy: those statements were settled before the
 * purchase was logged here, so they show in history and progress but never
 * move balances. Current-month rows post normally — they belong to the still
 * unpaid statement. One-shots always post (log an old one-shot unreflected if
 * it shouldn't). Used identically by both repos.
 */
export function buildPurchaseTransactionSpecs(
  purchase: Pick<Purchase, "name" | "amount" | "installmentCount" | "purchaseDate" | "firstDue">,
  currency: Currency,
  today: string
): PurchaseTxSpec[] {
  if (purchase.installmentCount <= 1) {
    return [
      { amount: purchase.amount, dueDate: purchase.purchaseDate, status: "completed", legacy: false, description: purchase.name },
    ];
  }
  return buildInstallmentPlan({
    amount: purchase.amount,
    currency,
    count: purchase.installmentCount,
    firstDue: purchase.firstDue,
  }).map((row) => ({
    amount: row.amount,
    dueDate: row.dueDate,
    status: row.dueDate <= today ? ("completed" as const) : ("planned" as const),
    legacy: row.dueDate.slice(0, 7) < today.slice(0, 7),
    description: `${purchase.name} (${row.n}/${purchase.installmentCount})`,
  }));
}

export interface PurchaseProgress {
  paidCount: number;
  paidAmount: number;
  remainingAmount: number;
  totalCount: number;
}

/** Progress from the purchase's linked transactions (reflected purchases only have them). */
export function purchaseProgress(purchase: Purchase, transactions: Transaction[], currency: Currency): PurchaseProgress {
  const linked = transactions.filter((t) => t.purchaseId === purchase.id);
  let paidMinor = 0;
  let paidCount = 0;
  for (const t of linked) {
    if (t.status === "completed") {
      paidCount += 1;
      paidMinor += toMinor(t.amount, currency);
    }
  }
  const paidAmount = fromMinor(paidMinor, currency);
  return {
    paidCount,
    paidAmount,
    remainingAmount: fromMinor(toMinor(purchase.amount, currency) - paidMinor, currency),
    totalCount: purchase.installmentCount,
  };
}

/**
 * "Counts as debt now": every remaining (planned) installment of a reflected
 * purchase, converted to the display currency. Subtracted from the current
 * net-worth stat only — the projector already spreads these month by month,
 * so applying it there too would double-count.
 */
export function computePurchaseLiability(
  transactions: Transaction[],
  accounts: Account[],
  usdPer: UsdPerMap,
  display: Currency
): number {
  const currencyOf = new Map(accounts.map((a) => [a.id, a.currency] as const));
  let total = 0;
  for (const t of transactions) {
    if (t.purchaseId == null || t.status !== "planned" || t.direction !== "expense") continue;
    const currency = currencyOf.get(t.accountId);
    if (!currency) continue;
    const converted = convert(t.amount, currency, display, usdPer);
    if (converted != null) total += converted;
  }
  return total;
}

export interface DueCardPayment {
  account: Account;
  /** what the statement likely totals: posted debt + installments due by month end */
  suggestedAmount: number;
  postedDebt: number;
  /** planned purchase installments on the card due this month (or overdue) —
   * recording the payment marks these completed so the statement stays in sync */
  installmentsDue: Transaction[];
}

/**
 * Cards that look unpaid this month: posted debt from an earlier statement
 * (balance < 0 with an older completed expense) OR purchase installments due
 * this month, and no incoming transfer leg this calendar month.
 */
export function findDueCardPayments(
  accounts: Account[],
  balances: Map<string, number>,
  transactions: Transaction[],
  today: string
): DueCardPayment[] {
  const month = today.slice(0, 7);
  const result: DueCardPayment[] = [];
  for (const account of accounts) {
    if (account.kind !== "credit_card" || account.archived) continue;
    const txs = transactions.filter((t) => t.accountId === account.id);
    const completed = txs.filter((t) => t.status === "completed");
    const paidThisMonth = completed.some(
      (t) => t.direction === "income" && t.transferGroupId != null && t.dueDate.slice(0, 7) === month
    );
    if (paidThisMonth) continue;

    const balance = balances.get(account.id) ?? 0;
    const postedDebt = balance < 0 ? -balance : 0;
    const hasOlderExpense = completed.some((t) => t.direction === "expense" && t.dueDate.slice(0, 7) < month);
    const installmentsDue = txs
      .filter(
        (t) =>
          t.status === "planned" &&
          t.direction === "expense" &&
          t.purchaseId != null &&
          t.dueDate.slice(0, 7) <= month
      )
      .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
    const installmentsTotal = installmentsDue.reduce((s, t) => s + t.amount, 0);

    if (!(postedDebt > 0 && hasOlderExpense) && installmentsDue.length === 0) continue;
    result.push({
      account,
      suggestedAmount: postedDebt + installmentsTotal,
      postedDebt,
      installmentsDue,
    });
  }
  return result;
}
