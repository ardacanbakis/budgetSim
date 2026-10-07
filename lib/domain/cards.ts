import { Account, Transaction } from "@/lib/data/types";
import { computeBalances, computeNetWorth } from "./balances";
import { Currency } from "./currencies";
import { convert, UsdPerMap } from "./fx";
import { GoldPrices, goldRatiosOf } from "./gold";

/**
 * Credit cards as they're used here: what you spend on a card counts when you
 * pay the card, not when you swipe it.
 *
 * - A card payment (a transfer from one of your accounts into a card) is the
 *   expense. It counts on the account the money left, in totals, reports and
 *   budgets alike.
 * - Anything charged to a card (a big purchase's installments, a recurring
 *   item billed to it, a one-off) is a breakdown of what some payment covers.
 *   Counting it as well would count that spending twice.
 * - A payment made in month M covers the card's charges dated before M (the
 *   statement it pays was cut before it). A charge is paid once the payment
 *   covering it has been made, so nothing needs ticking off by hand.
 * - What a card is owed: payments recorded but not yet made, plus charges no
 *   payment covers yet. Those are what's already been charged, and every
 *   installment of a big purchase still to come, because Turkish banks hold
 *   the whole taksit against the limit. A recurring item billed to the card
 *   isn't owed before its date.
 *
 * Nothing here is stored: it's all read off the ledger, so every screen and
 * every device agrees.
 */

export type CardRole =
  /** on a card and not a transfer: part of what a payment covers */
  | "charge"
  /** the leg leaving one of your accounts for a card: the expense */
  | "payment"
  /** the leg landing on the card: bookkeeping only */
  | "cardSide"
  /** between your own accounts, no card being paid */
  | "transfer"
  | "regular";

export interface CardPayment {
  groupId: string;
  cardId: string;
  /** the leg on the account it was paid from */
  paying: Transaction;
  /** the leg on the card */
  landing: Transaction;
  date: string;
  /** in the card's currency */
  amount: number;
  /** the money has left (the paying leg is completed) */
  made: boolean;
}

export interface CardBook {
  isCard(accountId: string): boolean;
  roleOf(t: Transaction): CardRole;
  /** payments into this card, by date */
  payments(cardId: string): CardPayment[];
  /** the payment a transfer leg belongs to, if it pays a card */
  paymentOf(leg: Transaction): CardPayment | null;
  /** what's been charged to this card (legacy history excluded), by date */
  charges(cardId: string): Transaction[];
  /** the payment that covers a charge, if one has been recorded */
  coverOf(charge: Transaction): CardPayment | null;
  /** the charge's covering payment has been made (or it's history from before tracking) */
  isPaid(charge: Transaction): boolean;
  /** charges no recorded payment covers yet, by date */
  uncovered(cardId: string): Transaction[];
  /** what the card is owed today, in its own currency (see the rules above) */
  owed(cardId: string, today: string): number;
  /** the month a charge is paid in: its covering payment's, else the month after it */
  paidInMonth(charge: Transaction): string;
}

/** + for a charge, − for a refund landing on the card */
export const chargeAmount = (t: Transaction): number => (t.direction === "expense" ? t.amount : -t.amount);

function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

