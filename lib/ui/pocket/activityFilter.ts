import { Account, Category, Transaction } from "@/lib/data/types";
import { addDays } from "@/lib/domain/recurrence";
import { groupMonthsDays, GroupOptions, isTransferLanding } from "./dayGroups";

/**
 * What Pocket's Activity screen lists, and under which filters. Pure, so the
 * chips, the search and the "needs action" card can be checked against the
 * Classic ledger's own rules (app/(app)/transactions/page.tsx).
 *
 * - The filters: a search, one account, Planned or Overdue (one at a time),
 *   Income or Expense (one at a time), and the order. toggleChip() keeps the
 *   pairs exclusive and flips the order to oldest first while Planned or
 *   Overdue is on (what's due soonest first), back to newest when it's off.
 * - applyFilters(rows, options): the history list.
 *   - Planned on: every planned row; Overdue on: planned rows dated before
 *     today; neither: completed rows (planned ones live in the "needs action"
 *     card above). A search looks through both, since a search should find a
 *     row wherever it is.
 *   - account: rows on that account (both legs of a transfer reach it);
 *     direction: tx.direction, as the Classic filter has it.
 *   - search: locale-aware lower-casing and containment over the description,
 *     the category name and the account name. The Turkish dotted and dotless
 *     i fold together, as do accents, so "dentist", "DENTİST" and "DENTIST"
 *     find the same row under either language.
 * - scopeRows(rows, options): the same, minus the status rule: what the
 *   "needs action" card and the chip counts start from.
 * - needsAction(scoped, { today, days, accountId }): planned rows overdue,
 *   coming within `days` (today included), and how many are later. A
 *   transfer counts once, as the leg that leaves, unless one account is
 *   shown (then the leg on it is the one).
 * - netOf(rows, groupOptions): what rows add up to, by the month headers'
 *   own rule (dayGroups.groupMonthsDays): in the display currency, or in the
 *   account's with an accountId.
 * - filtersFromParams({ filter, account, q }): a deep link's filters
 *   (?filter=overdue|planned, ?account=id, ?q=text).
 * - monthsAhead(months, filters, today): how many months a newest-first
 *   search folds away at the top, so the list opens at this month (or at
 *   the nearest months found, when they're all ahead).
 */

export type ActivitySort = "newest" | "oldest";
export type ActivityChip = "planned" | "overdue" | "income" | "expense";

export interface ActivityFilters {
  search: string;
  accountId: string | null;
  planned: boolean;
  overdue: boolean;
  direction: "income" | "expense" | null;
  sort: ActivitySort;
}

export const NO_FILTERS: ActivityFilters = {
  search: "",
  accountId: null,
  planned: false,
  overdue: false,
  direction: null,
  sort: "newest",
};

export interface FilterContext {
  /** yyyy-mm-dd */
  today: string;
  categoriesById: ReadonlyMap<string, Category>;
  accountsById: ReadonlyMap<string, Account>;
  locale: string;
}

export type FilterOptions = ActivityFilters & FilterContext;

/** History pages: three months at a time. */
export const MONTHS_PER_PAGE = 3;

/**
 * Text folded for matching: lower-cased by the language's rules, then with
 * the Turkish dotted/dotless i and accents folded, so İ, I, ı and i are one
 * letter and "odeme" finds "Ödeme".
 */
export function foldSearch(text: string, locale: string): string {
  return text
    .toLocaleLowerCase(locale === "tr" ? "tr-TR" : "en-US")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .trim();
}

export function matchesSearch(tx: Transaction, folded: string, ctx: Omit<FilterContext, "today">): boolean {
  if (!folded) return true;
  const category = tx.categoryId ? ctx.categoriesById.get(tx.categoryId)?.name : undefined;
  const account = ctx.accountsById.get(tx.accountId)?.name;
  return [tx.description, category, account].some((field) => field != null && foldSearch(field, ctx.locale).includes(folded));
}

/** Search, account and direction: everything but the status chips. */
export function scopeRows(rows: readonly Transaction[], options: FilterOptions): Transaction[] {
  const folded = foldSearch(options.search, options.locale);
  return rows.filter(
    (tx) =>
      (options.accountId == null || tx.accountId === options.accountId) &&
      (options.direction == null || tx.direction === options.direction) &&
      matchesSearch(tx, folded, options)
  );
}

