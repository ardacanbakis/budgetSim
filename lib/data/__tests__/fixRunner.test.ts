import { describe, expect, it } from "vitest";
import { FixFile } from "@/lib/domain/fixFile";
import { FxSnapshot } from "@/lib/domain/fx";
import { withActivityLog } from "../activityLog";
import { DemoRepo } from "../demoRepo";
import { applyFixFile, FixContext, FixMismatchError } from "../fixRunner";
import { Repo } from "../repo";

const fx: FxSnapshot = { at: "2026-11-20T09:00:00.000Z", usdPer: { USD: 1, TRY: 0.02, EUR: 1.12, BTC: 75000, XAU_G: 130 } };

async function fresh(): Promise<Repo> {
  const repo = withActivityLog(new DemoRepo());
  await repo.importAll({
    app: "renovator",
    version: 1,
    exportedAt: "2026-11-20T09:00:00.000Z",
    accounts: [],
    categories: [],
    transactions: [],
    templates: [],
    victvsSessions: [],
    victvsPayouts: [],
    loans: [],
    purchases: [],
    budgets: [],
    goals: [],
    snapshots: [],
  });
  return repo;
}

function context(): FixContext & { dismissedIds: Set<string> } {
  const dismissedIds = new Set<string>();
  return { fxSnapshot: fx, dismissedIds, dismissed: () => dismissedIds, dismiss: (id) => dismissedIds.add(id) };
}

/** A book like the one the first fix file was written for: a card paid from the wrong account, a statement paid in part. */
async function book(repo: Repo) {
  const bank = await repo.createAccount({ name: "EnPara TRY", currency: "TRY", kind: "fiat", openingBalance: 100000 });
  const pension = await repo.createAccount({ name: "Semoş İŞ", currency: "TRY", kind: "fiat", openingBalance: 0 });
  const card = await repo.createAccount({ name: "CC Akbank", currency: "TRY", kind: "credit_card", openingBalance: 0, paymentAccountId: bank.id, paymentDay: 16 });
  const closed = await repo.createAccount({ name: "Tazminat", currency: "TRY", kind: "fiat", openingBalance: 0 });
  await repo.updateAccount(closed.id, { archived: true });
  await repo.createTransfer({ fromAccountId: pension.id, toAccountId: card.id, fromAmount: 25299.04, toAmount: 25299.04, date: "2026-01-16", description: "statement", marketRate: null, fxSnapshot: fx });
  await repo.createTransfer({ fromAccountId: bank.id, toAccountId: card.id, fromAmount: 41511, toAmount: 41511, date: "2099-01-16", description: "statement", marketRate: null, fxSnapshot: null });
  await repo.createTransaction({ accountId: bank.id, direction: "expense", categoryId: null, amount: 10132.66, status: "completed", dueDate: "2026-08-18", description: "final payment", fxSnapshot: fx });
  await repo.createTransaction({ accountId: card.id, direction: "expense", categoryId: null, amount: 6866.74, status: "planned", dueDate: "2026-01-10", description: "Damatlık (3/3)", fxSnapshot: null });
  const coverup = await repo.createPurchase(
    { name: "25k Coverup", accountId: card.id, amount: 27443.34, purchaseDate: "2026-10-29", installmentCount: 3, firstDue: "2099-11-16", details: "", reflected: true, categoryId: null },
    fx
  );
  const txs = await repo.listTransactions();
  const find = (accountId: string, amount: number) => txs.find((t) => t.accountId === accountId && t.amount === amount)!;
  return {
    bank,
    pension,
    card,
    closed,
    coverup,
    paidFromPension: find(pension.id, 25299.04),
    plannedPayment: find(bank.id, 41511),
    finalPayment: find(bank.id, 10132.66),
    leftover: find(card.id, 6866.74),
  };
}

