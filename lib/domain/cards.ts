import { Account, CardEstimate, Transaction } from "@/lib/data/types";
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
 *   statement it pays was cut before it), and a big purchase's installments
 *   due by M's payment day: an installment's date is when it's paid, not a
 *   swipe, so it's paid with the first statement due on or after it. A
 *   charge is paid once the payment covering it has been made, so nothing
 *   needs ticking off by hand.
 * - What a card is owed: payments recorded but not yet made, plus charges no
 *   payment covers yet. Those are what's already been charged, and every
 *   installment of a big purchase still to come, because Turkish banks hold
 *   the whole taksit against the limit. A recurring item billed to the card
 *   isn't owed before its date.
 *
 * - What you expect a statement to be (CardEstimate) stands in for what the
 *   app can't see yet: until that month's payment is recorded, the month
 *   pays the larger of the latest expectation and the charges tracked. What
 *   the card is owed never includes it; that's only what's been charged.
 *
 * Nothing here is stored but the expectations: the rest is read off the
 * ledger, so every screen and every device agrees.
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
  /** the month a charge is paid in: its covering payment's, else the first statement that covers it (coveredIn) */
  paidInMonth(charge: Transaction): string;
  /** uncovered charges a payment made in `month` (yyyy-mm) would cover */
  wouldCover(cardId: string, month: string): Transaction[];
  /** every expectation noted for this card, oldest noted first */
  estimates(cardId: string): CardEstimate[];
  /** the expectation that counts for a statement month: the latest noted (on or before `asOf`, when given) */
  expected(cardId: string, month: string, asOf?: string): CardEstimate | null;
}

/** + for a charge, − for a refund landing on the card */
export const chargeAmount = (t: Transaction): number => (t.direction === "expense" ? t.amount : -t.amount);

/**
 * Whether the statement of `month` (yyyy-mm) covers a charge: a swipe from an
 * earlier month, or an installment due by that statement's payment day. With
 * no payment day, any installment due that month or earlier.
 */
export function coveredIn(charge: Transaction, month: string, paymentDay: number | null): boolean {
  const own = charge.dueDate.slice(0, 7);
  if (charge.purchaseId == null) return own < month;
  return charge.dueDate <= (paymentDateIn(month, paymentDay) ?? `${month}-31`);
}

function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/** noted first, then entered first: the order an expectation's history reads in */
const byNoted = (a: CardEstimate, b: CardEstimate) => a.notedOn.localeCompare(b.notedOn) || a.createdAt.localeCompare(b.createdAt);

export function buildCardBook(accounts: Account[], transactions: Transaction[], estimates: readonly CardEstimate[] = []): CardBook {
  const cards = new Set(accounts.filter((a) => a.kind === "credit_card").map((a) => a.id));
  const currencyOf = new Map(accounts.map((a) => [a.id, a.currency] as const));
  const paymentDayOf = new Map(accounts.map((a) => [a.id, a.paymentDay ?? null] as const));
  const covers = (charge: Transaction, month: string) => coveredIn(charge, month, paymentDayOf.get(charge.accountId) ?? null);

  const legsByGroup = new Map<string, Transaction[]>();
  for (const t of transactions) {
    if (!t.transferGroupId) continue;
    const legs = legsByGroup.get(t.transferGroupId);
    if (legs) legs.push(t);
    else legsByGroup.set(t.transferGroupId, [t]);
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
  for (const p of paymentByGroup.values()) {
    const list = paymentsOf.get(p.cardId);
    if (list) list.push(p);
    else paymentsOf.set(p.cardId, [p]);
  }
  for (const list of paymentsOf.values()) list.sort((a, b) => a.date.localeCompare(b.date));

  const chargesOf = new Map<string, Transaction[]>();
  for (const t of transactions) {
    if (!cards.has(t.accountId) || t.transferGroupId || t.legacy) continue;
    const list = chargesOf.get(t.accountId);
    if (list) list.push(t);
    else chargesOf.set(t.accountId, [t]);
  }
  for (const list of chargesOf.values()) list.sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  const coverOf = (charge: Transaction): CardPayment | null =>
    (paymentsOf.get(charge.accountId) ?? []).find((p) => covers(charge, p.date.slice(0, 7))) ?? null;

  const roleOf = (t: Transaction): CardRole => {
    if (t.transferGroupId) {
      const payment = paymentByGroup.get(t.transferGroupId);
      if (payment) return t.id === payment.paying.id ? "payment" : t.id === payment.landing.id ? "cardSide" : "transfer";
      return "transfer";
    }
    return cards.has(t.accountId) ? "charge" : "regular";
  };

  const uncovered = (cardId: string) => (chargesOf.get(cardId) ?? []).filter((c) => coverOf(c) == null);

  const estimatesOf = new Map<string, CardEstimate[]>();
  for (const e of [...estimates].sort(byNoted)) {
    if (!cards.has(e.accountId)) continue;
    const list = estimatesOf.get(e.accountId);
    if (list) list.push(e);
    else estimatesOf.set(e.accountId, [e]);
  }

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
    paidInMonth: (charge) => {
      const covering = coverOf(charge);
      if (covering) return covering.date.slice(0, 7);
      // its own month's statement if that one's due on or after it, else the next
      const own = charge.dueDate.slice(0, 7);
      return covers(charge, own) ? own : nextMonth(own);
    },
    wouldCover: (cardId, month) => uncovered(cardId).filter((c) => covers(c, month)),
    estimates: (cardId) => estimatesOf.get(cardId) ?? [],
    expected: (cardId, month, asOf) =>
      (estimatesOf.get(cardId) ?? []).filter((e) => e.month === month && (asOf == null || e.notedOn <= asOf)).at(-1) ?? null,
  };
}