export function buildCardBook(accounts: Account[], transactions: Transaction[]): CardBook {
  const cards = new Set(accounts.filter((a) => a.kind === "credit_card").map((a) => a.id));
  const currencyOf = new Map(accounts.map((a) => [a.id, a.currency] as const));

  const legsByGroup = new Map<string, Transaction[]>();
  for (const t of transactions) {
    if (t.transferGroupId) legsByGroup.set(t.transferGroupId, [...(legsByGroup.get(t.transferGroupId) ?? []), t]);
  }

  // a group pays a card when money leaves a non-card account and lands on a card
  const paymentByGroup = new Map<string, CardPayment>();
  for (const [groupId, legs] of legsByGroup) {
    const landing = legs.find((l) => l.direction === "income" && cards.has(l.accountId));
    const paying = legs.find((l) => l.direction === "expense" && !cards.has(l.accountId));
    if (!landing || !paying) continue;
    const sameCurrency = currencyOf.get(paying.accountId) === currencyOf.get(landing.accountId);
    paymentByGroup.set(groupId, {
      groupId,
      cardId: landing.accountId,
      paying,
      landing,
      date: paying.dueDate,
      amount: sameCurrency ? paying.amount : landing.amount,
      made: paying.status === "completed",
    });
  }

  const paymentsOf = new Map<string, CardPayment[]>();
  for (const p of paymentByGroup.values()) paymentsOf.set(p.cardId, [...(paymentsOf.get(p.cardId) ?? []), p]);
  for (const list of paymentsOf.values()) list.sort((a, b) => a.date.localeCompare(b.date));

  const chargesOf = new Map<string, Transaction[]>();
  for (const t of transactions) {
    if (!cards.has(t.accountId) || t.transferGroupId || t.legacy) continue;
    chargesOf.set(t.accountId, [...(chargesOf.get(t.accountId) ?? []), t]);
  }
  for (const list of chargesOf.values()) list.sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  const coverOf = (charge: Transaction): CardPayment | null => {
    const month = charge.dueDate.slice(0, 7);
    return (paymentsOf.get(charge.accountId) ?? []).find((p) => p.date.slice(0, 7) > month) ?? null;
  };

  const roleOf = (t: Transaction): CardRole => {
    if (t.transferGroupId) {
      const payment = paymentByGroup.get(t.transferGroupId);
      if (payment) return t.id === payment.paying.id ? "payment" : t.id === payment.landing.id ? "cardSide" : "transfer";
      return "transfer";
    }
    return cards.has(t.accountId) ? "charge" : "regular";
  };

  const uncovered = (cardId: string) => (chargesOf.get(cardId) ?? []).filter((c) => coverOf(c) == null);

  return {
    isCard: (accountId) => cards.has(accountId),
    roleOf,
    payments: (cardId) => paymentsOf.get(cardId) ?? [],
    paymentOf: (leg) => (leg.transferGroupId ? (paymentByGroup.get(leg.transferGroupId) ?? null) : null),
    charges: (cardId) => chargesOf.get(cardId) ?? [],
    coverOf,
    isPaid: (charge) => charge.legacy || coverOf(charge)?.made === true,
    uncovered,
    owed: (cardId, today) => {
      let owed = 0;
      for (const p of paymentsOf.get(cardId) ?? []) if (!p.made) owed += p.amount;
      for (const c of uncovered(cardId)) {
        // charged already, or an installment the bank holds against the limit
        if (c.dueDate <= today || c.purchaseId != null) owed += chargeAmount(c);
      }
      return owed;
    },
    paidInMonth: (charge) => coverOf(charge)?.date.slice(0, 7) ?? nextMonth(charge.dueDate.slice(0, 7)),
  };
}

/** What every open card is owed today, in the display currency. */
export function totalOwed(
  book: CardBook,
  accounts: Account[],
  today: string,
  usdPer: UsdPerMap,
  display: Currency
): number {
  let total = 0;
  for (const a of accounts) {
    if (a.kind !== "credit_card" || a.archived) continue;
    const converted = convert(book.owed(a.id, today), a.currency, display, usdPer);
    if (converted != null) total += converted;
  }
  return total;
}

/**
 * A card's bills month by month: payments recorded but not yet made, in the
 * month they're due, and charges no payment covers yet, in the month they'll
 * be paid (see paidInMonth). In the card's own currency.
 */
export function cardSchedule(book: CardBook, cardId: string, fromMonth: string): { month: string; total: number }[] {
  const months = new Map<string, number>();
  const add = (month: string, amount: number) => {
    if (month >= fromMonth) months.set(month, (months.get(month) ?? 0) + amount);
  };
  for (const p of book.payments(cardId)) if (!p.made) add(p.date.slice(0, 7), p.amount);
  for (const c of book.uncovered(cardId)) add(book.paidInMonth(c), chargeAmount(c));
  return [...months.entries()]
    .filter(([, total]) => Math.abs(total) > 0.005)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, total]) => ({ month, total }));
}

/**
 * Net worth as it stands today: what you hold, less what every card is owed.
 * The dashboard shows it and the monthly snapshot records it, so history and
 * the headline are the same number.
 */
export function netWorthNow(params: {
  accounts: Account[];
  transactions: Transaction[];
  usdPer: UsdPerMap;
  display: Currency;
  today: string;
  /** every gold type's price, for gold held as coins or bilezik */
  goldTry?: GoldPrices;
}): { total: number; owed: number; skippedAccountIds: string[]; balances: Map<string, number> } {
  const { accounts, transactions, usdPer, display, today, goldTry } = params;
  const balances = computeBalances(accounts, transactions, goldRatiosOf({ usdPer, goldTry }));
  const held = computeNetWorth(accounts, balances, usdPer, display);
  const owed = totalOwed(buildCardBook(accounts, transactions), accounts, today, usdPer, display);
  return { total: held.total - owed, owed, skippedAccountIds: held.skippedAccountIds, balances };
}

/** Counts as spending: an ordinary expense, or a payment into a card. */
export function isSpending(t: Transaction, book: CardBook): boolean {
  const role = book.roleOf(t);
  return role === "payment" || (role === "regular" && t.direction === "expense");
}

/** Counts as income: an ordinary income; never a transfer leg or anything on a card. */
export function isIncome(t: Transaction, book: CardBook): boolean {
  return book.roleOf(t) === "regular" && t.direction === "income";
}