function fixes(b: Awaited<ReturnType<typeof book>>): FixFile {
  return {
    app: "renovator",
    kind: "fixes",
    version: 1,
    title: "test",
    steps: [
      { op: "editTransaction", id: b.paidFromPension.id, expect: { accountId: b.pension.id, amount: 25299.04, status: "completed" }, set: { accountId: b.bank.id } },
      { op: "deleteTransaction", id: b.plannedPayment.id, expect: { amount: 41511, status: "planned" } },
      { op: "createTransfer", from: b.bank.id, to: b.card.id, fromAmount: 34726.17, date: "2026-01-16", description: "statement (partial)" },
      { op: "createPurchase", accountId: b.card.id, name: "Nov statement taksit", amount: 11064.27, installments: 3, firstDue: "2099-12-16", purchaseDate: "2026-01-16" },
      { op: "createTransfer", from: b.bank.id, to: b.card.id, fromAmount: 8974.79, date: "2026-08-06", description: "old statement", legacy: true },
      { op: "createTransaction", accountId: b.closed.id, direction: "expense", amount: 31963.03, date: "2026-08-07", description: "spent" },
      { op: "deleteTransaction", id: b.finalPayment.id, expect: { amount: 10132.66 } },
      { op: "createTransfer", from: b.bank.id, to: b.card.id, fromAmount: 10132.66, date: "2026-08-18", description: "final payment" },
      { op: "createDebt", name: "25k Coverup", principal: 25000, date: "2026-10-29", payAccountId: b.bank.id, purchaseId: b.coverup.id },
      { op: "completeTransactions", ids: [b.leftover.id] },
      { op: "dismissIssue", issueId: "debtWithoutDate:goku" },
    ],
  };
}

describe("applying a fix file", () => {
  it("makes every change through the repo, and a second run changes nothing", async () => {
    const repo = await fresh();
    const b = await book(repo);
    const ctx = context();
    expect(await applyFixFile(repo, fixes(b), ctx)).toEqual({ applied: 11, skipped: 0 });

    const txs = await repo.listTransactions();
    const byId = new Map(txs.map((t) => [t.id, t] as const));
    expect(byId.get(b.paidFromPension.id)?.accountId).toBe(b.bank.id);
    expect(byId.has(b.plannedPayment.id)).toBe(false);
    // a transfer goes with both its legs
    expect(txs.filter((t) => t.amount === 41511)).toHaveLength(0);
    expect(txs.filter((t) => t.description === "statement (partial)").map((t) => t.status)).toEqual(["completed", "completed"]);
    expect(txs.filter((t) => t.description === "old statement").every((t) => t.legacy)).toBe(true);
    expect(txs.find((t) => t.accountId === b.closed.id)).toMatchObject({ amount: 31963.03, status: "completed", direction: "expense" });
    expect(txs.filter((t) => t.description === "final payment").map((t) => t.transferGroupId != null)).toEqual([true, true]);
    expect(byId.get(b.leftover.id)?.status).toBe("completed");
    const purchase = (await repo.listPurchases()).find((p) => p.name === "Nov statement taksit")!;
    expect(txs.filter((t) => t.purchaseId === purchase.id).map((t) => t.amount)).toEqual([3688.09, 3688.09, 3688.09]);
    expect(await repo.listLoans()).toEqual([expect.objectContaining({ name: "25k Coverup", principal: 25000, purchaseId: b.coverup.id })]);
    expect(ctx.dismissedIds.has("debtWithoutDate:goku")).toBe(true);
    // each change is in the history, as when it's made by hand
    expect((await repo.listActivity()).length).toBeGreaterThan(10);

    const count = txs.length;
    expect(await applyFixFile(repo, fixes(b), ctx)).toEqual({ applied: 0, skipped: 11 });
    expect(await repo.listTransactions()).toHaveLength(count);
  });

  it("changes nothing when one step no longer matches the records", async () => {
    const repo = await fresh();
    const b = await book(repo);
    await repo.updateTransaction(b.plannedPayment.id, { amount: 40000 });
    const before = await repo.listTransactions();
    await expect(applyFixFile(repo, fixes(b), context())).rejects.toBeInstanceOf(FixMismatchError);
    expect(await repo.listTransactions()).toEqual(before);
  });
});
