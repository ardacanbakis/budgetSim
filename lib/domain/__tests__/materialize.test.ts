import { describe, expect, it } from "vitest";
import { computeMissingOccurrences, findAutoCompletable } from "../materialize";
import { RecurringTemplate, Transaction } from "@/lib/data/types";

function template(overrides: Partial<RecurringTemplate> = {}): RecurringTemplate {
  return {
    id: "tpl1",
    name: "Salary",
    accountId: "usd",
    direction: "income",
    categoryId: null,
    amount: 2000,
    frequency: "monthly",
    startDate: "2026-03-05",
    endDate: "2026-12-05",
    autoComplete: false,
    loanId: null,
    createdAt: "2026-03-01",
    ...overrides,
  };
}

/** A row of template `tpl1` (unless overridden) on `dueDate`. */
function tx(dueDate: string, overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: `tx-${dueDate}`,
    accountId: "usd",
    direction: "income",
    categoryId: null,
    amount: 2000,
    status: "planned",
    dueDate,
    completedAt: null,
    description: "Salary",
    fxSnapshot: null,
    transferGroupId: null,
    transferMarketRate: null,
    recurringTemplateId: "tpl1",
    loanId: null,
    victvsPayoutId: null,
    purchaseId: null,
    legacy: false,
    createdAt: "2026-03-01T09:00:00.000Z",
    ...overrides,
  };
}

describe("computeMissingOccurrences", () => {
  it("backfills occurrences from the start date, not just from today", () => {
    // template runs Mar 5 → Dec 5; viewed on Jul 10 it must still produce the
    // already-past Mar/Apr/May/Jun/Jul items, not only Aug → Dec.
    const missing = computeMissingOccurrences([template()], [], 12, "2026-07-10");
    expect(missing.map((m) => m.dueDate)).toEqual([
      "2026-03-05",
      "2026-04-05",
      "2026-05-05",
      "2026-06-05",
      "2026-07-05",
      "2026-08-05",
      "2026-09-05",
      "2026-10-05",
      "2026-11-05",
      "2026-12-05",
    ]);
  });

  it("stops at the template end date", () => {
    const missing = computeMissingOccurrences([template({ endDate: "2026-06-05" })], [], 12, "2026-07-10");
    expect(missing.map((m) => m.dueDate)).toEqual(["2026-03-05", "2026-04-05", "2026-05-05", "2026-06-05"]);
  });

  it("skips occurrences that already have a transaction", () => {
    const existing = [tx("2026-03-05", { status: "completed", completedAt: "2026-03-05" })];
    const missing = computeMissingOccurrences([template()], existing, 12, "2026-07-10");
    expect(missing.map((m) => m.dueDate)).not.toContain("2026-03-05");
    expect(missing[0].dueDate).toBe("2026-04-05");
  });
});

describe("findAutoCompletable", () => {
  const auto = template({ autoComplete: true, createdAt: "2026-03-01T09:00:00.000Z" });

  it("settles planned items of auto-complete templates once they're due", () => {
    const rows = [tx("2026-03-05"), tx("2026-04-05"), tx("2026-05-05")];
    expect(findAutoCompletable([auto], rows, "2026-04-05").map((t) => t.dueDate)).toEqual(["2026-03-05", "2026-04-05"]);
  });

  it("leaves alone templates without auto-complete, completed items and unlinked rows", () => {
    const rows = [
      tx("2026-03-05", { status: "completed" }),
      tx("2026-03-06", { recurringTemplateId: null }),
      tx("2026-03-07", { recurringTemplateId: "manual" }),
    ];
    expect(findAutoCompletable([auto, template({ id: "manual" })], rows, "2026-04-05")).toEqual([]);
  });

  it("leaves items dated before the template was created waiting for a tap", () => {
    // a running loan entered on 10 Jul with its first installment in March:
    // the earlier installments are history to confirm, not payments to make now
    const late = template({ autoComplete: true, createdAt: "2026-07-10T09:00:00.000Z" });
    const rows = ["2026-03-05", "2026-06-05", "2026-07-05", "2026-07-10", "2026-08-05"].map((d) => tx(d));
    expect(findAutoCompletable([late], rows, "2026-08-05").map((t) => t.dueDate)).toEqual(["2026-07-10", "2026-08-05"]);
  });
});
