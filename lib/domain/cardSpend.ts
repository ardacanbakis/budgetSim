import { Account, Transaction } from "@/lib/data/types";
import { CardEstimate } from "@/lib/data/types";
import { buildCardBook, CardBook, cardStatements, paymentDateIn } from "./cards";

/**
 * What a card costs you beyond its installments — and what that says about
 * the months ahead.
 *
 * The app can read every taksit, because a big purchase writes its own
 * rows. It cannot read the rest: the shopping, the fuel, the dinners that
 * make up most of a statement. So a month ahead with nothing but taksit in
 * it reads as a cheap month, and a plan built on those months is optimistic
 * by however much you actually spend.
 *
 * What a past statement says about that is simple arithmetic: the payment
 * that settled it, less the installments it covered. Legacy rows count here
 * where they don't elsewhere — history imported after the fact is still
 * taksit that was on that statement, and leaving it out would read as
 * ordinary spending that never happened.
 *
 * The figure is the MEDIAN of the last few such months, not the mean: one
 * wedding, one tax bill or one flight would drag a mean up for half a year,
 * and the question being asked is "what does a normal month look like".
 *
 * Nothing here is stored. The user's own figure, when they set one, is an
 * override kept in settings; the measurement is read off the ledger each
 * time, so it follows your spending without being maintained.
 */

/** How many recorded statements the measurement reads, unless told otherwise. */
export const DEFAULT_LOOKBACK = 3;

export interface SpendMonth {
  /** yyyy-mm */
  month: string;
  /** what the statement was: the payments recorded for it */
  statement: number;
  /** the installments that statement covered, imported history included */
  installments: number;
  /** what's left: everything else you put on the card, never below zero */
  ordinary: number;
}

export interface TypicalSpend {
  account: Account;
  /** the months measured, newest first */
  months: SpendMonth[];
  /** the median of their ordinary spend; null when no month could be read */
  measured: number | null;
  /** the figure set by hand instead, if any (0 means "this card, never") */
  override: number | null;
  /** what counts: the override when set, else the measurement, else nothing */
  value: number;
}

const median = (xs: readonly number[]): number => {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const prevMonth = (month: string): string => {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
};

/** The last day a statement of `month` covers: the card's payment day, else month end. */
const cutoff = (month: string, paymentDay: number | null): string => paymentDateIn(month, paymentDay) ?? `${month}-31`;

/**
 * One card's ordinary spend, measured from the statements it has actually
 * been paid. Only months with a payment recorded count: a month nobody has
 * settled is a guess, and guesses are what this exists to replace.
 */
export function typicalCardSpend(params: {
  card: Account;
  book: CardBook;
  /** every row, so imported history counts as the taksit it was */
  transactions: readonly Transaction[];
  today: string;
  lookback?: number;
  override?: number | null;
}): TypicalSpend {
  const { card, book, transactions, today, lookback = DEFAULT_LOOKBACK, override = null } = params;
  const thisMonth = today.slice(0, 7);

  const onCard = transactions.filter((t) => t.accountId === card.id && t.purchaseId != null);
  const installmentsIn = (month: string) => {
    const to = cutoff(month, card.paymentDay);
    const from = cutoff(prevMonth(month), card.paymentDay);
    let total = 0;
    for (const t of onCard) {
      if (t.dueDate <= from || t.dueDate > to) continue;
      total += t.direction === "expense" ? t.amount : -t.amount;
    }
    return total;
  };

  const months: SpendMonth[] = [];
  for (const s of cardStatements(book, card, today)) {
    // newest first already; a month still to come has nothing to teach
    if (s.month > thisMonth || s.payments.length === 0) continue;
    const statement = s.payments.reduce((sum, p) => sum + p.amount, 0);
    const installments = installmentsIn(s.month);
    months.push({ month: s.month, statement, installments, ordinary: Math.max(0, statement - installments) });
    if (months.length >= Math.max(1, lookback)) break;
  }

  const measured = months.length > 0 ? Math.round(median(months.map((m) => m.ordinary)) * 100) / 100 : null;
  return { account: card, months, measured, override, value: override ?? measured ?? 0 };
}

export interface CardSpendSettings {
  /** carry it into the plan at all; nothing changes until this is on */
  on: boolean;
  /** how many recorded statements the measurement reads */
  lookback: number;
  /** a figure set by hand, by account id; 0 means "never for this card" */
  overrides: Record<string, number>;
}

export const DEFAULT_CARD_SPEND: CardSpendSettings = { on: false, lookback: DEFAULT_LOOKBACK, overrides: {} };

/** A stored setting read into one with every field present and sane. */
export function normalizeCardSpend(saved: unknown): CardSpendSettings {
  const raw = (saved && typeof saved === "object" ? saved : {}) as Partial<CardSpendSettings>;
  const lookback =
    typeof raw.lookback === "number" && Number.isInteger(raw.lookback) && raw.lookback >= 1 && raw.lookback <= 12
      ? raw.lookback
      : DEFAULT_LOOKBACK;
  const overrides: Record<string, number> = {};
  if (raw.overrides && typeof raw.overrides === "object") {
    for (const [id, value] of Object.entries(raw.overrides)) {
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) overrides[id] = value;
    }
  }
  return { on: raw.on === true, lookback, overrides };
}

/** Every open card's typical spend, measured and overridden, by account id. */
export function typicalSpendRows(params: {
  accounts: readonly Account[];
  book: CardBook;
  transactions: readonly Transaction[];
  today: string;
  settings: CardSpendSettings;
}): TypicalSpend[] {
  const { accounts, book, transactions, today, settings } = params;
  return accounts
    .filter((a) => a.kind === "credit_card" && !a.archived)
    .map((card) =>
      typicalCardSpend({
        card,
        book,
        transactions,
        today,
        lookback: settings.lookback,
        override: Object.prototype.hasOwnProperty.call(settings.overrides, card.id) ? settings.overrides[card.id] : null,
      })
    );
}

/**
 * What to hand buildCardBook: each card's typical spend, or an empty map
 * while the setting is off, so nothing anywhere changes until it is on.
 */
export function typicalSpendMap(params: {
  accounts: readonly Account[];
  book: CardBook;
  transactions: readonly Transaction[];
  today: string;
  settings: CardSpendSettings;
}): Map<string, number> {
  const out = new Map<string, number>();
  if (!params.settings.on) return out;
  for (const row of typicalSpendRows(params)) if (row.value > 0.005) out.set(row.account.id, row.value);
  return out;
}

/**
 * A card book that carries typical spend, for the screens that look ahead.
 *
 * Measuring needs a book of its own — what a statement was, and the taksit
 * it covered — so the plain book is built first and the measured one on top
 * of it. With the setting off the plain book is handed straight back, so
 * nothing anywhere changes and nothing extra is computed.
 *
 * Screens that only ask what a row *is* (is this spending, is it a card
 * payment) don't need this: typical spend is about months to come, and a
 * row that already exists is not one of them.
 */
export function buildPlanningBook(params: {
  accounts: Account[];
  transactions: Transaction[];
  estimates?: readonly CardEstimate[];
  settings: CardSpendSettings;
  today: string;
}): CardBook {
  const { accounts, transactions, estimates = [], settings, today } = params;
  const book = buildCardBook(accounts, transactions, estimates);
  if (!settings.on) return book;
  const typical = typicalSpendMap({ accounts, book, transactions, today, settings });
  return typical.size === 0 ? book : buildCardBook(accounts, transactions, estimates, typical);
}