function compareRows(a: Transaction, b: Transaction): number {
  if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Which rows the history shows under these filters. */
export function historyStatus(filters: Pick<ActivityFilters, "planned" | "overdue" | "search">): "planned" | "overdue" | "completed" | "all" {
  if (filters.overdue) return "overdue";
  if (filters.planned) return "planned";
  return filters.search.trim() ? "all" : "completed";
}

export function applyFilters(rows: readonly Transaction[], options: FilterOptions): Transaction[] {
  const status = historyStatus(options);
  const kept = scopeRows(rows, options).filter((tx) => {
    switch (status) {
      case "overdue":
        return tx.status === "planned" && tx.dueDate < options.today;
      case "planned":
        return tx.status === "planned";
      case "completed":
        return tx.status === "completed";
      default:
        return true;
    }
  });
  const sign = options.sort === "newest" ? -1 : 1;
  return kept.sort((a, b) => sign * compareRows(a, b));
}

/**
 * A chip tapped: Planned and Overdue exclude each other, as do Income and
 * Expense. Turning Planned or Overdue on lists oldest first (soonest due);
 * turning both off goes back to newest first.
 */
export function toggleChip(filters: ActivityFilters, chip: ActivityChip): ActivityFilters {
  switch (chip) {
    case "planned":
    case "overdue": {
      const on = !filters[chip];
      const other = chip === "planned" ? "overdue" : "planned";
      return { ...filters, [chip]: on, [other]: false, sort: on ? "oldest" : "newest" };
    }
    case "income":
    case "expense":
      return { ...filters, direction: filters.direction === chip ? null : chip };
  }
}

/** Anything narrowing the list (the order isn't a filter). */
export function hasActiveFilters(filters: ActivityFilters): boolean {
  return (
    filters.search.trim() !== "" || filters.accountId != null || filters.planned || filters.overdue || filters.direction != null
  );
}

export interface NeedsAction {
  /** planned, dated before today: oldest first */
  overdue: Transaction[];
  /** planned, today to today + days: soonest first */
  coming: Transaction[];
  /** planned rows further ahead than that */
  later: number;
}

export function needsAction(
  scoped: readonly Transaction[],
  { today, days, accountId }: { today: string; days: number; accountId?: string | null }
): NeedsAction {
  const horizon = addDays(today, days);
  const overdue: Transaction[] = [];
  const coming: Transaction[] = [];
  let later = 0;
  for (const tx of scoped) {
    if (tx.status !== "planned") continue;
    // a transfer is listed once: the leg that leaves, or the one on the account shown
    if (accountId == null && isTransferLanding(tx)) continue;
    if (tx.dueDate < today) overdue.push(tx);
    else if (tx.dueDate <= horizon) coming.push(tx);
    else later += 1;
  }
  overdue.sort(compareRows);
  coming.sort(compareRows);
  return { overdue, coming, later };
}

/**
 * How many of `months` (newest first) a search folds away at the top: those
 * after this month. A search lists planned rows too, and the year of them
 * the recurring items keep ahead would otherwise open the list, with what
 * was found a dozen months down; they wait behind "Show later months".
 * When every month found is ahead (an item that hasn't started yet), the
 * nearest page of them stays open instead. Nothing folds when Planned or
 * Overdue is on, or when the list is oldest first.
 */
export function monthsAhead(
  months: readonly { month: string }[],
  filters: Pick<ActivityFilters, "planned" | "overdue" | "search" | "sort">,
  today: string
): number {
  if (filters.sort !== "newest" || historyStatus(filters) !== "all") return 0;
  const thisMonth = today.slice(0, 7);
  let ahead = 0;
  while (ahead < months.length && months[ahead].month > thisMonth) ahead += 1;
  return ahead === months.length ? Math.max(0, ahead - MONTHS_PER_PAGE) : ahead;
}

/** What rows add up to, by the month headers' rule (null-safe on missing rates: those rows are left out). */
export function netOf(rows: readonly Transaction[], options: GroupOptions): number {
  return groupMonthsDays(rows, options).reduce((sum, month) => sum + month.net, 0);
}

export interface DeepLink {
  filter?: string | null;
  account?: string | null;
  q?: string | null;
}

export function filtersFromParams(link: DeepLink): ActivityFilters {
  let filters: ActivityFilters = { ...NO_FILTERS, search: link.q ?? "", accountId: link.account || null };
  if (link.filter === "planned" || link.filter === "overdue") filters = toggleChip(filters, link.filter);
  return filters;
}
