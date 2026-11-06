import { Account } from "@/lib/data/types";
import {
  CardBook,
  CardStatement,
  cardSchedule,
  cardStatements,
  paymentDateIn,
} from "@/lib/domain/cards";
import { Currency } from "@/lib/domain/currencies";
import { convert, UsdPerMap } from "@/lib/domain/fx";
import { addMonthsClamped } from "@/lib/domain/recurrence";

/**
 * The Cards screen's three other views, as arithmetic.
 *
 * The rows, grid and table shapes are three forms of one list: a card at a
 * time, what it owes, what is coming. These three ask questions that list
 * cannot answer at a glance, so each is a view of its own rather than
 * another arrangement of the same card.
 *
 * - statementMatrix: every open card against the months ahead, one cell a
 *   statement (cardSchedule, so estimates count where they beat what is
 *   tracked). Row totals in the card's own currency, column totals and the
 *   grand total in the display currency, since cards need not share one.
 *   This is the view that answers "what do the next six months look like".
 * - paymentCalendar: one month, each card's statement on the day it falls
 *   due (cardStatements, so a payment recorded wins over an expectation).
 *   Cards with no payment day have no day to sit on and are listed apart.
 *   This is the view that answers "what lands when, and can I cover it".
 * - payoffRows: the cards ordered by what clears soonest — what is owed in
 *   all, the month the last of it falls, and how much of the limit it is
 *   using. Idle cards (nothing owed, nothing coming) go last.
 *
 * Nothing here is stored and nothing is rounded beyond the display: every
 * figure comes from the same CardBook the rest of the screen reads.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface MatrixCell {
  month: string;
  /** in the card's currency; 0 when that month bills nothing */
  total: number;
  /** in the display currency; null when the card's currency has no rate */
  value: number | null;
}

export interface MatrixRow {
  account: Account;
  cells: MatrixCell[];
  /** the row's months together, in the card's currency */
  total: number;
  /** the same in the display currency; null without a rate */
  value: number | null;
}

export interface StatementMatrix {
  /** the months the columns stand for, this month first */
  months: string[];
  rows: MatrixRow[];
  /** one per column, display currency */
  columnTotals: number[];
  /** every row and column, display currency */
  grandTotal: number;
}

/**
 * Every open card against `months` months from today's, one cell a
 * statement. A card with nothing at all in the window is left out, so the
 * grid stays about the cards that bill you.
 */
export function statementMatrix(params: {
  accounts: readonly Account[];
  book: CardBook;
  today: string;
  usdPer: UsdPerMap;
  display: Currency;
  months?: number;
}): StatementMatrix {
  const { accounts, book, today, usdPer, display, months = 6 } = params;
  const first = today.slice(0, 7);
  const columns = Array.from({ length: Math.max(1, months) }, (_, i) => addMonthsClamped(`${first}-01`, i).slice(0, 7));
  const rows: MatrixRow[] = [];
  const columnTotals = columns.map(() => 0);

  for (const card of accounts) {
    if (card.kind !== "credit_card" || card.archived) continue;
    const schedule = new Map(cardSchedule(book, card.id, first, { toMonth: columns.at(-1) }).map((s) => [s.month, s.total]));
    const cells = columns.map((month) => {
      const total = schedule.get(month) ?? 0;
      return { month, total, value: total === 0 ? 0 : convert(total, card.currency, display, usdPer) };
    });
    if (cells.every((c) => Math.abs(c.total) <= 0.005)) continue;
    const total = round2(cells.reduce((sum, c) => sum + c.total, 0));
    cells.forEach((c, i) => (columnTotals[i] += c.value ?? 0));
    rows.push({ account: card, cells, total, value: convert(total, card.currency, display, usdPer) });
  }

  // the card billing most over the window at the top: that is the one to look at
  rows.sort((a, b) => (b.value ?? 0) - (a.value ?? 0) || a.account.name.localeCompare(b.account.name));
  const totals = columnTotals.map(round2);
  return { months: columns, rows, columnTotals: totals, grandTotal: round2(totals.reduce((s, n) => s + n, 0)) };
}

export interface CalendarEntry {
  account: Account;
  /** yyyy-mm-dd; null for a card with no payment day */
  date: string | null;
  /** in the card's currency */
  amount: number;
  /** in the display currency; null without a rate */
  value: number | null;
  /** paid: every payment for it made · planned: recorded, not all made · expected: nothing recorded */
  status: "paid" | "planned" | "expected";
  statement: CardStatement;
}

export interface PaymentCalendar {
  month: string;
  /** day of the month → what falls due that day, soonest card first */
  byDay: Map<number, CalendarEntry[]>;
  /** cards with no payment day: nothing to put on a square */
  undated: CalendarEntry[];
  /** days in the month, so a grid can be drawn without re-deriving it */
  daysInMonth: number;
  /** Monday = 0: which column the 1st sits in */
  firstWeekday: number;
  /** display currency */
  totals: { all: number; paid: number; toPay: number };
}

