import { Account, Transaction } from "@/lib/data/types";
import { BudgetStatus } from "@/lib/domain/budgets";
import { CardBook, isIncome, isSpending } from "@/lib/domain/cards";
import { Currency } from "@/lib/domain/currencies";
import { convert, UsdPerMap } from "@/lib/domain/fx";
import { addDays } from "@/lib/domain/recurrence";
import { ComingUpItem } from "./attention";
import { isTransferLanding } from "./dayGroups";
import { POCKET_KEYS } from "./prefs";

/**
 * What Pocket's Home shows, and in which order. Pure, so the arithmetic can be
 * checked against the Classic screens' own rules.
 *
 * Sections (below the hero, which never moves or hides):
 * - SECTION_IDS, the default order: Coming up, Accounts, Budgets, Recent
 *   activity; then Monthly flow, Goals and Gold, hidden.
 * - decodeSections(saved) / encodeSections(entries): one list of ids, hidden
 *   ones marked with a leading "!" (["comingUp", "!recent", …]), the same
 *   contract as navEntries in components/shell.nav.ts: unknown ids and
 *   repeats are dropped, ids missing from the list (added since it was
 *   saved) are appended in their default state. parseSections /
 *   serializeSections read and write that list as the stored JSON string
 *   (HOME_SECTIONS_KEY, on the device only; Classic's dashboardLayout in
 *   user_settings is never touched).
 * - moveSection(entries, id, ±1), canMove, toggleSection(entries, id),
 *   resetSections(), shownSections(entries).
 *
 * What the sections list:
 * - recentRows(transactions, book, accountsById, today): completed rows
 *   dated in the last RECENT_DAYS days (today included, nothing ahead of
 *   today), as a ledger lists them (no card charges, no card-side or
 *   landing legs), newest first, at most RECENT_LIMIT.
 * - comingUpTotal(items, …): what the dated "Coming up" rows add up to in
 *   the display currency: planned income in, planned spending and card
 *   statements out; a transfer between your own accounts and the undated
 *   VICTVS row count for nothing. Null without rates.
 * - accountTiles(…): open accounts by the size of their display value, cards
 *   last showing what they're owed (as a negative). A gold account holding a
 *   mix of coins reads in lira (the Portfolio page's figure() rule).
 * - topBudgets(statuses, n): the n most used budgets, by percent spent.
 *
 * splitAtSlot(text): a sentence translated with AMOUNT_SLOT in place of its
 * figure ("Next 7 days · {amount}"), cut either side of it, so the figure
 * alone can carry data-amount and blur when amounts are hidden.
 */

export const SECTION_IDS = ["comingUp", "accounts", "budgets", "recent", "flow", "goals", "gold"] as const;
export type SectionId = (typeof SECTION_IDS)[number];

/** The device key Home's order and hidden sections live under. */
export const HOME_SECTIONS_KEY = POCKET_KEYS.home;

const HIDDEN = "!";
const HIDDEN_BY_DEFAULT: ReadonlySet<SectionId> = new Set(["flow", "goals", "gold"]);

export interface SectionEntry {
  id: SectionId;
  hidden: boolean;
}

export const isSectionId = (v: string): v is SectionId => (SECTION_IDS as readonly string[]).includes(v);

export function resetSections(): SectionEntry[] {
  return SECTION_IDS.map((id) => ({ id, hidden: HIDDEN_BY_DEFAULT.has(id) }));
}

export function decodeSections(saved: readonly unknown[] | null | undefined): SectionEntry[] {
  const result: SectionEntry[] = [];
  const seen = new Set<SectionId>();
  for (const raw of saved ?? []) {
    if (typeof raw !== "string") continue;
    const marked = raw.startsWith(HIDDEN);
    const id = marked ? raw.slice(HIDDEN.length) : raw;
    if (!isSectionId(id) || seen.has(id)) continue;
    seen.add(id);
    result.push({ id, hidden: marked });
  }
  for (const id of SECTION_IDS) if (!seen.has(id)) result.push({ id, hidden: HIDDEN_BY_DEFAULT.has(id) });
  return result;
}

export function encodeSections(entries: readonly SectionEntry[]): string[] {
  return entries.map((e) => (e.hidden ? HIDDEN : "") + e.id);
}

/** The stored string → entries; anything unreadable is the default. */
export function parseSections(stored: string | null | undefined): SectionEntry[] {
  if (!stored) return resetSections();
  try {
    const value: unknown = JSON.parse(stored);
    return Array.isArray(value) ? decodeSections(value) : resetSections();
  } catch {
    return resetSections();
  }
}

export function serializeSections(entries: readonly SectionEntry[]): string {
  return JSON.stringify(encodeSections(entries));
}

export function canMove(entries: readonly SectionEntry[], id: SectionId, delta: -1 | 1): boolean {
  const index = entries.findIndex((e) => e.id === id);
  return index >= 0 && index + delta >= 0 && index + delta < entries.length;
}

