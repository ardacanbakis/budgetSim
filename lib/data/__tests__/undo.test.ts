import { describe, expect, it } from "vitest";
import { ActivityEntry } from "@/lib/data/types";
import { computeBalances } from "@/lib/domain/balances";
import { FxSnapshot } from "@/lib/domain/fx";
import { planUndo, UndoStep } from "@/lib/domain/undo";
import { FALLBACK_USD_PER } from "@/lib/rates/fallback";
import { withActivityLog } from "../activityLog";
import { DemoRepo } from "../demoRepo";
import { Repo } from "../repo";

const fx: FxSnapshot = { usdPer: FALLBACK_USD_PER, at: "2026-11-02T09:00:00.000Z" };

async function fresh() {
  const repo = withActivityLog(new DemoRepo());
  await repo.importAll({
    app: "renovator",
    version: 1,
    exportedAt: fx.at,
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
  const enpara = await repo.createAccount({ name: "EnPara TRY", currency: "TRY", kind: "fiat", openingBalance: 20000 });
  const card = await repo.createAccount({
    name: "CC KuveytTurk",
    currency: "TRY",
    kind: "credit_card",
    openingBalance: 0,
    paymentAccountId: enpara.id,
    paymentDay: 18,
  });
  return { repo, enpara: enpara.id, card: card.id };
}

const balance = async (repo: Repo, id: string) => computeBalances(await repo.listAccounts(), await repo.listTransactions(), {} as never).get(id);

/** Undo the newest entry matching `pick`, as the button would. */
async function undoLatest(repo: Repo, pick: (e: ActivityEntry) => boolean) {
  const activity = await repo.listActivity();
  const entry = activity.find(pick)!;
  const plan = planUndo(entry, activity, { accounts: await repo.listAccounts(), transactions: await repo.listTransactions() });
  if (!plan.ok) throw new Error(plan.reason);
  for (const step of plan.steps as UndoStep[]) {
    if (step.kind === "deleteTransaction") await repo.deleteTransaction(step.id);
    else if (step.kind === "restore") await repo.restoreRows(step.set);
    else if (step.kind === "updateTransaction") await repo.updateTransaction(step.id, step.patch);
    else if (step.kind === "reopenTransaction") await repo.reopenTransaction(step.id);
    else if (step.kind === "completeTransaction") await repo.completeTransaction(step.id, fx);
    else if (step.kind === "setLegacy") await repo.setTransactionLegacy(step.id, step.legacy);
    else if (step.kind === "updateAccount") await repo.updateAccount(step.id, step.patch);
    else if (step.kind === "deleteAccount") await repo.deleteAccount(step.id);
  }
}

const planFor = async (repo: Repo, pick: (e: ActivityEntry) => boolean) => {
  const activity = await repo.listActivity();
  return planUndo(activity.find(pick)!, activity, { accounts: await repo.listAccounts(), transactions: await repo.listTransactions() });
};

describe("undo", () => {
  it("brings back a deleted card payment, both legs, and the balances with it", async () => {
    const { repo, enpara, card } = await fresh();
    await repo.createTransfer({
      fromAccountId: enpara,
      toAccountId: card,
      fromAmount: 10132.66,
      toAmount: 10132.66,
      date: "2026-08-18",
      description: "CC KuveytTurk statement",
      marketRate: null,
      fxSnapshot: fx,
    });
    const before = await repo.listTransactions();
    expect(await balance(repo, enpara)).toBeCloseTo(9867.34);

    await repo.deleteTransaction(before[0].id);
    expect(await balance(repo, enpara)).toBe(20000);

    await undoLatest(repo, (e) => e.action === "deleted");
    expect(await balance(repo, enpara)).toBeCloseTo(9867.34);
    const after = await repo.listTransactions();
    expect(after.map((t) => t.id).sort()).toEqual(before.map((t) => t.id).sort());
    expect(after.find((t) => t.accountId === card)?.transferGroupId).toBe(before[0].transferGroupId);
    // undone once: the button turns into "already undone"
    expect(await planFor(repo, (e) => e.action === "deleted")).toEqual({ ok: false, reason: "exists" });
  });

  it("removes something added by mistake, transfers included", async () => {
    const { repo, enpara, card } = await fresh();
    await repo.createTransaction({
      accountId: card,
      direction: "expense",
      categoryId: null,
      amount: 10132.66,
      status: "completed",
      dueDate: "2026-07-16",
      description: "fixing adjustment",
      fxSnapshot: fx,
    });
    await undoLatest(repo, (e) => e.action === "created" && e.entityType === "transaction");
    expect(await repo.listTransactions()).toEqual([]);

    await repo.createTransfer({
      fromAccountId: enpara,
      toAccountId: card,
      fromAmount: 500,
      toAmount: 500,
      date: "2026-10-18",
      description: "pay",
      marketRate: null,
      fxSnapshot: fx,
    });
    await undoLatest(repo, (e) => e.action === "created" && e.entityType === "transaction");
    expect(await repo.listTransactions()).toEqual([]);
  });

  it("puts an edit back, but not over a later edit", async () => {
    const { repo, enpara } = await fresh();
    const tx = await repo.createTransaction({
      accountId: enpara,
      direction: "expense",
      categoryId: null,
      amount: 100,
      status: "planned",
      dueDate: "2026-11-02",
      description: "rent",
      fxSnapshot: null,
    });
    await repo.updateTransaction(tx.id, { amount: 150 });
    await repo.updateTransaction(tx.id, { dueDate: "2026-11-05" });
    // the amount edit is older: the date edit came after, but didn't touch the amount
    await undoLatest(repo, (e) => e.action === "edited" && "amount" in e.changes);
    expect((await repo.listTransactions())[0]).toMatchObject({ amount: 100, dueDate: "2026-11-05" });

    await repo.updateTransaction(tx.id, { amount: 200 });
    expect(await planFor(repo, (e) => e.action === "edited" && e.changes.amount?.[1] === 150)).toEqual({ ok: false, reason: "changed" });
  });

  it("reopens what was marked done, and marks done what was reopened", async () => {
    const { repo, enpara } = await fresh();
    const tx = await repo.createTransaction({
      accountId: enpara,
      direction: "expense",
      categoryId: null,
      amount: 10000,
      status: "planned",
      dueDate: "2026-11-02",
      description: "Semoş QNB 30k",
      fxSnapshot: null,
    });
    await repo.completeTransaction(tx.id, fx, undefined, true);
    await undoLatest(repo, (e) => e.action === "completed");
    expect((await repo.listTransactions())[0]).toMatchObject({ status: "planned", legacy: false });
  });

  it("brings back a deleted account with its rows, expected statements and the cards it paid", async () => {
    const { repo, enpara, card } = await fresh();
    await repo.createTransfer({
      fromAccountId: enpara,
      toAccountId: card,
      fromAmount: 300,
      toAmount: 300,
      date: "2026-10-18",
      description: "pay",
      marketRate: null,
      fxSnapshot: fx,
    });
    await repo.addCardEstimate({ accountId: card, month: "2026-12", amount: 700, notedOn: "2026-11-01" });
    const other = await repo.createAccount({ name: "CC Other", currency: "TRY", kind: "credit_card", openingBalance: 0, paymentAccountId: enpara });

    await repo.deleteAccount(enpara);
    expect((await repo.listAccounts()).find((a) => a.id === other.id)?.paymentAccountId).toBeNull();

    await undoLatest(repo, (e) => e.action === "deleted" && e.entityType === "account");
    const accounts = await repo.listAccounts();
    expect(accounts.find((a) => a.id === enpara)).toMatchObject({ name: "EnPara TRY", openingBalance: 20000 });
    expect(accounts.find((a) => a.id === other.id)?.paymentAccountId).toBe(enpara);
    expect(await balance(repo, enpara)).toBe(19700);
    expect((await repo.listTransactions()).filter((t) => t.transferGroupId)).toHaveLength(2);

    // the card's own estimate went nowhere; deleting the card and undoing brings it back
    await repo.deleteAccount(card);
    await undoLatest(repo, (e) => e.action === "deleted" && e.entityId === card);
    expect((await repo.listCardEstimates()).map((e) => e.amount)).toEqual([700]);
  });

  it("undoes retiring and bringing back an account", async () => {
    const { repo, card } = await fresh();
    await repo.updateAccount(card, { archived: true });
    await undoLatest(repo, (e) => e.action === "archived");
    expect((await repo.listAccounts()).find((a) => a.id === card)?.archived).toBe(false);
  });

  it("says why a deletion from before undo existed can't be undone", async () => {
    const entry: ActivityEntry = {
      id: "x",
      at: "2026-11-02T18:30:10.659Z",
      entityType: "transaction",
      entityId: "gone",
      accountId: "a",
      action: "deleted",
      summary: "CC KuveytTurk statement",
      changes: { amount: [10132.66, null] },
    };
    expect(planUndo(entry, [entry], { accounts: [], transactions: [] })).toEqual({ ok: false, reason: "noSnapshot" });
  });
});
