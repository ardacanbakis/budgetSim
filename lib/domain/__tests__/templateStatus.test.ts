import { describe, expect, it } from "vitest";
import { templateProgress } from "../templateStatus";
import { RecurringTemplate, Transaction } from "@/lib/data/types";

function template(overrides: Partial<RecurringTemplate> = {}): RecurringTemplate {
  return {
    id: "tpl1",
    name: "Akbank loan",
    accountId: "try",
    direction: "expense",
    categoryId: null,
    amount: 9046.8,
    frequency: "monthly",
    startDate: "2026-08-26",
    endDate: "2027-02-26",
    autoComplete: false,
    loanId: null,
    createdAt: "2026-08-01",
    ...overrides,
  };
}

function tx(dueDate: string, status: Transaction["status"], templateId = "tpl1"): Transaction {
  return {
    id: `${templateId}-${dueDate}`,
    accountId: "try",
    direction: "expense",
    categoryId: null,
    amount: 9046.8,
    status,
    dueDate,
    completedAt: status === "completed" ? dueDate : null,
    description: "",
    fxSnapshot: null,
    transferGroupId: null,
    transferMarketRate: null,
    recurringTemplateId: templateId,
    loanId: null,
    victvsPayoutId: null,
    purchaseId: null,
    legacy: false,
    createdAt: dueDate,
  };
}

describe("templateProgress", () => {
  it("is active while the schedule still has dates ahead", () => {
    const p = templateProgress(
      template(),
      [tx("2026-08-26", "completed"), tx("2026-09-26", "completed"), tx("2026-10-26", "planned")],
      "2026-10-05"
    );
    expect(p.status).toBe("active");
    expect(p.done).toBe(2);
    expect(p.total).toBe(7);
    expect(p.open).toBe(0);
    expect(p.next).toBe("2026-10-26");
    expect(p.last).toBe("2027-02-26");
  });

  it("is completed once the schedule has run out and everything is settled", () => {
    const tpl = template({ startDate: "2024-10-05", endDate: "2024-12-05", direction: "income" });
    const p = templateProgress(
      tpl,
      [tx("2024-10-05", "completed"), tx("2024-11-05", "completed"), tx("2024-12-05", "completed")],
      "2026-10-05"
    );
    expect(p.status).toBe("completed");
    expect(p.done).toBe(3);
    expect(p.total).toBe(3);
    expect(p.next).toBeNull();
  });

  it("waits for confirmation when the schedule ended with items still planned", () => {
    const tpl = template({ startDate: "2025-01-05", endDate: "2026-02-05" });
    const p = templateProgress(tpl, [tx("2026-01-05", "completed"), tx("2026-02-05", "planned")], "2026-10-05");
    expect(p.status).toBe("toConfirm");
    expect(p.open).toBe(1);
  });

  it("has not started when the first date is ahead", () => {
    const tpl = template({ startDate: "2026-11-03", endDate: "2027-01-03" });
    const p = templateProgress(tpl, [tx("2026-11-03", "planned")], "2026-10-05");
    expect(p.status).toBe("notStarted");
    expect(p.next).toBe("2026-11-03");
    expect(p.total).toBe(3);
  });

  it("never completes without an end date", () => {
    const tpl = template({ startDate: "2020-01-01", endDate: null });
    const p = templateProgress(tpl, [], "2026-10-05");
    expect(p.status).toBe("active");
    expect(p.total).toBeNull();
    expect(p.next).toBe("2026-11-01");
  });

  it("stays active while a planned item is still ahead, even after the end date moved earlier", () => {
    // end date shortened to September, but the October item was already materialized
    const tpl = template({ endDate: "2026-09-26" });
    const p = templateProgress(
      tpl,
      [tx("2026-08-26", "completed"), tx("2026-09-26", "completed"), tx("2026-10-26", "planned")],
      "2026-10-05"
    );
    expect(p.status).toBe("active");
    expect(p.next).toBe("2026-10-26");
  });

  it("treats an item due today as open and as next", () => {
    const tpl = template({ startDate: "2026-08-05", endDate: "2026-10-05" });
    const p = templateProgress(
      tpl,
      [tx("2026-08-05", "completed"), tx("2026-09-05", "completed"), tx("2026-10-05", "planned")],
      "2026-10-05"
    );
    expect(p.status).toBe("toConfirm");
    expect(p.open).toBe(1);
    expect(p.next).toBe("2026-10-05");
  });

  it("only counts transactions that belong to the template", () => {
    const p = templateProgress(template(), [tx("2026-08-26", "completed", "other")], "2026-10-05");
    expect(p.done).toBe(0);
  });

  it("handles weekly and yearly schedules", () => {
    const weekly = templateProgress(
      template({ frequency: "weekly", startDate: "2026-09-01", endDate: "2026-09-29" }),
      [],
      "2026-10-05"
    );
    expect(weekly.total).toBe(5);
    expect(weekly.status).toBe("completed");

    const yearly = templateProgress(
      template({ frequency: "yearly", startDate: "2025-03-01", endDate: null }),
      [],
      "2026-10-05"
    );
    expect(yearly.next).toBe("2027-03-01");
  });
});
