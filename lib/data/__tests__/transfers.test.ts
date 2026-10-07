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

  it("reopening one leg reopens the other", async () => {
    const { repo, out } = await withScheduledPayment();
    await repo.completeTransaction(out.id, snapshot);
    await repo.reopenTransaction(out.id);
    const legs = (await repo.listTransactions()).filter((t) => t.transferGroupId === out.transferGroupId);
    expect(legs.map((l) => l.status)).toEqual(["planned", "planned"]);
  });

  it("a changed amount applies to the leg it was changed on", async () => {
    const { repo, out } = await withScheduledPayment();
    await repo.completeTransaction(out.id, snapshot, 45000);
    const legs = (await repo.listTransactions()).filter((t) => t.transferGroupId === out.transferGroupId);
    expect(legs.find((l) => l.id === out.id)!.amount).toBe(45000);
    expect(legs.find((l) => l.id !== out.id)!.amount).toBe(45534.22);
  });
});
