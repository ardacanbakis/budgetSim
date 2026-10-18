import { Account, Category, Transaction, TxDirection } from "@/lib/data/types";
import { addDays } from "@/lib/domain/recurrence";

/**
 * What the add sheet offers before anything is typed: the accounts and
 * categories this person actually uses, and the notes they've written
 * before. Pure functions over the lists the screens already load.
 */

export interface RememberedEntry {
  description: string;
  categoryId: string | null;
  accountId: string;
}

/** Rows a person typed themselves; transfers, adjustments and generated rows aren't. */
function typedByHand(tx: Transaction): boolean {
  return (
    tx.transferGroupId == null &&
    !tx.adjustment &&
    tx.purchaseId == null &&
    tx.victvsPayoutId == null &&
    tx.description.trim() !== ""
  );
}

const newestFirst = (a: Transaction, b: Transaction) =>
  b.dueDate.localeCompare(a.dueDate) || b.createdAt.localeCompare(a.createdAt);

/**
 * Up to `limit` earlier descriptions in this direction that start with what's
 * been typed (any case, Turkish İ/ı included when the locale is Turkish),
 * newest first, each once. Each carries the account and category of its most
 * recent use, so picking one fills those in too.
 */
export function descriptionSuggestions(
  transactions: readonly Transaction[],
  query: string,
  direction: TxDirection,
  locale: string,
  limit = 5
): RememberedEntry[] {
  const lang = locale === "tr" ? "tr-TR" : "en-US";
  const needle = query.trim().toLocaleLowerCase(lang);
  const seen = new Set<string>();
  const out: RememberedEntry[] = [];
  for (const tx of [...transactions].filter((t) => t.direction === direction && typedByHand(t)).sort(newestFirst)) {
    const description = tx.description.trim();
    const key = description.toLocaleLowerCase(lang);
    if (seen.has(key)) continue;
    seen.add(key);
    if (needle && !key.startsWith(needle)) continue;
    out.push({ description, categoryId: tx.categoryId, accountId: tx.accountId });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * The categories used most in this direction over the last `days` days,
 * most used first (ties: the more recent, then the list's own order). When
 * fewer than `limit` have been used, the rest of the direction's categories
 * follow in their own order, so a new account still has chips to tap.
 */
export function topCategories(
  transactions: readonly Transaction[],
  categories: readonly Category[],
  direction: TxDirection,
  today: string,
  limit = 8,
  days = 90
): Category[] {
  const since = addDays(today, -days);
  const own = categories.filter((c) => c.direction === direction);
  const count = new Map<string, number>();
  const last = new Map<string, string>();
  for (const tx of transactions) {
    if (tx.direction !== direction || tx.categoryId == null || tx.transferGroupId != null) continue;
    if (tx.dueDate < since || tx.dueDate > today) continue;
    count.set(tx.categoryId, (count.get(tx.categoryId) ?? 0) + 1);
    if ((last.get(tx.categoryId) ?? "") < tx.dueDate) last.set(tx.categoryId, tx.dueDate);
  }
  const order = new Map(own.map((c, i) => [c.id, i]));
  const used = own
    .filter((c) => count.has(c.id))
    .sort(
      (a, b) =>
        count.get(b.id)! - count.get(a.id)! ||
        (last.get(b.id) ?? "").localeCompare(last.get(a.id) ?? "") ||
        order.get(a.id)! - order.get(b.id)!
    );
  const rest = own.filter((c) => !count.has(c.id));
  return [...used, ...rest].slice(0, limit);
}

/**
 * The accounts to offer, in order: the one used last for this kind of entry
 * first, then every other active account in the list's own order (cards
 * included, as the Classic form allows). `keep` stays listed even when
 * archived: the account of an entry being edited.
 */
export function accountOrder(
  accounts: readonly Account[],
  lastUsedId?: string | null,
  keep?: string | null
): Account[] {
  const listed = accounts.filter((a) => !a.archived || a.id === keep);
  const first = listed.find((a) => a.id === lastUsedId);
  return first ? [first, ...listed.filter((a) => a !== first)] : listed;
}
