import { describe, expect, it } from "vitest";
import {
  buildInstallmentPlan,
  computePurchaseLiability,
  defaultFirstDue,
  findDueCardPayments,
  lastDueDate,
  purchaseProgress,
} from "../purchases";
import { averageMonthlySpend } from "../stats";
import { Account, Purchase, Transaction } from "@/lib/data/types";
import { UsdPerMap } from "../fx";

const rates: UsdPerMap = { USD: 1, TRY: 0.025, EUR: 1.1, BTC: 100000, XAU_G: 75 };

function account(id: string, currency: Account["currency"], kind: Account["kind"] = "fiat", opening = 0): Account {
  return {
    id,
    name: id,
    currency,
    kind,
    openingBalance: opening,
    archived: false,
    paymentAccountId: null,
    createdAt: "2026-01-01",
  };
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

describe("buildInstallmentPlan", () => {
  it("splits equally, last row absorbs remainder, sum is exact", () => {
    const rows = buildInstallmentPlan({ amount: 100, currency: "TRY", count: 3, firstDue: "2026-02-15" });
    expect(rows.map((r) => r.amount)).toEqual([33.33, 33.33, 33.34]);
    expect(rows.reduce((s, r) => s + r.amount, 0)).toBeCloseTo(100, 10);
    expect(rows.map((r) => r.dueDate)).toEqual(["2026-02-15", "2026-03-15", "2026-04-15"]);
  });

  it("clamps month-end due dates", () => {
    const rows = buildInstallmentPlan({ amount: 300, currency: "TRY", count: 3, firstDue: "2026-01-31" });
    expect(rows.map((r) => r.dueDate)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
  });

  it("first due defaults to one month after purchase; end date derived", () => {
    expect(defaultFirstDue("2026-01-15")).toBe("2026-02-15");
    expect(defaultFirstDue("2026-01-31")).toBe("2026-02-28");
    expect(lastDueDate("2026-02-15", 6)).toBe("2026-07-15");
    expect(lastDueDate("2026-02-15", 1)).toBe("2026-02-15");
  });
});

describe("purchaseProgress", () => {
  const purchase: Purchase = {
    id: "p1",
    name: "Phone",
    accountId: "card",
    amount: 60000,
    purchaseDate: "2026-04-10",
    installmentCount: 6,
    firstDue: "2026-05-10",
    details: "",
    reflected: true,
    categoryId: null,
    createdAt: "2026-04-10",
  };

  it("computes paid/remaining from linked transactions", () => {
    const txs = [
      tx({ accountId: "card", direction: "expense", amount: 10000, purchaseId: "p1", status: "completed" }),
      tx({ accountId: "card", direction: "expense", amount: 10000, purchaseId: "p1", status: "completed" }),
      tx({ accountId: "card", direction: "expense", amount: 10000, purchaseId: "p1", status: "planned" }),
      tx({ accountId: "card", direction: "expense", amount: 999, purchaseId: "other" }), // unrelated
    ];
    const progress = purchaseProgress(purchase, txs, "TRY");
    expect(progress.paidCount).toBe(2);
    expect(progress.paidAmount).toBe(20000);
    expect(progress.remainingAmount).toBe(40000);
    expect(progress.totalCount).toBe(6);
  });
});

describe("computePurchaseLiability", () => {
  it("sums only planned purchase-linked expenses, converted", () => {
    const accounts = [account("card", "TRY", "credit_card")];
    const txs = [
      tx({ accountId: "card", direction: "expense", amount: 4000, purchaseId: "p1", status: "planned" }),
      tx({ accountId: "card", direction: "expense", amount: 4000, purchaseId: "p1", status: "completed" }), // posted, already in balance
      tx({ accountId: "card", direction: "expense", amount: 999, status: "planned" }), // not purchase-linked
    ];
    // 4000 TRY * 0.025 = 100 USD
    expect(computePurchaseLiability(txs, accounts, rates, "USD")).toBe(100);
  });
});

describe("findDueCardPayments", () => {
  const card = account("card", "TRY", "credit_card");
  const balances = new Map([["card", -5000]]);

  it("prompts when debt is posted, statement is old, and no payment this month", () => {
    const txs = [tx({ accountId: "card", direction: "expense", amount: 5000, dueDate: "2026-05-20" })];
    const due = findDueCardPayments([card], balances, txs, "2026-06-15");
    expect(due).toHaveLength(1);
    expect(due[0].suggestedAmount).toBe(5000);
  });

  it("stays silent when a transfer-in exists this month or debt is fresh", () => {
    const paid = [
      tx({ accountId: "card", direction: "expense", amount: 5000, dueDate: "2026-05-20" }),
      tx({ accountId: "card", direction: "income", amount: 5000, dueDate: "2026-06-03", transferGroupId: "g1" }),
    ];
    expect(findDueCardPayments([card], balances, paid, "2026-06-15")).toHaveLength(0);

    const fresh = [tx({ accountId: "card", direction: "expense", amount: 5000, dueDate: "2026-06-10" })];
    expect(findDueCardPayments([card], balances, fresh, "2026-06-15")).toHaveLength(0);

    expect(findDueCardPayments([card], new Map([["card", 0]]), paid, "2026-06-15")).toHaveLength(0);
  });
});

describe("averageMonthlySpend", () => {
  const accounts = [account("try", "TRY"), account("card", "TRY", "credit_card")];
  const categories = [
    { id: "groc", name: "Groceries", direction: "expense" as const, color: "#f59e0b" },
    { id: "bills", name: "Bills", direction: "expense" as const, color: "#06b6d4" },
  ];

  it("averages per category and per account over the window, excluding transfers", () => {
    const txs = [
      tx({ accountId: "card", direction: "expense", amount: 4000, categoryId: "groc", dueDate: "2026-06-05" }),
      tx({ accountId: "card", direction: "expense", amount: 2000, categoryId: "groc", dueDate: "2026-05-05" }),
      tx({ accountId: "try", direction: "expense", amount: 1500, categoryId: "bills", dueDate: "2026-06-01" }),
      tx({ accountId: "try", direction: "expense", amount: 9999, categoryId: "groc", dueDate: "2026-01-05" }), // outside window
      tx({ accountId: "try", direction: "expense", amount: 5000, transferGroupId: "g1", dueDate: "2026-06-02" }), // transfer
      tx({ accountId: "try", direction: "income", amount: 8888, dueDate: "2026-06-03" }), // income
    ];
    const stats = averageMonthlySpend({
      transactions: txs,
      accounts,
      categories,
      usdPer: rates,
      display: "TRY",
      windowMonths: 3,
      today: "2026-06-15",
    });
    expect(stats.categories[0]).toMatchObject({ name: "Groceries", monthlyAverage: 2000 }); // 6000/3
    expect(stats.categories[1]).toMatchObject({ name: "Bills", monthlyAverage: 500 }); // 1500/3
    expect(stats.totalMonthlyAverage).toBe(2500);
    expect(stats.byAccount.get("card")).toBe(2000);
    expect(stats.byAccount.get("try")).toBe(500);
  });

  it("uses each transaction's fx snapshot for conversion", () => {
    const oldSnapshot = { usdPer: { ...rates, TRY: 0.05 }, at: "2026-05-01" }; // 20 TRY per USD back then
    const txs = [
      tx({ accountId: "try", direction: "expense", amount: 1000, categoryId: "groc", dueDate: "2026-05-10", fxSnapshot: oldSnapshot }),
    ];
    const stats = averageMonthlySpend({
      transactions: txs,
      accounts,
      categories,
      usdPer: rates,
      display: "USD",
      windowMonths: 1 + 1, // window covers May + June
      today: "2026-06-15",
    });
    // converted at snapshot rate: 1000 * 0.05 = $50 → /2 months = 25
    expect(stats.totalMonthlyAverage).toBe(25);
  });
});
