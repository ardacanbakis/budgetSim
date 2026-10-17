import { Account, Transaction } from "@/lib/data/types";
import { computeNetWorth } from "@/lib/domain/balances";
import { CardBook, totalOwed } from "@/lib/domain/cards";
import { Currency } from "@/lib/domain/currencies";
import { DebtItem, DebtOverview } from "@/lib/domain/debt";
import { convert, UsdPerMap } from "@/lib/domain/fx";

/**
 * Pocket Portfolio (/accounts) as plain data: which accounts go in which
 * section, the figure each row shows, and every subtotal in the display
 * currency. Pure, so the totals can be checked against the Dashboard's own
 * arithmetic (computeNetWorth − what the cards are owed).
 *
 * - sections(input) → cash, cryptoGold, cards, loans, archived, totals:
 *   - Cash & bank: kind fiat. Crypto & gold: crypto and gold. Archived
 *     accounts only in `archived`.
 *   - a row's figure is its balance in its own currency, except a gold
 *     account holding coins, which reads in lira (the Classic page's
 *     figure() rule); its ≈ is the same either way.
 *   - a card's figure is −owed (CardBook.owed), never its ledger balance.
 *   - loans are computeDebtOverview's loan items, at −outstanding.
 *   - subtotals convert each account's own balance to the display currency
 *     and skip one with no rate, as computeNetWorth does; null without rates.
 *   - totals.all = computeNetWorth − totalOwed: the Dashboard's net worth
 *     (useDashboardData's netWorth.total). totals.assets = cash + crypto &
 *     gold. totals.debts = −computeDebtOverview's totalInDisplay.
 *   - hideEmpty leaves accounts at zero (a card owing nothing) out of the
 *     rows, never out of a subtotal; emptyCount says how many there are.
 * - accountLine(account, …): one account's row, as sections() builds it.
 * - SEGMENT_SECTIONS: what each segment of the hero shows.
 * - canAdjust(account): the Classic "Adjust balance" rule — not a card, not
 *   a gold account holding coins (corrected by editing its holdings), not
 *   archived.
 * - accountFeed(transactions, accountId): an account page's rows — what's
 *   planned, oldest first, and what's completed (for groupMonthsDays with
 *   accountId, as the Classic history's completedMonths).
 */

export const PORTFOLIO_SEG_KEY = "renovator-pocket-portfolio-seg";
export const ARCHIVED_OPEN_KEY = "renovator-pocket-archived-open";
export const PORTFOLIO_SCROLL_KEY = "renovator-pocket-portfolio-scroll";
/** the Classic page's own toggle, shared so both layouts agree */
export const HIDE_EMPTY_KEY = "renovator-portfolio-hide-empty";

export type PortfolioSegment = "all" | "assets" | "debts";
export const PORTFOLIO_SEGMENTS: readonly PortfolioSegment[] = ["all", "assets", "debts"];
export const isPortfolioSegment = (v: string): v is PortfolioSegment => (PORTFOLIO_SEGMENTS as readonly string[]).includes(v);

export type SectionKey = "cash" | "cryptoGold" | "cards" | "loans";
export const SEGMENT_SECTIONS: Record<PortfolioSegment, readonly SectionKey[]> = {
  all: ["cash", "cryptoGold", "cards", "loans"],
  assets: ["cash", "cryptoGold"],
  debts: ["cards", "loans"],
};

/** a gold account holding coins: it reads in lira, and is corrected by editing what it holds */
export const isMixedGold = (a: Account): boolean => a.kind === "gold" && (a.holdings?.length ?? 0) > 0;

/** The Classic Adjust button's rule. */
export const canAdjust = (a: Account): boolean => !a.archived && a.kind !== "credit_card" && !isMixedGold(a);

export interface CardInfo {
  /** what the card is owed today, positive */
  owed: number;
  limit: number | null;
  /** owed ÷ limit for the bar, 0–1; null without a limit */
  used: number | null;
  /** owed more than the limit */
  over: boolean;
  paymentDay: number | null;
}

export interface AccountLine {
  account: Account;
  /** in the account's own currency; a card: −owed */
  balance: number;
  /** what the row shows first: lira for a gold account holding coins, else `balance` */
  shown: { amount: number; currency: Currency };
  /** `balance` in the display currency; null without a rate */
  converted: number | null;
  /** at zero: hidden by "hide empty" */
  empty: boolean;
  card?: CardInfo;
}

export interface LoanLine {
  item: DebtItem;
  /** −outstanding, in the loan's currency */
  amount: number;
  /** `amount` in the display currency; null without a rate */
  converted: number | null;
}

export interface PortfolioSection<T> {
  rows: T[];
  /** in the display currency; null without rates */
  subtotal: number | null;
}

export interface PortfolioSections {
  cash: PortfolioSection<AccountLine>;
  cryptoGold: PortfolioSection<AccountLine>;
  cards: PortfolioSection<AccountLine>;
  loans: PortfolioSection<LoanLine>;
  archived: AccountLine[];
  /** open accounts at zero, listed or not */
  emptyCount: number;
  totals: { all: number | null; assets: number | null; debts: number | null };
}

