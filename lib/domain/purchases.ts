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
  description: string;
}

/**
 * The transactions a reflected purchase generates: a single completed expense
 * for one-shots, or one row per installment — rows already due (<= today)
 * completed, the rest planned. Used identically by both repos.
 */
export function buildPurchaseTransactionSpecs(
  purchase: Pick<Purchase, "name" | "amount" | "installmentCount" | "purchaseDate" | "firstDue">,
  currency: Currency,
  today: string
): PurchaseTxSpec[] {
  if (purchase.installmentCount <= 1) {
    return [
      { amount: purchase.amount, dueDate: purchase.purchaseDate, status: "completed", description: purchase.name },
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
  suggestedAmount: number;
}

/**
 * Cards that look unpaid this month: posted debt (balance < 0), at least one
 * completed expense in an earlier month (a statement exists), and no incoming
 * transfer leg this calendar month.
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
    const balance = balances.get(account.id) ?? 0;
    if (balance >= 0) continue;
    const txs = transactions.filter((t) => t.accountId === account.id && t.status === "completed");
    const hasOlderExpense = txs.some((t) => t.direction === "expense" && t.dueDate.slice(0, 7) < month);
    if (!hasOlderExpense) continue;
    const paidThisMonth = txs.some(
      (t) => t.direction === "income" && t.transferGroupId != null && t.dueDate.slice(0, 7) === month
    );
    if (paidThisMonth) continue;
    result.push({ account, suggestedAmount: -balance });
  }
  return result;
}
