import { describe, expect, it } from "vitest";
import { IncompleteReadError, PageFetcher, selectAll } from "../paginate";

type Row = { id: string; n: number };

const rowsOf = (count: number): Row[] => Array.from({ length: count }, (_, i) => ({ id: `r${i}`, n: i }));

/**
 * A stand-in for PostgREST: serves `table` in the requested range, never more
 * than `maxRows` at once (the dashboard's "Max rows"), and reports the exact
 * count only when asked. `before` runs ahead of each request so a test can
 * change the table between pages, the way another device would.
 */
function server(table: Row[], maxRows: number, before?: (call: number) => void) {
  const calls: { from: number; to: number; withCount: boolean }[] = [];
  const fetchPage: PageFetcher<Row> = async (from, to, withCount) => {
    before?.(calls.length);
    calls.push({ from, to, withCount });
    const data = table.slice(from, Math.min(to + 1, from + maxRows));
    return { data, error: null, count: withCount ? table.length : null };
  };
  return { fetchPage, calls };
}

describe("selectAll", () => {
  it("reads past the default 1000-row cap", async () => {
    const table = rowsOf(2345);
    const { fetchPage, calls } = server(table, 1000);
    const rows = await selectAll("transactions", fetchPage);
    expect(rows).toHaveLength(2345);
    expect(rows.map((r) => r.n)).toEqual(table.map((r) => r.n));
    expect(calls.map((c) => c.from)).toEqual([0, 1000, 2000]);
  });

  it("asks for the count once, on the first page", async () => {
    const { fetchPage, calls } = server(rowsOf(2500), 1000);
    await selectAll("transactions", fetchPage);
    expect(calls.map((c) => c.withCount)).toEqual([true, false, false]);
  });

  it("still gets everything when Max rows is below the page size", async () => {
    const table = rowsOf(25);
    const { fetchPage, calls } = server(table, 10);
    const rows = await selectAll("transactions", fetchPage);
    expect(rows).toHaveLength(25);
    // steps by what came back, not by what was asked for
    expect(calls.map((c) => c.from)).toEqual([0, 10, 20]);
  });

  it("makes one request for a small table and none extra for an empty one", async () => {
    const small = server(rowsOf(5), 1000);
    expect(await selectAll("accounts", small.fetchPage)).toHaveLength(5);
    expect(small.calls).toHaveLength(1);

    const empty = server([], 1000);
    expect(await selectAll("accounts", empty.fetchPage)).toEqual([]);
    expect(empty.calls).toHaveLength(1);
  });

  it("drops the duplicate a row inserted mid-read pushes onto the next page, and still reaches the end", async () => {
    // newest-first order: a row materialized while we read sorts to the top
    // and shifts everything down by one
    const table = rowsOf(1500);
    const { fetchPage } = server(table, 1000, (call) => {
      if (call === 1) table.unshift({ id: "new", n: -1 });
    });
    const rows = await selectAll("transactions", fetchPage);
    const ids = rows.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    // every row that existed when the read began is there, oldest included
    expect(ids).toContain("r0");
    expect(ids).toContain("r1499");
  });

  it("fails loudly when rows vanish mid-read instead of returning a short ledger", async () => {
    const table = rowsOf(1500);
    const { fetchPage } = server(table, 1000, (call) => {
      if (call === 1) table.splice(0, 600);
    });
    await expect(selectAll("transactions", fetchPage)).rejects.toThrow(IncompleteReadError);
    await expect(selectAll("transactions", server(table.slice(), 1000).fetchPage)).resolves.toHaveLength(900);
  });

  it("names the table and the shortfall in the error", async () => {
    const table = rowsOf(1500);
    const { fetchPage } = server(table, 1000, (call) => {
      if (call === 1) table.splice(0, 600);
    });
    await expect(selectAll("transactions", fetchPage)).rejects.toThrow(/transactions.*1000 of 1500/);
  });

  it("passes database errors through", async () => {
    const failing: PageFetcher<Row> = async () => ({ data: null, error: { message: "JWT expired" }, count: null });
    await expect(selectAll("transactions", failing)).rejects.toThrow("JWT expired");
  });
});
