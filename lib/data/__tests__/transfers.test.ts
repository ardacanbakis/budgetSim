import { describe, expect, it } from "vitest";
import { FxSnapshot } from "@/lib/domain/fx";
import { FALLBACK_USD_PER } from "@/lib/rates/fallback";
import { DemoRepo } from "../demoRepo";

const snapshot: FxSnapshot = { usdPer: FALLBACK_USD_PER, at: "2026-10-07T09:00:00.000Z" };

async function withScheduledPayment() {
  const repo = new DemoRepo();
  const bank = await repo.createAccount({ name: "EnPara TRY", currency: "TRY", kind: "fiat", openingBalance: 0 });
  const card = await repo.createAccount({ name: "CC Akbank", currency: "TRY", kind: "credit_card", openingBalance: 0 });
  await repo.createTransfer({
    fromAccountId: bank.id,
    toAccountId: card.id,
    fromAmount: 45534.22,
    toAmount: 45534.22,
    date: "2099-10-15",
    description: "CC Akbank statement",
    marketRate: null,
    fxSnapshot: snapshot,
  });
  const legs = (await repo.listTransactions()).filter((t) => t.description === "CC Akbank statement");
  return { repo, legs, out: legs.find((t) => t.direction === "expense")! };
}

describe("a transfer's two legs move together", () => {
  it("completing one leg completes the other", async () => {
    const { repo, out } = await withScheduledPayment();
    expect(out.status).toBe("planned");
    await repo.completeTransaction(out.id, snapshot);
    const legs = (await repo.listTransactions()).filter((t) => t.transferGroupId === out.transferGroupId);
    expect(legs.map((l) => l.status)).toEqual(["completed", "completed"]);
  });

  it("completing the leg left planned doesn't re-date the one already done", async () => {
    // the half-done card payments: the money left in August, the card side
    // was only ticked in October
    const { repo, out } = await withScheduledPayment();
    const august: FxSnapshot = { usdPer: FALLBACK_USD_PER, at: "2026-08-17T09:52:53.965Z" };
    await repo.completeTransaction(out.id, august);
    const doneAt = (await repo.listTransactions()).find((t) => t.id === out.id)!.completedAt;
    // the card side planned again, as those half-done rows were
    const store = (repo as unknown as { store: { transactions: Array<{ id: string; transferGroupId: string | null; status: string }> } }).store;
    const card = store.transactions.find((t) => t.transferGroupId === out.transferGroupId && t.id !== out.id)!;
    card.status = "planned";

    await repo.completeTransaction(card.id, snapshot);
    const legs = (await repo.listTransactions()).filter((t) => t.transferGroupId === out.transferGroupId);
    expect(legs.map((l) => l.status)).toEqual(["completed", "completed"]);
    const paying = legs.find((l) => l.id === out.id)!;
    expect(paying.completedAt).toBe(doneAt);
    expect(paying.fxSnapshot?.at).toBe(august.at);
    expect(legs.find((l) => l.id === card.id)!.fxSnapshot?.at).toBe(snapshot.at);
  });

  it("reopening one leg reopens the other", async () => {
    const { repo, out } = await withScheduledPayment();
    await repo.completeTransaction(out.id, snapshot);
    await repo.reopenTransaction(out.id);
    const legs = (await repo.listTransactions()).filter((t) => t.transferGroupId === out.transferGroupId);
    expect(legs.map((l) => l.status)).toEqual(["planned", "planned"]);
  });

  it("completing it as legacy in bulk takes the other leg along", async () => {
    // the ledger lists the paying leg only; the card side used to stay planned
    const { repo, out } = await withScheduledPayment();
    await repo.bulkCompleteAsLegacy([out.id], snapshot);
    const legs = (await repo.listTransactions()).filter((t) => t.transferGroupId === out.transferGroupId);
    expect(legs.map((l) => [l.status, l.legacy])).toEqual([
      ["completed", true],
      ["completed", true],
    ]);
  });

  it("marking one leg legacy marks the other", async () => {
    const { repo, out } = await withScheduledPayment();
    await repo.completeTransaction(out.id, snapshot);
    await repo.setTransactionLegacy(out.id, true);
    const legs = (await repo.listTransactions()).filter((t) => t.transferGroupId === out.transferGroupId);
    expect(legs.map((l) => l.legacy)).toEqual([true, true]);
  });

  it("a changed amount applies to the leg it was changed on", async () => {
    const { repo, out } = await withScheduledPayment();
    await repo.completeTransaction(out.id, snapshot, 45000);
    const legs = (await repo.listTransactions()).filter((t) => t.transferGroupId === out.transferGroupId);
    expect(legs.find((l) => l.id === out.id)!.amount).toBe(45000);
    expect(legs.find((l) => l.id !== out.id)!.amount).toBe(45534.22);
  });
});
