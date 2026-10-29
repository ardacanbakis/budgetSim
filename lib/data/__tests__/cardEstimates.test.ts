import { describe, expect, it } from "vitest";
import { withActivityLog } from "../activityLog";
import { DemoRepo } from "../demoRepo";
import { Repo } from "../repo";

async function fresh(): Promise<Repo> {
  const repo = withActivityLog(new DemoRepo());
  await repo.importAll({
    app: "renovator",
    version: 1,
    exportedAt: "2026-10-29T09:00:00.000Z",
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

describe("expected card statements", () => {
  it("are noted, kept as history when noted again, deleted, and recorded on the card's history", async () => {
    const repo = await fresh();
    const card = await repo.createAccount({ name: "CC Akbank", currency: "TRY", kind: "credit_card", openingBalance: 0 });
    await repo.addCardEstimate({ accountId: card.id, month: "2026-11", amount: 30000, notedOn: "2026-10-20" });
    const second = await repo.addCardEstimate({ accountId: card.id, month: "2026-11", amount: 31568.73, notedOn: "2026-10-29" });
    expect((await repo.listCardEstimates()).map((e) => e.amount)).toEqual([30000, 31568.73]);

    const history = await repo.listActivity();
    expect(history[0]).toMatchObject({ entityType: "account", accountId: card.id, action: "edited", summary: "CC Akbank · 2026-11", changes: { expected: [30000, 31568.73] } });
    expect(history[1]).toMatchObject({ action: "created", changes: { expected: [null, 30000] } });

    await repo.deleteCardEstimate(second.id);
    expect((await repo.listCardEstimates()).map((e) => e.amount)).toEqual([30000]);
    expect((await repo.listActivity())[0]).toMatchObject({ action: "deleted", changes: { expected: [31568.73, null] } });
  });

  it("travel with a backup, and go with their card", async () => {
    const repo = await fresh();
    const card = await repo.createAccount({ name: "CC EnPara", currency: "TRY", kind: "credit_card", openingBalance: 0 });
    await repo.addCardEstimate({ accountId: card.id, month: "2026-12", amount: 6815.35, notedOn: "2026-10-29" });
    const backup = await repo.exportAll();
    expect(backup.cardEstimates).toHaveLength(1);

    const restored = await fresh();
    await restored.importAll(backup);
    expect((await restored.listCardEstimates())[0]).toMatchObject({ month: "2026-12", amount: 6815.35 });

    await restored.deleteAccount(card.id);
    expect(await restored.listCardEstimates()).toEqual([]);
  });
});
