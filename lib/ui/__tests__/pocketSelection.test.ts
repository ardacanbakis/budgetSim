import { describe, expect, it } from "vitest";
import { Transaction } from "@/lib/data/types";
import { CardRole } from "@/lib/domain/cards";
import { bulkPlan, pruneSelected, runInTurn, toggleSelected } from "../pocket/selection";

let seq = 0;
function tx(dueDate: string, overrides: Partial<Transaction> = {}): Transaction {
  seq += 1;
  return {
    id: `t${seq}`,
    accountId: "a",
    direction: "expense",
    categoryId: null,
    amount: 100,
    status: "planned",
    dueDate,
    completedAt: null,
    description: `row ${seq}`,
    fxSnapshot: null,
    transferGroupId: null,
    transferMarketRate: null,
    recurringTemplateId: null,
    loanId: null,
    victvsPayoutId: null,
    purchaseId: null,
    legacy: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const today = "2026-10-16";
const book = (charges: Transaction[] = []) => ({
  roleOf: (t: Transaction): CardRole => (charges.includes(t) ? "charge" : "regular"),
});

describe("selection", () => {
  it("toggles an id in and out, a new set each time", () => {
    const empty = new Set<string>();
    const one = toggleSelected(empty, "a");
    expect([...one]).toEqual(["a"]);
    expect(empty.size).toBe(0);
    expect([...toggleSelected(one, "a")]).toEqual([]);
  });

  it("prunes ids that are no longer listed, and keeps the same set when none went", () => {
    const a = tx("2026-10-01");
    const b = tx("2026-10-02");
    const selected = new Set([a.id, b.id]);
    expect(pruneSelected(selected, [a, b])).toBe(selected);
    expect([...pruneSelected(selected, [a])]).toEqual([a.id]);
  });
});

describe("bulkPlan", () => {
  it("marks paid only planned rows that aren't a card's instalment; deletes them all", () => {
    const planned = tx("2026-10-10");
    const paid = tx("2026-10-01", { status: "completed" });
    const instalment = tx("2026-10-05");
    const plan = bulkPlan([planned, paid, instalment], book([instalment]), today);
    expect(plan.completable).toEqual([planned]);
    expect(plan.removable).toEqual([planned, paid, instalment]);
    expect(plan.skipped).toBe(2);
  });

  it("writes a transfer once, whichever legs were chosen", () => {
    const out = tx("2026-10-10", { transferGroupId: "g" });
    const back = tx("2026-10-10", { transferGroupId: "g", direction: "income" });
    const plan = bulkPlan([out, back], book(), today);
    expect(plan.completable).toEqual([out]);
    expect(plan.removable).toEqual([out]);
    expect(plan.skipped).toBe(0);
  });

  it("puts legacy first only when every row to mark paid is long overdue", () => {
    const old = tx("2026-05-01");
    const older = tx("2025-12-01");
    const recent = tx("2026-10-01");
    expect(bulkPlan([old, older], book(), today).legacyFirst).toBe(true);
    expect(bulkPlan([old, recent], book(), today).legacyFirst).toBe(false);
    // a paid row doesn't count either way
    expect(bulkPlan([old, tx("2026-10-01", { status: "completed" })], book(), today).legacyFirst).toBe(true);
    expect(bulkPlan([], book(), today).legacyFirst).toBe(false);
  });
});

describe("runInTurn", () => {
  it("writes one after another and reports progress", async () => {
    const order: number[] = [];
    const progress: string[] = [];
    let running = 0;
    const result = await runInTurn(
      [1, 2, 3],
      async (n) => {
        running += 1;
        expect(running).toBe(1);
        await Promise.resolve();
        order.push(n);
        running -= 1;
      },
      (done, total) => progress.push(`${done}/${total}`)
    );
    expect(order).toEqual([1, 2, 3]);
    expect(result).toEqual({ done: [1, 2, 3] });
    expect(progress).toEqual(["0/3", "1/3", "2/3", "3/3"]);
  });

  it("stops at the first write that fails, and leaves the rest untried", async () => {
    const tried: number[] = [];
    const boom = new Error("offline");
    const result = await runInTurn([1, 2, 3, 4], async (n) => {
      tried.push(n);
      if (n === 2) throw boom;
    });
    expect(tried).toEqual([1, 2]);
    expect(result.done).toEqual([1]);
    expect(result.failed).toEqual({ item: 2, error: boom });
  });
});
