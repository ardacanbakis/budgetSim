import { describe, expect, it } from "vitest";
import { computeMissingOccurrences } from "../materialize";
import { RecurringTemplate } from "@/lib/data/types";

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
    const existing = [
      {
        id: "t1",
        accountId: "usd",
        direction: "income" as const,
        categoryId: null,
        amount: 2000,
        status: "completed" as const,
        dueDate: "2026-03-05",
        completedAt: "2026-03-05",
        description: "Salary",
        fxSnapshot: null,
        transferGroupId: null,
        transferMarketRate: null,
        recurringTemplateId: "tpl1",
        loanId: null,
        victvsPayoutId: null,
        purchaseId: null,
        legacy: false,
        createdAt: "2026-03-05",
      },
    ];
    const missing = computeMissingOccurrences([template()], existing, 12, "2026-07-10");
    expect(missing.map((m) => m.dueDate)).not.toContain("2026-03-05");
    expect(missing[0].dueDate).toBe("2026-04-05");
  });
});
