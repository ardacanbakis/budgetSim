/**
 * Reading a whole table through PostgREST, which caps every response at the
 * project's "Max rows" (1000 unless someone raised it) and drops the rest
 * without an error. Ordered newest first, that silently loses the oldest
 * history — and with it every balance, card debt and backup built on it.
 */

import { IncompleteReadError, toDbError } from "./errors";

export const PAGE_SIZE = 1000;

export interface PageResult<T> {
  data: T[] | null;
  error: { message: string; code?: string; details?: string; hint?: string } | null;
  count?: number | null;
}

/** One page: rows [from, to] inclusive; `withCount` asks for the exact total too. */
export type PageFetcher<T> = (from: number, to: number, withCount: boolean) => PromiseLike<PageResult<T>>;

/**
 * Every row a query matches. The first request also asks for the exact count,
 * then pages follow until that many have arrived. Each step moves on by what
 * actually came back rather than by what was asked for, so a "Max rows" below
 * PAGE_SIZE still gets everything, just in more requests.
 *
 * The query must have a total order (end it on a unique column) or pages can
 * overlap. A row written while the read is in flight can still shift one page
 * against the next: duplicates are dropped by id, and reading goes on until
 * the count is met. Coming up short throws instead of handing back a ledger
 * with a hole in it.
 */
export async function selectAll<T extends { id: string }>(
  table: string,
  fetchPage: PageFetcher<T>,
  pageSize: number = PAGE_SIZE
): Promise<T[]> {
  const byId = new Map<string, T>();
  let total: number | null = null;
  let offset = 0;
  for (;;) {
    const { data, error, count } = await fetchPage(offset, offset + pageSize - 1, total == null);
    if (error) throw toDbError(error);
    if (total == null) total = count ?? null;
    const page = data ?? [];
    if (!page.length) break;
    const before = byId.size;
    for (const row of page) if (!byId.has(row.id)) byId.set(row.id, row);
    // a server that ignores the range would hand back the same page forever
    if (byId.size === before) break;
    offset += page.length;
    if (total == null ? page.length < pageSize : byId.size >= total) break;
  }
  if (total != null && byId.size < total) throw new IncompleteReadError(table, byId.size, total);
  return [...byId.values()];
}
