import { Account, Transaction } from "@/lib/data/types";
import { CardBook, isIncome, isSpending } from "@/lib/domain/cards";
import { Currency } from "@/lib/domain/currencies";
import { convert, UsdPerMap } from "@/lib/domain/fx";
import { addDays } from "@/lib/domain/recurrence";

/**
 * The ledger as Pocket lists it: months, then days, then rows. Pure, so the
 * month and day nets can be checked against the Classic screens' own rules.
 *
 * - listedRows(transactions, book): what a ledger lists. A card's charges and
 *   the leg of a payment landing on the card stay off it (Cards lists them),
 *   the same `listed` rule as the Classic Transactions page.
 * - transferCounterparts(transactions): transferGroupId → the leg that lands.
 * - isTransferLanding(tx): the income leg of a transfer. A ledger shows a
 *   transfer once, as the leg that leaves.
 * - groupMonthsDays(rows, options) → MonthGroup[], two rules:
 *   - without accountId, the whole ledger: income and expense follow
 *     isIncome / isSpending (transfers left out, a card payment counted as the
 *     spending), each converted to `display` with the rates captured on the
 *     row, else today's; legacy rows are listed but not summed; transfer
 *     landing legs are dropped from the rows. This is the Classic Transactions
 *     month header.
 *   - with accountId, one account's history: only that account's rows, every
 *     one of them (both kinds of transfer leg too), and nets in that
 *     account's currency signed by direction, legacy listed but not summed.
 *     This is the Classic Portfolio history (completedMonths).
 *   Rows whose account is unknown are dropped, as the Classic row renders
 *   nothing for them. `order` sorts months, days and the rows within a day.
 * - monthLabel(month, locale), dayLabel(date, today, locale, words): headings.
 */

export interface DayGroup {
  /** yyyy-mm-dd */
  date: string;
  /** income − expense on the day, by the same rule as the month */
  net: number;
  /** rows listed under the day */
  count: number;
  rows: Transaction[];
}

export interface MonthGroup {
  /** yyyy-mm */
  month: string;
  income: number;
  expense: number;
  /** income − expense: in `display`, or in the account's currency with accountId */
  net: number;
  days: DayGroup[];
}

export interface GroupOptions {
  accountsById: ReadonlyMap<string, Account>;
  /** today's rates; a row completed under other rates uses its own snapshot */
  usdPer: UsdPerMap | null | undefined;
  display: Currency;
  book: CardBook;
  /** one account's history: its rows only, nets in its currency */
  accountId?: string;
  /** newest first (the default) or oldest first */
  order?: "newest" | "oldest";
}

/** Rows a ledger lists: not a card's charges, not a payment's landing on a card. */
export function listedRows(transactions: readonly Transaction[], book: CardBook): Transaction[] {
  return transactions.filter((tx) => {
    const role = book.roleOf(tx);
    return role !== "charge" && role !== "cardSide";
  });
}

/** transferGroupId → the leg that lands (the income leg). */
export function transferCounterparts(transactions: readonly Transaction[]): Map<string, Transaction> {
  const map = new Map<string, Transaction>();
  for (const tx of transactions) {
    if (tx.transferGroupId && tx.direction === "income") map.set(tx.transferGroupId, tx);
  }
  return map;
}

/** The income leg of a transfer: a ledger shows the move once, as the leg that leaves. */
export function isTransferLanding(tx: Transaction): boolean {
  return tx.transferGroupId != null && tx.direction === "income";
}

function compareRows(a: Transaction, b: Transaction): number {
  if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function groupMonthsDays(rows: readonly Transaction[], options: GroupOptions): MonthGroup[] {
  const { accountsById, usdPer, display, book, accountId, order = "newest" } = options;
  const sign = order === "newest" ? -1 : 1;

  /** what a row adds to its month: [income, expense], or null when it isn't counted */
  const contribution = (tx: Transaction, account: Account): [number, number] | null => {
    if (tx.legacy) return null;
    if (accountId != null) return tx.direction === "income" ? [tx.amount, 0] : [0, tx.amount];
    const income = isIncome(tx, book);
    if (!income && !isSpending(tx, book)) return null;
    const rates = tx.fxSnapshot?.usdPer ?? usdPer;
    if (!rates) return null;
    const converted = convert(tx.amount, account.currency, display, rates);
    if (converted == null) return null;
    return income ? [converted, 0] : [0, converted];
  };

  const kept = rows.filter((tx) => {
    if (!accountsById.has(tx.accountId)) return false;
    if (accountId != null) return tx.accountId === accountId;
    return !isTransferLanding(tx);
  });
  kept.sort((a, b) => sign * compareRows(a, b));

  const months: MonthGroup[] = [];
  let month: MonthGroup | null = null;
  let day: DayGroup | null = null;
  for (const tx of kept) {
    const key = tx.dueDate.slice(0, 7);
    if (!month || month.month !== key) {
      month = { month: key, income: 0, expense: 0, net: 0, days: [] };
      months.push(month);
      day = null;
    }
    if (!day || day.date !== tx.dueDate) {
      day = { date: tx.dueDate, net: 0, count: 0, rows: [] };
      month.days.push(day);
    }
    day.rows.push(tx);
    day.count += 1;
    const add = contribution(tx, accountsById.get(tx.accountId)!);
    if (add) {
      month.income += add[0];
      month.expense += add[1];
      day.net += add[0] - add[1];
    }
  }
  for (const m of months) m.net = m.income - m.expense;
  return months;
}

const intlLocale = (locale: string) => (locale === "tr" ? "tr-TR" : "en-US");

/** "October 2026" / "Ekim 2026" */
export function monthLabel(month: string, locale: string): string {
  return new Date(`${month}-01T00:00:00`).toLocaleDateString(intlLocale(locale), { month: "long", year: "numeric" });
}

/**
 * A day heading: "Today", "Yesterday", "Tomorrow", else the weekday, day and
 * month ("Fri, Oct 9" / "9 Eki Cum"), with the year when it isn't this year's.
 */
export function dayLabel(
  date: string,
  today: string,
  locale: string,
  words: { today: string; yesterday: string; tomorrow: string }
): string {
  if (date === today) return words.today;
  if (date === addDays(today, -1)) return words.yesterday;
  if (date === addDays(today, 1)) return words.tomorrow;
  return new Date(`${date}T00:00:00`).toLocaleDateString(intlLocale(locale), {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: date.slice(0, 4) === today.slice(0, 4) ? undefined : "numeric",
  });
}
