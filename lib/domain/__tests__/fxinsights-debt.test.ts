import { describe, expect, it } from "vitest";
import { computeFxInsights } from "../fxInsights";
import { computeDebtOverview } from "../debt";
import { amortizationSchedule } from "../loan";
import { Account, Loan, Transaction } from "@/lib/data/types";
import { UsdPerMap } from "../fx";

const rates: UsdPerMap = { USD: 1, TRY: 0.025, EUR: 1.1, BTC: 100000, XAU_G: 75 };

function account(id: string, currency: Account["currency"], kind: Account["kind"] = "fiat"): Account {
  return { id, name: id, currency, kind, openingBalance: 0, archived: false, paymentAccountId: null, createdAt: "2026-01-01" };
}

function tx(partial: Partial<Transaction> & Pick<Transaction, "accountId" | "direction" | "amount">): Transaction {
  return {
    id: Math.random().toString(36).slice(2),
    categoryId: null,
    status: "completed",
    dueDate: "2026-06-01",
    completedAt: "2026-06-01T10:00:00Z",
    description: "",
    fxSnapshot: null,
    transferGroupId: null,
    transferMarketRate: null,
    recurringTemplateId: null,
    loanId: null,
    victvsPayoutId: null,
    purchaseId: null,
    createdAt: "2026-06-01",
    ...partial,
  };
}

describe("computeFxInsights", () => {
  const accounts = [account("usd", "USD"), account("try", "TRY")];

  it("computes effective vs market, spread and cost per conversion", () => {
    const txs = [
      // $1000 → 40,000 TRY while market was 41/1 → spread -2.44%, cost 1000 TRY
      tx({ accountId: "usd", direction: "expense", amount: 1000, transferGroupId: "g1", transferMarketRate: 41 }),
      tx({ accountId: "try", direction: "income", amount: 40000, transferGroupId: "g1", transferMarketRate: 41 }),
      // same-currency transfer ignored
      tx({ accountId: "usd", direction: "expense", amount: 50, transferGroupId: "g2" }),
      tx({ accountId: "usd", direction: "income", amount: 50, transferGroupId: "g2" }),
    ];
    const insights = computeFxInsights({ transactions: txs, accounts, usdPer: rates, display: "TRY" });
    expect(insights.conversions).toHaveLength(1);
    const [c] = insights.conversions;
    expect(c.effective).toBe(40);
    expect(c.spread).toBeCloseTo(-2.439, 2);
    expect(c.spreadCost).toBe(1000);
    expect(insights.totalSpreadCost).toBe(1000);
    expect(insights.avgSpreadPct).toBeCloseTo(-2.439, 2);
  });

  it("falls back to the transfer's fx snapshot when no market rate stored", () => {
    const snapshot = { usdPer: { ...rates, TRY: 1 / 40 }, at: "2026-06-01" }; // market 40/1 then
    const txs = [
      tx({ accountId: "usd", direction: "expense", amount: 100, transferGroupId: "g3", fxSnapshot: snapshot }),
      tx({ accountId: "try", direction: "income", amount: 4000, transferGroupId: "g3", fxSnapshot: snapshot }),
    ];
    const insights = computeFxInsights({ transactions: txs, accounts, usdPer: rates, display: "TRY" });
    expect(insights.conversions[0].market).toBe(40);
    expect(insights.conversions[0].spread).toBe(0);
  });
});

describe("computeDebtOverview", () => {
  const card = account("card", "TRY", "credit_card");
  const loan: Loan = {
    id: "l1",
    name: "Car loan",
    kind: "car",
    currency: "TRY",
    principal: 800000,
    monthlyRatePct: 2.79,
    termMonths: 36,
    startDate: "2026-03-01",
    installment: 0,
    recurringTemplateId: null,
    createdAt: "2026-03-01",
  };

  it("combines loans and cards, totals in display currency, finds debt-free date and avalanche target", () => {
    const schedule = amortizationSchedule(800000, 2.79, 36, "2026-03-01", "TRY");
    const txs = [
      tx({ accountId: "try", direction: "expense", amount: schedule.rows[0].payment, loanId: "l1" }),
      tx({ accountId: "try", direction: "expense", amount: schedule.rows[1].payment, loanId: "l1" }),
      tx({ accountId: "card", direction: "expense", amount: 14000, status: "planned", dueDate: "2026-09-02" }),
    ];
    const balances = new Map([["card", -20000]]);
    const overview = computeDebtOverview({
      loans: [loan],
      accounts: [card, account("try", "TRY")],
      balances,
      transactions: txs,
      usdPer: rates,
      display: "TRY",
      today: "2026-06-15",
    });
    expect(overview.items).toHaveLength(2);
    const loanItem = overview.items.find((i) => i.kind === "loan")!;
    expect(loanItem.outstanding).toBe(schedule.rows[1].remaining);
    const cardItem = overview.items.find((i) => i.kind === "card")!;
    expect(cardItem.outstanding).toBe(34000); // 20k posted + 14k planned
    expect(overview.totalInDisplay).toBeCloseTo(schedule.rows[1].remaining + 34000, 2);
    expect(overview.debtFreeDate).toBe(schedule.rows[35].date); // loan outlives the card plan
    expect(overview.avalancheTarget?.id).toBe("l1");
  });

  it("skips settled cards and finished loans", () => {
    const overview = computeDebtOverview({
      loans: [],
      accounts: [card],
      balances: new Map([["card", 0]]),
      transactions: [],
      usdPer: rates,
      display: "TRY",
      today: "2026-06-15",
    });
    expect(overview.items).toHaveLength(0);
    expect(overview.debtFreeDate).toBeNull();
  });
});