/**
 * A card's payment day in a month (yyyy-mm), clamped to the month's length:
 * the 31st is the 30th in November. Null when the card has no payment day.
 */
export function paymentDateIn(month: string, day: number | null): string | null {
  if (day == null) return null;
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(Math.min(Math.max(1, day), last)).padStart(2, "0")}`;
}

const CARD_WORDS = new Set(["cc", "card", "kart", "kredi", "credit"]);
const words = (text: string) =>
  text
    .toLocaleLowerCase("tr-TR")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 0);

/**
 * The card a description most likely names: "draft November - Akbank" names
 * CC Akbank. Each card's name, without words like "CC", is matched against
 * the description's words; the card with the largest share of its name found
 * wins, so "Akbank" picks CC Akbank over CC Tansu Akbank, and on a tie the one
 * more of whose name was said. Null when no card's name appears at all.
 */
export function guessCardFor(description: string, cards: readonly Account[]): Account | null {
  const said = new Set(words(description));
  let best: { card: Account; score: number; found: number } | null = null;
  for (const card of cards) {
    const name = words(card.name).filter((w) => !CARD_WORDS.has(w));
    if (name.length === 0) continue;
    const found = name.filter((w) => said.has(w)).length;
    const score = found / name.length;
    // a tie goes to the card more of whose name was said: "Tansu Akbank" is Tansu's
    if (found > 0 && (best == null || score > best.score || (score === best.score && found > best.found))) {
      best = { card, score, found };
    }
  }
  return best?.card ?? null;
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

/** What's tracked for each month: unmade payments and uncovered charges, earlier months folded into `fromMonth`. */
function trackedByMonth(book: CardBook, cardId: string, fromMonth: string): Map<string, number> {
  const months = new Map<string, number>();
  const add = (month: string, amount: number) => {
    const due = month < fromMonth ? fromMonth : month;
    months.set(due, (months.get(due) ?? 0) + amount);
  };
  for (const p of book.payments(cardId)) if (!p.made) add(p.date.slice(0, 7), p.amount);
  for (const c of book.uncovered(cardId)) add(book.paidInMonth(c), chargeAmount(c));
  return months;
}

/**
 * How much an expectation adds to a month: what it expects beyond what's
 * tracked, for each month from `fromMonth` whose payment isn't recorded yet.
 * The plan pays these on top of the tracked charges.
 */
export function estimateTopUps(book: CardBook, cardId: string, fromMonth: string): { month: string; amount: number; estimate: CardEstimate }[] {
  const tracked = trackedByMonth(book, cardId, fromMonth);
  const recorded = new Set(book.payments(cardId).map((p) => p.date.slice(0, 7)));
  const months = new Set(book.estimates(cardId).map((e) => e.month));
  const out: { month: string; amount: number; estimate: CardEstimate }[] = [];
  for (const month of [...months].sort()) {
    if (month < fromMonth || recorded.has(month)) continue;
    const estimate = book.expected(cardId, month)!;
    const amount = estimate.amount - (tracked.get(month) ?? 0);
    if (amount > 0.005) out.push({ month, amount, estimate });
  }
  return out;
}

/**
 * A card's bills month by month: payments recorded but not yet made, in the
 * month they're due, and charges no payment covers yet, in the month they'll
 * be paid (see paidInMonth). Anything that fell due before `fromMonth` is
 * still owed, so it's folded into `fromMonth` rather than dropped. A month
 * with an expectation and no payment recorded is the larger of the two. In
 * the card's own currency.
 */
export function cardSchedule(book: CardBook, cardId: string, fromMonth: string): { month: string; total: number }[] {
  const months = trackedByMonth(book, cardId, fromMonth);
  for (const { month, amount } of estimateTopUps(book, cardId, fromMonth)) months.set(month, (months.get(month) ?? 0) + amount);
  return [...months.entries()]
    .filter(([, total]) => Math.abs(total) > 0.005)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, total]) => ({ month, total }));
}

export interface CardStatement {
  /** yyyy-mm */
  month: string;
  /** the recorded payment's date, else the card's payment day that month */
  date: string | null;
  /** payments recorded for this month, made or not */
  payments: CardPayment[];
  /** the charges this month's statement pays (or will pay), by date */
  charges: Transaction[];
  /** what's paid or due: the recorded payments when there are any, else the charges or the expectation, whichever is more */
  amount: number;
  /** the charges' total, without the expectation */
  tracked: number;
  /**
   * the expectation that counts: for a month with a payment recorded, the
   * latest noted by that payment's date (what it's measured against); else
   * the latest noted
   */
  estimate: CardEstimate | null;
  /**
   * paid: every payment made · recorded: a payment set down, not all made ·
   * due: this month or earlier with nothing recorded · upcoming: later months
   */
  status: "paid" | "recorded" | "due" | "upcoming";
}

/**
 * A card's statements, month by month and newest first: what each payment
 * paid for, and what each month still to come will charge. Charges no payment
 * covers fall in the month they'll be paid (paidInMonth); one already late
 * folds into this month. Legacy history isn't a charge (CardBook.charges), so
 * only what's been tracked shows.
 */
export function cardStatements(book: CardBook, card: Account, today: string): CardStatement[] {
  const thisMonth = today.slice(0, 7);
  const byMonth = new Map<string, { payments: CardPayment[]; charges: Transaction[] }>();
  const slot = (month: string) => {
    let entry = byMonth.get(month);
    if (!entry) byMonth.set(month, (entry = { payments: [], charges: [] }));
    return entry;
  };
  for (const p of book.payments(card.id)) slot(p.date.slice(0, 7)).payments.push(p);
  for (const c of book.charges(card.id)) {
    const cover = book.coverOf(c);
    const month = cover ? cover.date.slice(0, 7) : book.paidInMonth(c);
    slot(!cover && month < thisMonth ? thisMonth : month).charges.push(c);
  }
  // a month ahead you've only an expectation for is a statement too
  for (const e of book.estimates(card.id)) if (e.month >= thisMonth) slot(e.month);
  return [...byMonth.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([month, { payments, charges }]) => {
      const recorded = payments.length > 0;
      const tracked = charges.reduce((sum, c) => sum + chargeAmount(c), 0);
      const estimate = book.expected(card.id, month, recorded ? payments[0].date : undefined);
      return {
        month,
        date: payments[0]?.date ?? paymentDateIn(month, card.paymentDay),
        payments,
        charges,
        amount: recorded ? payments.reduce((sum, p) => sum + p.amount, 0) : Math.max(tracked, estimate?.amount ?? 0),
        tracked,
        estimate,
        status: recorded
          ? payments.every((p) => p.made)
            ? ("paid" as const)
            : ("recorded" as const)
          : month <= thisMonth
            ? ("due" as const)
            : ("upcoming" as const),
      };
    })
    // an expectation of nothing, with nothing tracked, is no statement
    .filter((s) => s.payments.length > 0 || s.charges.length > 0 || s.amount > 0.005);
}

export interface NextCardPayment {
  /** yyyy-mm of the statement */
  month: string;
  /** the card's payment day in that month; null when it has none */
  date: string | null;
  /** in the card's currency */
  amount: number;
}

/**
 * The next statement you'll pay: the first month from this one with anything
 * due (cardSchedule), on the card's payment day. This month's, while it's
 * unpaid; next month's once it's paid. Null when nothing more is coming.
 */
export function nextCardPayment(book: CardBook, card: Account, today: string): NextCardPayment | null {
  const first = cardSchedule(book, card.id, today.slice(0, 7))[0];
  if (!first || first.total <= 0.005) return null;
  return { month: first.month, date: paymentDateIn(first.month, card.paymentDay), amount: first.total };
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

/**
 * The money of a debt itself, which moves a balance but is neither income nor
 * spending: what you borrowed or lent (Transaction.loanPrincipal), and any
 * money in on a debt, which is what you lent coming back. Repaying a debt you
 * owe isn't: that's spending, as it always was (lib/domain/debt.ts).
 */
export function isDebtPrincipal(t: Pick<Transaction, "loanPrincipal" | "loanId" | "direction">): boolean {
  return t.loanPrincipal === true || (t.loanId != null && t.direction === "income");
}

/** Counts as spending: an ordinary expense, or a payment into a card; not money you lend. */
export function isSpending(t: Transaction, book: CardBook): boolean {
  if (isDebtPrincipal(t)) return false;
  const role = book.roleOf(t);
  return role === "payment" || (role === "regular" && t.direction === "expense");
}

/** Counts as income: an ordinary income; never a transfer leg, anything on a card, or money in on a debt. */
export function isIncome(t: Transaction, book: CardBook): boolean {
  if (isDebtPrincipal(t)) return false;
  return book.roleOf(t) === "regular" && t.direction === "income";
}
