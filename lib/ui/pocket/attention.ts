import { Account, Transaction } from "@/lib/data/types";
import { CardBook, cardSchedule, NextCardPayment, nextCardPayment, paymentDateIn } from "@/lib/domain/cards";
import { CardStanding, cardsDueSoon, DueCardPayment } from "@/lib/domain/purchases";
import { addDays, addMonthsClamped } from "@/lib/domain/recurrence";
import { isTransferLanding } from "./dayGroups";

/**
 * What needs doing, for Home's "Coming up", the Activity badge and the cards.
 * Pure: every figure comes from lib/domain, so Pocket and Classic agree.
 *
 * - comingUp(params) → ComingUpItem[]: planned rows that are overdue or due
 *   within `days`, card statements, and one row for unpaid VICTVS sessions.
 *   Overdue first, then by date; VICTVS last.
 *   - planned: status planned, a row the ledger lists (not a card's charge or
 *     a payment's landing on a card), a transfer once (the leg that leaves),
 *     on a known account.
 *   - card: cardsDueSoon(standings, days), plus any card findDueCardPayments
 *     says has an unpaid statement whose payment day has already passed this
 *     month (overdue) or that has no payment day (dated today). Without the
 *     second part a statement missed on the 15th would vanish until next
 *     month's countdown, as cardsDueSoon only looks forward.
 * - statementFigure(card, book, today, duePayments) → { amount, totalOwed, monthsToGo }:
 *   amount is what recording a payment now would suggest (the Cards page's
 *   figure): the findDueCardPayments suggestedAmount, else this month's line
 *   of cardSchedule, else 0. totalOwed is book.owed; monthsToGo counts
 *   cardSchedule months from this one.
 * - overdueCount(listed, today): planned rows past their date, a transfer once.
 * - isLongOverdue(tx, today): due more than LEGACY_AGE_MONTHS ago, the rule
 *   that pre-ticks "complete as legacy" (Classic CompleteModal).
 * Relative wording ("in 3 days", "2 days late") is core's: lib/ui/pocket/dates.ts.
 */

/** Older than this (months) → completing defaults to legacy, as in Classic. */
export const LEGACY_AGE_MONTHS = 3;

export function isLongOverdue(tx: Transaction, today: string): boolean {
  return tx.status === "planned" && tx.dueDate < addMonthsClamped(today, -LEGACY_AGE_MONTHS);
}

/** Planned rows already past their date, counted as the list shows them. */
export function overdueCount(listed: readonly Transaction[], today: string): number {
  return listed.filter((tx) => tx.status === "planned" && tx.dueDate < today && !isTransferLanding(tx)).length;
}

export interface StatementFigure {
  /** what to pay now, in the card's currency */
  amount: number;
  /** everything the card is owed today (book.owed) */
  totalOwed: number;
  /** months with something to pay, this one included */
  monthsToGo: number;
  /** the next statement to pay, this month's while it's unpaid */
  next: NextCardPayment | null;
}

export function statementFigure(
  card: Account,
  book: CardBook,
  today: string,
  duePayments: readonly DueCardPayment[]
): StatementFigure {
  const thisMonth = today.slice(0, 7);
  const schedule = cardSchedule(book, card.id, thisMonth);
  const due = duePayments.find((d) => d.account.id === card.id);
  const amount = due ? due.suggestedAmount : schedule[0]?.month === thisMonth ? schedule[0].total : 0;
  return { amount, totalOwed: book.owed(card.id, today), monthsToGo: schedule.length, next: nextCardPayment(book, card, today) };
}

export type ComingUpItem =
  | {
      kind: "planned";
      key: string;
      date: string;
      overdue: boolean;
      tx: Transaction;
      account: Account;
    }
  | {
      kind: "card";
      key: string;
      /** the statement's payment day */
      date: string;
      overdue: boolean;
      account: Account;
      standing: CardStanding;
      figure: StatementFigure;
    }
  | {
      kind: "victvs";
      key: "victvs";
      /** unpaid sessions, in USD */
      amountUsd: number;
      count: number;
    };

export interface ComingUpParams {
  transactions: readonly Transaction[];
  accounts: readonly Account[];
  book: CardBook;
  today: string;
  /** how far ahead "coming up" looks (Home: 7) */
  days: number;
  duePayments: readonly DueCardPayment[];
  standings: readonly CardStanding[];
  unpaidVictvsUsd: number;
  unpaidVictvsCount: number;
}

export function comingUp(params: ComingUpParams): ComingUpItem[] {
  const { transactions, accounts, book, today, days, duePayments, standings, unpaidVictvsUsd, unpaidVictvsCount } = params;
  const accountsById = new Map(accounts.map((a) => [a.id, a]));
  const horizon = addDays(today, days);
  const items: Array<Exclude<ComingUpItem, { kind: "victvs" }>> = [];

  for (const tx of transactions) {
    if (tx.status !== "planned" || tx.dueDate > horizon || isTransferLanding(tx)) continue;
    const role = book.roleOf(tx);
    if (role === "charge" || role === "cardSide") continue;
    const account = accountsById.get(tx.accountId);
    if (!account) continue;
    items.push({ kind: "planned", key: tx.id, date: tx.dueDate, overdue: tx.dueDate < today, tx, account });
  }

  const cards = new Map<string, { date: string; overdue: boolean; standing: CardStanding }>();
  for (const standing of cardsDueSoon([...standings], days)) {
    cards.set(standing.account.id, { date: addDays(today, standing.daysToDue ?? 0), overdue: false, standing });
  }
  for (const due of duePayments) {
    const id = due.account.id;
    const standing = standings.find((s) => s.account.id === id);
    if (cards.has(id) || !standing || standing.paidThisMonth) continue;
    const payDay = standing.account.paymentDay;
    if (payDay == null) {
      cards.set(id, { date: today, overdue: false, standing });
      continue;
    }
    const date = paymentDateIn(today.slice(0, 7), payDay)!;
    // still ahead and further than `days`: it isn't coming up yet
    if (date < today) cards.set(id, { date, overdue: true, standing });
  }
  for (const [id, card] of cards) {
    items.push({
      kind: "card",
      key: `card:${id}`,
      date: card.date,
      overdue: card.overdue,
      account: card.standing.account,
      standing: card.standing,
      figure: statementFigure(card.standing.account, book, today, duePayments),
    });
  }

  items.sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.kind !== b.kind) return a.kind === "planned" ? -1 : 1;
    if (a.kind === "planned" && b.kind === "planned") {
      return a.tx.createdAt < b.tx.createdAt ? -1 : a.tx.createdAt > b.tx.createdAt ? 1 : a.tx.id < b.tx.id ? -1 : 1;
    }
    return a.key < b.key ? -1 : 1;
  });

  const result: ComingUpItem[] = items;
  if (unpaidVictvsCount > 0) result.push({ kind: "victvs", key: "victvs", amountUsd: unpaidVictvsUsd, count: unpaidVictvsCount });
  return result;
}
