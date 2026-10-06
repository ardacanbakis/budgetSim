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

const dates = (missing: { dueDate: string }[]) => missing.map((m) => m.dueDate);

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

describe("computeMissingOccurrences: filling forward", () => {
  it("only fills after the template's latest row, so a deleted occurrence stays deleted", () => {
    // May was deleted on purpose ("skip this month")
    const rows = ["2026-03-05", "2026-04-05", "2026-06-05", "2026-07-05"].map((d) => tx(d));
    const missing = computeMissingOccurrences([template()], rows, 12, "2026-07-10");
    expect(dates(missing)).toEqual(["2026-08-05", "2026-09-05", "2026-10-05", "2026-11-05", "2026-12-05"]);
  });

  it("doesn't bring back an occurrence that was moved a few days", () => {
    const rows = [tx("2026-03-05"), tx("2026-04-05"), tx("2026-05-08")];
    const missing = computeMissingOccurrences([template()], rows, 12, "2026-04-20");
    expect(dates(missing)).not.toContain("2026-05-05");
    expect(dates(missing)[0]).toBe("2026-06-05");
  });

  it("doesn't add a second row in a month that already has one when the day changes", () => {
    // paid on the 15th, then on the 18th the template moves to the 20th
    const rows = [tx("2026-09-15", { status: "completed" }), tx("2026-10-15", { status: "completed" })];
    const missing = computeMissingOccurrences([template({ startDate: "2026-09-20", endDate: null })], rows, 2, "2026-10-18");
    expect(dates(missing)).toEqual(["2026-11-20"]);
  });

  it("treats a row within three days as the same week for a weekly template", () => {
    // Monday until now, Thursdays from here on
    const rows = [tx("2026-10-05")];
    const weekly = template({ frequency: "weekly", startDate: "2026-10-01", endDate: "2026-10-31" });
    const missing = computeMissingOccurrences([weekly], rows, 1, "2026-10-06");
    expect(dates(missing)).toEqual(["2026-10-15", "2026-10-22", "2026-10-29"]);
  });

  it("treats the calendar year as the period for a yearly template", () => {
    const rows = [tx("2026-03-01", { status: "completed" })];
    const yearly = template({ frequency: "yearly", startDate: "2026-06-01", endDate: null });
    const missing = computeMissingOccurrences([yearly], rows, 24, "2026-04-01");
    expect(dates(missing)).toEqual(["2027-06-01"]);
  });

  it("ignores other templates' rows", () => {
    const rows = [tx("2026-06-05", { recurringTemplateId: "other" })];
    const missing = computeMissingOccurrences([template({ endDate: "2026-07-05" })], rows, 12, "2026-07-10");
    expect(dates(missing)).toEqual(["2026-03-05", "2026-04-05", "2026-05-05", "2026-06-05", "2026-07-05"]);
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