export interface SectionsInput {
  accounts: readonly Account[];
  /** computeBalances, at today's gold ratios */
  balances: ReadonlyMap<string, number>;
  book: CardBook;
  /** computeDebtOverview; null while loans load */
  debt: DebtOverview | null;
  usdPer: UsdPerMap | null | undefined;
  display: Currency;
  hideEmpty: boolean;
  today: string;
}

const EPSILON = 1e-9;

/** One account's row: what it shows, in what, and its ≈. */
export function accountLine(
  a: Account,
  input: Pick<SectionsInput, "balances" | "book" | "usdPer" | "display" | "today">
): AccountLine {
  const { balances, book, usdPer, display, today } = input;
  const converted = (amount: number) => (usdPer ? convert(amount, a.currency, display, usdPer) : null);
  if (a.kind === "credit_card") {
    const owed = book.owed(a.id, today);
    const limit = a.creditLimit != null && a.creditLimit > 0 ? a.creditLimit : null;
    // a card in credit (a refund) owes less than nothing: it adds, as totalOwed has it
    const balance = owed === 0 ? 0 : -owed;
    return {
      account: a,
      balance,
      shown: { amount: balance, currency: a.currency },
      converted: converted(balance),
      empty: Math.abs(owed) <= 0.005,
      card: {
        owed,
        limit,
        used: limit != null ? Math.min(1, Math.max(0, owed / limit)) : null,
        over: limit != null && owed > limit + 0.005,
        paymentDay: a.paymentDay,
      },
    };
  }
  const balance = balances.get(a.id) ?? 0;
  let shown = { amount: balance, currency: a.currency };
  if (isMixedGold(a) && usdPer) {
    const inTry = convert(balance, a.currency, "TRY", usdPer);
    if (inTry != null) shown = { amount: inTry, currency: "TRY" };
  }
  return { account: a, balance, shown, converted: converted(balance), empty: Math.abs(balance) <= EPSILON };
}

function section(lines: AccountLine[], hideEmpty: boolean, rated: boolean): PortfolioSection<AccountLine> {
  let subtotal = 0;
  for (const l of lines) if (l.converted != null) subtotal += l.converted;
  return { rows: hideEmpty ? lines.filter((l) => !l.empty) : lines, subtotal: rated ? subtotal : null };
}

export function sections(input: SectionsInput): PortfolioSections {
  const { accounts, balances, book, debt, usdPer, display, hideEmpty, today } = input;
  const rated = usdPer != null;
  const open = accounts.filter((a) => !a.archived).map((a) => accountLine(a, input));

  const cash = section(open.filter((l) => l.account.kind === "fiat"), hideEmpty, rated);
  const cryptoGold = section(
    open.filter((l) => l.account.kind === "crypto" || l.account.kind === "gold"),
    hideEmpty,
    rated
  );
  const cards = section(open.filter((l) => l.account.kind === "credit_card"), hideEmpty, rated);

  const loanRows: LoanLine[] = (debt?.items ?? [])
    .filter((i) => i.kind === "loan")
    .map((item) => ({
      item,
      amount: -item.outstanding,
      converted: usdPer ? convert(-item.outstanding, item.currency, display, usdPer) : null,
    }));
  let loanTotal = 0;
  for (const l of loanRows) if (l.converted != null) loanTotal += l.converted;
  const loans = { rows: loanRows, subtotal: rated && debt ? loanTotal : null };

  const archived = accounts.filter((a) => a.archived).map((a) => accountLine(a, input));

  let all: number | null = null;
  if (usdPer) {
    const list = accounts as Account[];
    all =
      computeNetWorth(list, balances as Map<string, number>, usdPer, display).total -
      totalOwed(book, list, today, usdPer, display);
  }
  const assets = cash.subtotal != null && cryptoGold.subtotal != null ? cash.subtotal + cryptoGold.subtotal : null;
  const debts = usdPer && debt ? -debt.totalInDisplay : null;

  return {
    cash,
    cryptoGold,
    cards,
    loans,
    archived,
    emptyCount: open.filter((l) => l.empty).length,
    totals: { all, assets, debts },
  };
}

/** The hero's figure for a segment. */
export function segmentTotal(s: PortfolioSections, seg: PortfolioSegment): number | null {
  return s.totals[seg];
}

/** Day of month as an ordinal: "15th" (en) / "15." (tr), as the Classic page writes it. */
export function ordinal(day: number, locale: string): string {
  if (locale === "tr") return `${day}.`;
  const rem100 = day % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${day}th`;
  const suffix = ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[day % 10] ?? "th";
  return `${day}${suffix}`;
}

/** An account page's rows: planned (oldest first) and completed. */
export function accountFeed(
  transactions: readonly Transaction[],
  accountId: string
): { upcoming: Transaction[]; completed: Transaction[] } {
  const mine = transactions.filter((tx) => tx.accountId === accountId);
  const upcoming = mine
    .filter((tx) => tx.status === "planned")
    .sort((a, b) =>
      a.dueDate !== b.dueDate ? (a.dueDate < b.dueDate ? -1 : 1) : a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0
    );
  return { upcoming, completed: mine.filter((tx) => tx.status === "completed") };
}

/** A stored scroll offset, or null when there's none worth restoring. */
export function parseScroll(raw: string | null): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}