/** One place up (−1) or down (+1); at either end, unchanged. */
export function moveSection(entries: readonly SectionEntry[], id: SectionId, delta: -1 | 1): SectionEntry[] {
  const next = [...entries];
  if (!canMove(entries, id, delta)) return next;
  const index = next.findIndex((e) => e.id === id);
  [next[index], next[index + delta]] = [next[index + delta], next[index]];
  return next;
}

export function toggleSection(entries: readonly SectionEntry[], id: SectionId): SectionEntry[] {
  return entries.map((e) => (e.id === id ? { ...e, hidden: !e.hidden } : e));
}

/** The sections to draw, in order. */
export function shownSections(entries: readonly SectionEntry[]): SectionId[] {
  return entries.filter((e) => !e.hidden).map((e) => e.id);
}

/* ------------------------------------------------------------------ */

/** Home's "Recent activity": this many days back, at most this many rows. */
export const RECENT_DAYS = 7;
export const RECENT_LIMIT = 8;
/** "Coming up" rows shown before "See all (n)". */
export const COMING_UP_ROWS = 6;

function newestFirst(a: Transaction, b: Transaction): number {
  if (a.dueDate !== b.dueDate) return a.dueDate > b.dueDate ? -1 : 1;
  if (a.createdAt !== b.createdAt) return a.createdAt > b.createdAt ? -1 : 1;
  return a.id > b.id ? -1 : a.id < b.id ? 1 : 0;
}

export function recentRows(
  transactions: readonly Transaction[],
  book: CardBook,
  accountsById: ReadonlyMap<string, Account>,
  today: string,
  { days = RECENT_DAYS, limit = RECENT_LIMIT }: { days?: number; limit?: number } = {}
): Transaction[] {
  const from = addDays(today, -days);
  return transactions
    .filter((tx) => {
      if (tx.status !== "completed" || tx.dueDate < from || tx.dueDate > today) return false;
      if (!accountsById.has(tx.accountId) || isTransferLanding(tx)) return false;
      const role = book.roleOf(tx);
      return role !== "charge" && role !== "cardSide";
    })
    .sort(newestFirst)
    .slice(0, limit);
}

export function comingUpTotal(
  items: readonly ComingUpItem[],
  { book, usdPer, display }: { book: CardBook; usdPer: UsdPerMap | null | undefined; display: Currency }
): number | null {
  if (!usdPer) return null;
  let total = 0;
  for (const item of items) {
    if (item.kind === "victvs") continue;
    if (item.kind === "card") {
      total -= convert(item.figure.amount, item.account.currency, display, usdPer) ?? 0;
      continue;
    }
    const income = isIncome(item.tx, book);
    if (!income && !isSpending(item.tx, book)) continue;
    const converted = convert(item.tx.amount, item.account.currency, display, usdPer) ?? 0;
    total += income ? converted : -converted;
  }
  return total;
}

export interface AccountTile {
  account: Account;
  /** the figure the tile leads with, in `currency` */
  amount: number;
  currency: Currency;
  /** the balance in the display currency; null without a rate */
  display: number | null;
  card: boolean;
}

export function accountTiles(params: {
  accounts: readonly Account[];
  balances: ReadonlyMap<string, number>;
  book: CardBook;
  today: string;
  usdPer: UsdPerMap | null | undefined;
  display: Currency;
}): AccountTile[] {
  const { accounts, balances, book, today, usdPer, display } = params;
  const tiles: AccountTile[] = [];
  for (const account of accounts) {
    if (account.archived) continue;
    const card = account.kind === "credit_card";
    const balance = card ? -book.owed(account.id, today) : (balances.get(account.id) ?? 0);
    const inDisplay = usdPer ? convert(balance, account.currency, display, usdPer) : null;
    const mixed = account.kind === "gold" && (account.holdings?.length ?? 0) > 0;
    const inTry = mixed && usdPer ? convert(balance, account.currency, "TRY", usdPer) : null;
    tiles.push({
      account,
      amount: inTry ?? balance,
      currency: inTry != null ? "TRY" : account.currency,
      display: inDisplay,
      card,
    });
  }
  const size = (t: AccountTile) => (t.display == null ? -1 : Math.abs(t.display));
  return tiles.sort((a, b) => {
    if (a.card !== b.card) return a.card ? 1 : -1;
    if (size(a) !== size(b)) return size(b) - size(a);
    return a.account.name.localeCompare(b.account.name);
  });
}

export function topBudgets(statuses: readonly BudgetStatus[], n = 3): BudgetStatus[] {
  return [...statuses].sort((a, b) => b.pct - a.pct).slice(0, n);
}

/** Stands in for a figure inside a translated sentence; see splitAtSlot. */
export const AMOUNT_SLOT = "\u0000amount\u0000";

/** The text before and after the figure; null when the sentence has no slot. */
export function splitAtSlot(text: string): [string, string] | null {
  const at = text.indexOf(AMOUNT_SLOT);
  if (at < 0) return null;
  return [text.slice(0, at), text.slice(at + AMOUNT_SLOT.length)];
}
