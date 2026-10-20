import { Transaction } from "@/lib/data/types";
import { CardBook } from "@/lib/domain/cards";
import { isLongOverdue } from "./attention";

/**
 * Selection mode in Pocket's Activity (bulk actions), as pure helpers.
 *
 * - toggleSelected(selected, id) / pruneSelected(selected, rows): the set of
 *   chosen ids, a new Set each time; pruning drops ids no longer listed (a
 *   filter changed, a row was deleted elsewhere).
 * - bulkPlan(rows, book, today): what the bar can do with the chosen rows.
 *   Only a planned row that isn't a card's instalment can be marked paid
 *   (the single-row ✓ rule); every row can be deleted. A transfer is one
 *   write either way (the repo moves and deletes both legs together), so
 *   a transfer chosen twice counts once. `legacyFirst` is the rule that
 *   pre-ticks "complete as legacy": every row to mark paid is more than
 *   three months overdue (isLongOverdue, as in the single-row sheet).
 * - runInTurn(items, write, onProgress): the writes one after another,
 *   stopping at the first that fails, because a batch of separate writes
 *   isn't atomic: what's done is done, and the rest stay chosen to retry.
 */

export function toggleSelected(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** The chosen ids still listed; the same Set when nothing went. */
export function pruneSelected(selected: ReadonlySet<string>, rows: readonly Transaction[]): ReadonlySet<string> {
  const listed = new Set(rows.map((tx) => tx.id));
  const kept = [...selected].filter((id) => listed.has(id));
  return kept.length === selected.size ? selected : new Set(kept);
}

export interface BulkPlan {
  /** planned rows that can be marked paid, a transfer once */
  completable: Transaction[];
  /** every chosen row, a transfer once */
  removable: Transaction[];
  /** chosen rows that can't be marked paid (already paid, or a card's instalment) */
  skipped: number;
  /** every row to mark paid is long overdue: "as legacy" comes first */
  legacyFirst: boolean;
}

/** One row per write: a transfer's second leg is the same write as its first. */
function onePerWrite(rows: readonly Transaction[]): Transaction[] {
  const groups = new Set<string>();
  return rows.filter((tx) => {
    if (!tx.transferGroupId) return true;
    if (groups.has(tx.transferGroupId)) return false;
    groups.add(tx.transferGroupId);
    return true;
  });
}

export function bulkPlan(rows: readonly Transaction[], book: Pick<CardBook, "roleOf">, today: string): BulkPlan {
  const removable = onePerWrite(rows);
  const completable = removable.filter((tx) => tx.status === "planned" && book.roleOf(tx) !== "charge");
  return {
    completable,
    removable,
    skipped: removable.length - completable.length,
    legacyFirst: completable.length > 0 && completable.every((tx) => isLongOverdue(tx, today)),
  };
}

export interface RunResult<T> {
  /** written, in order */
  done: T[];
  /** the item whose write failed, and why; the ones after it weren't tried */
  failed?: { item: T; error: unknown };
}

export async function runInTurn<T>(
  items: readonly T[],
  write: (item: T) => Promise<unknown>,
  onProgress?: (done: number, total: number) => void
): Promise<RunResult<T>> {
  const done: T[] = [];
  onProgress?.(0, items.length);
  for (const item of items) {
    try {
      await write(item);
    } catch (error) {
      return { done, failed: { item, error } };
    }
    done.push(item);
    onProgress?.(done.length, items.length);
  }
  return { done };
}