export function paymentCalendar(params: {
  accounts: readonly Account[];
  book: CardBook;
  today: string;
  /** yyyy-mm */
  month: string;
  usdPer: UsdPerMap;
  display: Currency;
}): PaymentCalendar {
  const { accounts, book, today, month, usdPer, display } = params;
  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  // getUTCDay is Sunday = 0; the weeks here start on Monday, as they do in Turkey
  const firstWeekday = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;

  const byDay = new Map<number, CalendarEntry[]>();
  const undated: CalendarEntry[] = [];
  const totals = { all: 0, paid: 0, toPay: 0 };

  for (const card of accounts) {
    if (card.kind !== "credit_card") continue;
    const statement = cardStatements(book, card, today).find((s) => s.month === month);
    if (!statement || statement.amount <= 0.005) continue;
    // an archived card still shows what was really recorded on it
    if (card.archived && statement.payments.length === 0) continue;
    const status = statement.status === "paid" ? "paid" : statement.status === "recorded" ? "planned" : "expected";
    // what is paid reads at the rates it was paid at, so a closed month holds still
    const rates = status === "paid" ? (statement.payments[0].paying.fxSnapshot?.usdPer ?? usdPer) : usdPer;
    const value = convert(statement.amount, card.currency, display, rates);
    const date = statement.date ?? paymentDateIn(month, card.paymentDay);
    const entry: CalendarEntry = { account: card, date, amount: statement.amount, value, status, statement };
    totals.all += value ?? 0;
    totals[status === "paid" ? "paid" : "toPay"] += value ?? 0;
    // a payment recorded on another month's day belongs to that day, not this grid
    const day = date && date.slice(0, 7) === month ? Number(date.slice(8, 10)) : null;
    if (day == null) undated.push(entry);
    else byDay.set(day, [...(byDay.get(day) ?? []), entry]);
  }

  for (const list of byDay.values()) list.sort((a, b) => (b.value ?? 0) - (a.value ?? 0) || a.account.name.localeCompare(b.account.name));
  for (const k of Object.keys(totals) as (keyof typeof totals)[]) totals[k] = round2(totals[k]);
  return { month, byDay, undated, daysInMonth, firstWeekday, totals };
}

export interface PayoffRow {
  account: Account;
  /** what the card is owed today, in its own currency (CardBook.owed) */
  owed: number;
  /** the same in the display currency; null without a rate */
  value: number | null;
  /** the month the last of it falls; null when nothing is scheduled */
  clearsIn: string | null;
  /** months with something to pay, from this one */
  monthsLeft: number;
  /** the next statement's month and what it bills, in the card's currency */
  next: { month: string; date: string | null; total: number } | null;
  /** the mean of the months still to pay, in the card's currency */
  perMonth: number;
  /** owed ÷ limit, 0–1 and over; null when the card has no limit set */
  limitUsed: number | null;
  /** nothing owed and nothing coming */
  idle: boolean;
}

/**
 * The cards ordered by what clears soonest: the one you are closest to being
 * rid of at the top, so the view reads as a queue rather than a list. A card
 * with nothing owed and nothing coming is idle and goes last whatever its
 * name; among the rest, a tie reads by what is owed, largest first.
 */
export function payoffRows(params: {
  accounts: readonly Account[];
  book: CardBook;
  today: string;
  usdPer: UsdPerMap;
  display: Currency;
}): { rows: PayoffRow[]; totals: { owed: number; nextMonth: number } } {
  const { accounts, book, today, usdPer, display } = params;
  const month = today.slice(0, 7);
  const rows: PayoffRow[] = [];
  const totals = { owed: 0, nextMonth: 0 };

  for (const card of accounts) {
    if (card.kind !== "credit_card" || card.archived) continue;
    // how long a card takes to clear is about what you owe, so typical
    // spend stays out of it; the next statement is a real bill, so it's in
    const schedule = cardSchedule(book, card.id, month, { typical: false });
    const next = cardSchedule(book, card.id, month)[0];
    const owed = book.owed(card.id, today);
    const value = convert(owed, card.currency, display, usdPer);
    const scheduled = schedule.reduce((sum, s) => sum + s.total, 0);
    rows.push({
      account: card,
      owed: round2(owed),
      value,
      clearsIn: schedule.at(-1)?.month ?? null,
      monthsLeft: schedule.length,
      next: next ? { month: next.month, date: paymentDateIn(next.month, card.paymentDay), total: next.total } : null,
      perMonth: schedule.length > 0 ? round2(scheduled / schedule.length) : 0,
      limitUsed: card.creditLimit != null && card.creditLimit > 0 ? owed / card.creditLimit : null,
      idle: Math.abs(owed) <= 0.005 && schedule.length === 0,
    });
    totals.owed += value ?? 0;
    if (next && next.month === month) totals.nextMonth += convert(next.total, card.currency, display, usdPer) ?? 0;
  }

  rows.sort((a, b) => {
    if (a.idle !== b.idle) return a.idle ? 1 : -1;
    const ac = a.clearsIn ?? "9999-99";
    const bc = b.clearsIn ?? "9999-99";
    return ac.localeCompare(bc) || (b.value ?? 0) - (a.value ?? 0) || a.account.name.localeCompare(b.account.name);
  });
  return { rows, totals: { owed: round2(totals.owed), nextMonth: round2(totals.nextMonth) } };
}
