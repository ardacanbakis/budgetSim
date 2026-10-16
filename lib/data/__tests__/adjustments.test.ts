import { describe, expect, it } from "vitest";
import { computeBalances } from "@/lib/domain/balances";
import { planAdjustment } from "@/lib/domain/adjustments";
import { FxSnapshot } from "@/lib/domain/fx";
import { FALLBACK_USD_PER } from "@/lib/rates/fallback";
import { DemoRepo } from "../demoRepo";

const snapshot: FxSnapshot = { usdPer: FALLBACK_USD_PER, at: "2026-10-16T09:00:00.000Z" };

describe("a balance adjustment", () => {
  it("brings the account to what the bank shows and stays labelled", async () => {
    const repo = new DemoRepo();
    const bank = await repo.createAccount({ name: "EnPara TRY", currency: "TRY", kind: "fiat", openingBalance: 12500 });
    const before = computeBalances(await repo.listAccounts(), await repo.listTransactions()).get(bank.id)!;
    const plan = planAdjustment(before, 12465.5, "TRY")!;

    await repo.createTransaction({
      accountId: bank.id,
      direction: plan.direction,
      categoryId: null,
      amount: plan.amount,
      status: "completed",
      dueDate: "2026-10-14",
      description: "EFT fee",
      fxSnapshot: snapshot,
      adjustment: true,
    });

    const txs = await repo.listTransactions();
    expect(computeBalances(await repo.listAccounts(), txs).get(bank.id)).toBe(12465.5);
    const row = txs.find((t) => t.accountId === bank.id && t.description === "EFT fee")!;
    expect(row).toMatchObject({ adjustment: true, direction: "expense", amount: 34.5, status: "completed", dueDate: "2026-10-14" });
  });

  it("leaves ordinary entries unflagged", async () => {
    const repo = new DemoRepo();
    const bank = await repo.createAccount({ name: "Cash", currency: "TRY", kind: "fiat", openingBalance: 0 });
    const tx = await repo.createTransaction({
      accountId: bank.id,
      direction: "expense",
      categoryId: null,
      amount: 10,
      status: "completed",
      dueDate: "2026-10-14",
      description: "Simit",
      fxSnapshot: snapshot,
    });
    expect(tx.adjustment).toBeUndefined();
  });

  it("survives a backup round trip", async () => {
    const repo = new DemoRepo();
    const bank = await repo.createAccount({ name: "EnPara TRY", currency: "TRY", kind: "fiat", openingBalance: 100 });
    await repo.createTransaction({
      accountId: bank.id,
      direction: "income",
      categoryId: null,
      amount: 1.25,
      status: "completed",
      dueDate: "2026-10-14",
      description: "Interest",
      fxSnapshot: snapshot,
      adjustment: true,
    });
    const backup = await repo.exportAll();
    await repo.importAll(backup);
    const row = (await repo.listTransactions()).find((t) => t.description === "Interest")!;
    expect(row.adjustment).toBe(true);
  });
});
