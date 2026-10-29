import { describe, expect, it } from "vitest";
import { ActivityEntry, Transaction } from "@/lib/data/types";
import { fieldChanges, holdingsDiff, lastChange, mergeHistory, moneyRows } from "../activity";

let seq = 0;
function tx(dueDate: string, amount: number, overrides: Partial<Transaction> = {}): Transaction {
  seq += 1;
  return {
    id: `t${seq}`,
    accountId: "bank",
    direction: "expense",
    categoryId: null,
    amount,
    status: "completed",
    dueDate,
    completedAt: `${dueDate}T10:00:00.000Z`,
    description: `row ${seq}`,
    fxSnapshot: null,
    transferGroupId: null,
    transferMarketRate: null,
    recurringTemplateId: null,
    loanId: null,
    victvsPayoutId: null,
    purchaseId: null,
    legacy: false,
    createdAt: `${dueDate}T10:00:00.000Z`,
    ...overrides,
  };
}

describe("activity helpers", () => {
  it("lists only the fields that changed", () => {
    expect(fieldChanges({ name: "A", amount: 1 }, { name: "A", amount: 2 }, ["name", "amount"])).toEqual({ amount: [1, 2] });
    expect(fieldChanges(null, { name: "A" }, ["name"])).toEqual({ name: [null, "A"] });
  });

  it("reads a holdings change per coin type", () => {
    expect(
      holdingsDiff(
        [{ type: "has", qty: 13 }, { type: "ceyrek", qty: 12 }],
        [{ type: "has", qty: 15 }, { type: "ceyrek", qty: 12 }, { type: "tam", qty: 1 }]
      )
    ).toEqual([
      { type: "has", before: 13, after: 15 },
      { type: "tam", before: 0, after: 1 },
    ]);
  });

  it("works each row's balance back from today's, skipping legacy and planned rows", () => {
    const salary = tx("2026-10-05", 2090, { direction: "income" });
    const rent = tx("2026-10-10", 500);
    const old = tx("2026-09-01", 9999, { legacy: true });
    const planned = tx("2026-11-01", 100, { status: "planned" });
    const rows = moneyRows("bank", [salary, rent, old, planned], 11917.94);
    expect(rows.map((r) => [r.tx.id, r.delta, r.balanceAfter])).toEqual([
      [rent.id, -500, 11917.94],
      [salary.id, 2090, 12417.94],
      [old.id, 0, null],
    ]);
  });

  it("puts edits and money in one story, newest first, and knows the latest change", () => {
    const rent = tx("2026-10-10", 500);
    const edit: ActivityEntry = {
      id: "a1",
      at: "2026-10-28T12:00:00.000Z",
      entityType: "account",
      entityId: "bank",
      accountId: "bank",
      action: "edited",
      summary: "EnPara TRY",
      changes: { openingBalance: [0, 100] },
    };
    const money = moneyRows("bank", [rent], 1000);
    const story = mergeHistory(money, [edit]);
    expect(story.map((i) => i.kind)).toEqual(["change", "money"]);
    expect(lastChange(money, [edit])?.kind).toBe("change");
    expect(lastChange(money, [])?.kind).toBe("money");
  });
});
