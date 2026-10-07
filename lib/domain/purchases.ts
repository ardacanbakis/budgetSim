import { Account, Purchase, Transaction } from "@/lib/data/types";
import { CardBook, chargeAmount } from "./cards";
import { Currency } from "./currencies";
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

/**
 * Progress from the purchase's linked transactions (reflected purchases only
 * have them). On a card, an installment is paid once the card payment that
 * covers it has been made (see lib/domain/cards.ts), so nothing is ticked by
 * hand; elsewhere it's paid when it's completed.
 */
export function purchaseProgress(purchase: Purchase, book: CardBook, transactions: Transaction[], currency: Currency): PurchaseProgress {
  const linked = transactions.filter((t) => t.purchaseId === purchase.id);
  let paidMinor = 0;
  let paidCount = 0;
  for (const t of linked) {
    const paid = book.isCard(t.accountId) ? book.isPaid(t) : t.status === "completed";
    if (paid) {
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

export interface DueCardPayment {
  account: Account;
  /** what's been charged to the card and not yet covered by a payment, from before this month */
  suggestedAmount: number;
  /** those charges: the payment you record will cover them */
  covers: Transaction[];
}

/**
 * Cards with charges from earlier months that no payment covers yet, and no
 * payment recorded this month. Recording one covers them.
 */
export function findDueCardPayments(accounts: Account[], book: CardBook, today: string): DueCardPayment[] {
  const month = today.slice(0, 7);
  const result: DueCardPayment[] = [];
  for (const account of accounts) {
    if (account.kind !== "credit_card" || account.archived) continue;
    if (book.payments(account.id).some((p) => p.date.slice(0, 7) === month)) continue;
    const covers = book.uncovered(account.id).filter((c) => c.dueDate.slice(0, 7) < month);
    if (covers.length === 0) continue;
    const suggestedAmount = covers.reduce((sum, c) => sum + chargeAmount(c), 0);
    if (suggestedAmount <= 0.005) continue;
    result.push({ account, suggestedAmount, covers });
  }
  return result;
}

/** How a card is doing against its limit. */
export interface CardStanding {
  account: Account;
  /** what the card is owed today, positive (see CardBook.owed) */
  owed: number;
  /** limit − owed; null when no limit is set */
  available: number | null;
  /** days until the statement is due; null when no payment day is set */
  daysToDue: number | null;
  /** a payment for this month is recorded, made or not */
  paidThisMonth: boolean;
  /** nothing owed and nothing coming */
  idle: boolean;
}

/** Days from `today` to the next occurrence of `day` in the month. */
export function daysUntilPaymentDay(day: number, today: string): number {
  const [y, m, d] = today.split("-").map(Number);
  const inThisMonth = new Date(Date.UTC(y, m - 1, Math.min(day, new Date(Date.UTC(y, m, 0)).getUTCDate())));
  const now = Date.UTC(y, m - 1, d);
  const target =
    inThisMonth.getTime() >= now
      ? inThisMonth
      : new Date(Date.UTC(y, m, Math.min(day, new Date(Date.UTC(y, m + 1, 0)).getUTCDate())));
  return Math.round((target.getTime() - now) / 86_400_000);
}

/**
 * What each card owes and how much of its limit that leaves. A payment you've
 * recorded but not made is owed (it's this month's statement), and so is
 * every installment still to come, the way Turkish banks hold a taksit
 * against the limit. Making the payment frees the limit again.
 */
export function cardStandings(accounts: Account[], book: CardBook, today: string): CardStanding[] {
  const month = today.slice(0, 7);
  return accounts
    .filter((a) => a.kind === "credit_card" && !a.archived)
    .map((account) => {
      const owed = book.owed(account.id, today);
      const upcoming = book.uncovered(account.id).length > 0 || book.payments(account.id).some((p) => !p.made);
      return {
        account,
        owed,
        available: account.creditLimit != null ? account.creditLimit - owed : null,
        daysToDue: account.paymentDay != null ? daysUntilPaymentDay(account.paymentDay, today) : null,
        paidThisMonth: book.payments(account.id).some((p) => p.date.slice(0, 7) === month),
        idle: owed <= 0.005 && !upcoming,
      };
    });
}

/**
 * Cards whose statement is due today or within `within` days and that have no
 * payment recorded for this month yet. Drives the nudge in the header.
 */
export function cardsDueSoon(standings: CardStanding[], within = 5): CardStanding[] {
  return standings
    .filter((s) => s.daysToDue != null && s.daysToDue <= within && !s.paidThisMonth)
    .sort((a, b) => (a.daysToDue ?? 0) - (b.daysToDue ?? 0));
}
