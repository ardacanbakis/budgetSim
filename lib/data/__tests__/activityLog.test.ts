import { describe, expect, it } from "vitest";
import { FxSnapshot } from "@/lib/domain/fx";
import { FALLBACK_USD_PER } from "@/lib/rates/fallback";
import { withActivityLog } from "../activityLog";
import { DemoRepo } from "../demoRepo";
import { Repo } from "../repo";

const snapshot: FxSnapshot = { usdPer: FALLBACK_USD_PER, at: "2026-10-29T09:00:00.000Z" };

async function fresh(): Promise<Repo> {
  const repo = withActivityLog(new DemoRepo());
  await repo.importAll({
    app: "renovator",
    version: 1,
    exportedAt: snapshot.at,
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

describe("the change history", () => {
  it("records what an account edit changed, holdings included, and passes reads through", async () => {
    const repo = await fresh();
    const gold = await repo.createAccount({
      name: "T&T Wedding gold",
      currency: "XAU_G",
      kind: "gold",
      openingBalance: 0,
      holdings: [{ type: "has", qty: 13 }],
    });
    await repo.updateAccount(gold.id, { holdings: [{ type: "has", qty: 15 }] });
    // an edit that changes nothing leaves nothing behind
    await repo.updateAccount(gold.id, { name: "T&T Wedding gold" });

    const log = await repo.listActivity();
    expect(log.map((e) => e.action)).toEqual(["edited", "created", "restored"]);
    const edit = log[0];
    expect(edit.accountId).toBe(gold.id);
    expect(edit.summary).toBe("T&T Wedding gold");
    expect(edit.changes).toEqual({ holdings: [[{ type: "has", qty: 13 }], [{ type: "has", qty: 15 }]] });
    expect(repo.mode).toBe("demo");
  });

  it("records a deleted transaction with what it was, and both legs of a completed transfer", async () => {
    const repo = await fresh();
    const bank = await repo.createAccount({ name: "EnPara TRY", currency: "TRY", kind: "fiat", openingBalance: 0 });
    const card = await repo.createAccount({ name: "CC Akbank", currency: "TRY", kind: "credit_card", openingBalance: 0 });
    const charge = await repo.createTransaction({
      accountId: card.id,
      direction: "expense",
      categoryId: null,
      amount: 11062.43,
      status: "completed",
      dueDate: "2026-10-15",
      description: "Semoş AkKız 100k neziroğlu",
      fxSnapshot: snapshot,
    });
    await repo.deleteTransaction(charge.id);
    await repo.createTransfer({
      fromAccountId: bank.id,
      toAccountId: card.id,
      fromAmount: 45534.22,
      toAmount: 45534.22,
      date: "2099-11-16",
      description: "CC Akbank statement",
      marketRate: null,
      fxSnapshot: snapshot,
    });
    const out = (await repo.listTransactions()).find((t) => t.accountId === bank.id)!;
    await repo.completeTransaction(out.id, snapshot);

    const log = await repo.listActivity();
    const deleted = log.find((e) => e.action === "deleted")!;
    expect(deleted.accountId).toBe(card.id);
    expect(deleted.summary).toBe("Semoş AkKız 100k neziroğlu");
    expect(deleted.changes.amount).toEqual([11062.43, null]);
    const completed = log.filter((e) => e.action === "completed");
    expect(completed.map((e) => e.accountId).sort()).toEqual([bank.id, card.id].sort());
    expect(completed[0].changes.status).toEqual(["planned", "completed"]);
  });

  it("records a deleted recurring item and what happened to its planned items", async () => {
    const repo = await fresh();
    const bank = await repo.createAccount({ name: "EnPara TRY", currency: "TRY", kind: "fiat", openingBalance: 0 });
    const tpl = await repo.createTemplate({
      name: "Tansu QNB 25k",
      accountId: bank.id,
      direction: "expense",
      categoryId: null,
      amount: 8333.33,
      frequency: "monthly",
      startDate: "2099-01-03",
      endDate: "2099-03-03",
      autoComplete: false,
    });
    await repo.materializeTemplates(1200);
    await repo.deleteTemplate(tpl.id, false);
    const entry = (await repo.listActivity()).find((e) => e.entityType === "template" && e.action === "deleted")!;
    expect(entry.summary).toBe("Tansu QNB 25k");
    expect(entry.changes.plannedRemoved).toEqual([3, 3]);
  });

  it("never turns a save into an error when the history can't be written", async () => {
    const inner = new DemoRepo();
    inner.appendActivity = async () => {
      throw new Error("no activity_log table");
    };
    const repo = withActivityLog(inner);
    const account = await repo.createAccount({ name: "Cash", currency: "TRY", kind: "fiat", openingBalance: 10 });
    expect(account.name).toBe("Cash");
    inner.listActivity = async () => {
      throw new Error("no activity_log table");
    };
    expect(await repo.listActivity()).toEqual([]);
  });

  it("goes into the backup and comes back with a restore", async () => {
    const repo = await fresh();
    await repo.createAccount({ name: "Cash", currency: "TRY", kind: "fiat", openingBalance: 10 });
    const backup = await repo.exportAll();
    expect(backup.activity?.length).toBeGreaterThan(0);
    const other = withActivityLog(new DemoRepo());
    await other.importAll(backup);
    const log = await other.listActivity();
    // the restored history, plus the restore itself on top
    expect(log[0].action).toBe("restored");
    expect(log.some((e) => e.action === "created" && e.summary === "Cash")).toBe(true);
  });
});
