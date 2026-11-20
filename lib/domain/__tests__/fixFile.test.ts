import { describe, expect, it } from "vitest";
import { Account, Transaction } from "@/lib/data/types";
import { FixFile, FixState, evaluateStep, parseFixFile, planFixes } from "../fixFile";

const account = (id: string, kind: Account["kind"] = "fiat"): Account => ({
  id,
  name: id,
  currency: "TRY",
  kind,
  openingBalance: 0,
  archived: false,
  paymentAccountId: null,
  paymentDay: null,
  createdAt: "2026-01-01T00:00:00Z",
});

const tx = (over: Partial<Transaction> & Pick<Transaction, "id" | "accountId">): Transaction => ({
  direction: "expense",
  categoryId: null,
  amount: 100,
  status: "completed",
  dueDate: "2026-11-16",
  completedAt: null,
  description: "",
  fxSnapshot: null,
  transferGroupId: null,
  transferMarketRate: null,
  recurringTemplateId: null,
  loanId: null,
  victvsPayoutId: null,
  purchaseId: null,
  legacy: false,
  createdAt: "2026-11-01T00:00:00Z",
  ...over,
});

const state = (over: Partial<FixState> = {}): FixState => ({
  accounts: [account("bank"), account("other"), account("card", "credit_card")],
  transactions: [],
  purchases: [],
  loans: [],
  dismissed: new Set(),
  ...over,
});

const file = (steps: FixFile["steps"]): FixFile => ({ app: "renovator", kind: "fixes", version: 1, title: "t", steps });

describe("parseFixFile", () => {
  it("reads a fix file and refuses anything else, saying which step is wrong", () => {
    expect(parseFixFile({ app: "renovator", version: 1, accounts: [] })).toEqual({ error: "not a fix file" });
    expect(parseFixFile({ app: "renovator", kind: "fixes", version: 2, steps: [] })).toEqual({ error: "version 2" });
    expect(parseFixFile({ app: "renovator", kind: "fixes", version: 1, steps: [] })).toEqual({ error: "no steps" });
    expect(parseFixFile({ app: "renovator", kind: "fixes", version: 1, steps: [{ op: "dismissIssue", issueId: "x" }, { op: "explode" }] })).toEqual({
      error: "step 2: op",
    });
    expect(
      parseFixFile({ app: "renovator", kind: "fixes", version: 1, steps: [{ op: "createTransfer", from: "a", to: "b", fromAmount: -5, date: "2026-11-16", description: "" }] })
    ).toEqual({ error: "step 1: amount" });
    const ok = parseFixFile({ app: "renovator", kind: "fixes", version: 1, title: "Nov", steps: [{ op: "deleteTransaction", id: "t1" }] });
    expect("file" in ok && ok.file.steps).toHaveLength(1);
  });
});

describe("evaluateStep", () => {
  it("an edit is ready while the row is as expected, done once it reads as the edit, and a mismatch otherwise", () => {
    const step = { op: "editTransaction", id: "t1", expect: { accountId: "other", amount: 25299.04 }, set: { accountId: "bank" } } as const;
    expect(evaluateStep(step, state({ transactions: [tx({ id: "t1", accountId: "other", amount: 25299.04 })] }))).toEqual({ status: "ready" });
    expect(evaluateStep(step, state({ transactions: [tx({ id: "t1", accountId: "bank", amount: 25299.04 })] }))).toEqual({ status: "done" });
    expect(evaluateStep(step, state({ transactions: [tx({ id: "t1", accountId: "other", amount: 25000 })] }))).toEqual({
      status: "mismatch",
      problems: [{ kind: "field", id: "t1", field: "amount", expected: 25299.04, actual: 25000 }],
    });
    expect(evaluateStep(step, state())).toEqual({ status: "mismatch", problems: [{ kind: "missingRow", id: "t1" }] });
  });

  it("compares amounts to the kuruş, not as floats", () => {
    const step = { op: "deleteTransaction", id: "t1", expect: { amount: 0.3 } } as const;
    expect(evaluateStep(step, state({ transactions: [tx({ id: "t1", accountId: "bank", amount: 0.1 + 0.2 })] }))).toEqual({ status: "ready" });
  });

  it("a delete is done once the row is gone", () => {
    expect(evaluateStep({ op: "deleteTransaction", id: "gone" }, state())).toEqual({ status: "done" });
  });

  it("a transfer is done when both legs are on the ledger, and history only once they're marked so", () => {
    const step = { op: "createTransfer", from: "bank", to: "card", fromAmount: 8974.79, date: "2026-08-06", description: "statement", legacy: true } as const;
    const legs = (legacy: boolean) => [
      tx({ id: "o", accountId: "bank", amount: 8974.79, dueDate: "2026-08-06", description: "statement", transferGroupId: "g", legacy }),
      tx({ id: "i", accountId: "card", direction: "income", amount: 8974.79, dueDate: "2026-08-06", description: "statement", transferGroupId: "g", legacy }),
    ];
    expect(evaluateStep(step, state())).toEqual({ status: "ready" });
    expect(evaluateStep(step, state({ transactions: legs(false) }))).toEqual({ status: "ready" });
    expect(evaluateStep(step, state({ transactions: legs(true) }))).toEqual({ status: "done" });
    expect(evaluateStep({ ...step, to: "nowhere" }, state())).toEqual({ status: "mismatch", problems: [{ kind: "missingAccount", id: "nowhere" }] });
  });

  it("a debt through a card needs that purchase to exist", () => {
    const step = { op: "createDebt", name: "25k Coverup", principal: 25000, date: "2026-10-29", payAccountId: "bank", purchaseId: "p1" } as const;
    expect(evaluateStep(step, state())).toEqual({ status: "mismatch", problems: [{ kind: "missingPurchase", id: "p1" }] });
  });

  it("a dismissal is done once it's dismissed here", () => {
    expect(evaluateStep({ op: "dismissIssue", issueId: "x" }, state({ dismissed: new Set(["x"]) }))).toEqual({ status: "done" });
  });
});

describe("planFixes", () => {
  it("counts what would change and blocks the whole file on one mismatch", () => {
    const plan = planFixes(
      file([
        { op: "deleteTransaction", id: "gone" },
        { op: "dismissIssue", issueId: "x" },
        { op: "editTransaction", id: "missing", set: { amount: 1 } },
      ]),
      state()
    );
    expect(plan.states.map((s) => s.status)).toEqual(["done", "ready", "mismatch"]);
    expect(plan).toMatchObject({ ready: 1, blocked: true });
  });
});
