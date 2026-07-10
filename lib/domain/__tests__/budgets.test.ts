import { describe, expect, it } from "vitest";
import { budgetStatuses, budgetWarningFor, goalProgress, safeToSpend } from "../budgets";
import { Account, Budget, Goal, Transaction } from "@/lib/data/types";
import { UsdPerMap } from "../fx";

const rates: UsdPerMap = { USD: 1, TRY: 0.025, EUR: 1.1, BTC: 100000, XAU_G: 75 };

function account(id: string, currency: Account["currency"], kind: Account["kind"] = "fiat", opening = 0): Account {
  return { id, name: id, currency, kind, openingBalance: opening, archived: false, paymentAccountId: null, paymentDay: null, createdAt: "2026-01-01" };
}

function tx(partial: Partial<Transaction> & Pick<Transaction, "accountId" | "direction" | "amount">): Transaction {
  return {
    id: Math.random().toString(36).slice(2),
    categoryId: null,
    status: "completed",
    dueDate: "2026-06-10",
    completedAt: "2026-06-10T10:00:00Z",
    description: "",
    fxSnapshot: null,
    transferGroupId: null,
    transferMarketRate: null,
    recurringTemplateId: null,
    loanId: null,
    victvsPayoutId: null,
    purchaseId: null,
    legacy: false,
    createdAt: "2026-06-10",
    ...partial,
  };
}

const groceriesBudget: Budget = { id: "b1", categoryId: "groc", monthlyLimit: 15000, currency: "TRY" };

describe("budgetStatuses", () => {
  const accounts = [account("try", "TRY"), account("card", "TRY", "credit_card"), account("usd", "USD")];

  it("sums this month's completed spend per budget with conversion, sets levels", () => {
    const txs = [
      tx({ accountId: "try", direction: "expense", amount: 6000, categoryId: "groc" }),
      tx({ accountId: "card", direction: "expense", amount: 4000, categoryId: "groc" }),
      tx({ accountId: "usd", direction: "expense", amount: 50, categoryId: "groc" }), // 50 USD = 2000 TRY
      tx({ accountId: "try", direction: "expense", amount: 9999, categoryId: "groc", dueDate: "2026-05-10" }), // other month
      tx({ accountId: "try", direction: "expense", amount: 500, categoryId: "groc", status: "planned" }), // planned
    ];
    const [status] = budgetStatuses({ budgets: [groceriesBudget], transactions: txs, accounts, usdPer: rates, month: "2026-06" });
    expect(status.spent).toBe(12000);
    expect(status.level).toBe("warn"); // 80%
    const over = budgetStatuses({
      budgets: [{ ...groceriesBudget, monthlyLimit: 10000 }],
      transactions: txs,
      accounts,
      usdPer: rates,
      month: "2026-06",
    })[0];
    expect(over.level).toBe("over");
  });
});

describe("budgetWarningFor", () => {
  it("warns when a new expense would cross 80% / 100%", () => {
    const statuses = [{ budget: groceriesBudget, spent: 10000, pct: 66.7, level: "ok" as const }];
    expect(
      budgetWarningFor({ budgets: [groceriesBudget], statuses, categoryId: "groc", amount: 1000, currency: "TRY", usdPer: rates })
    ).toBeNull(); // 11k / 15k = 73%
    expect(
      budgetWarningFor({ budgets: [groceriesBudget], statuses, categoryId: "groc", amount: 3000, currency: "TRY", usdPer: rates })
    ).toMatchObject({ level: "warn" }); // 13k = 87%
    expect(
      budgetWarningFor({ budgets: [groceriesBudget], statuses, categoryId: "groc", amount: 150, currency: "USD", usdPer: rates })
    ).toMatchObject({ level: "over" }); // +6000 TRY = 16k
    expect(
      budgetWarningFor({ budgets: [groceriesBudget], statuses, categoryId: "other", amount: 99999, currency: "TRY", usdPer: rates })
    ).toBeNull(); // no budget on that category
  });
});

describe("safeToSpend", () => {
  it("liquid fiat + remaining planned income − remaining planned expenses this month", () => {
    const accounts = [
      account("try", "TRY", "fiat"),
      account("card", "TRY", "credit_card"), // excluded from liquid
      account("btc", "BTC", "crypto"), // excluded from liquid
    ];
    const balances = new Map([
      ["try", 40000],
      ["card", -10000],
      ["btc", 0.1],
    ]);
    const txs = [
      tx({ accountId: "try", direction: "income", amount: 20000, status: "planned", dueDate: "2026-06-20" }),
      tx({ accountId: "try", direction: "expense", amount: 27500, status: "planned", dueDate: "2026-06-25" }),
      tx({ accountId: "card", direction: "expense", amount: 14000, status: "planned", dueDate: "2026-06-28" }), // installment counts
      tx({ accountId: "try", direction: "expense", amount: 9999, status: "planned", dueDate: "2026-06-05" }), // already past today
      tx({ accountId: "try", direction: "expense", amount: 9999, status: "planned", dueDate: "2026-07-10" }), // next month
      tx({ accountId: "try", direction: "expense", amount: 5000, status: "planned", dueDate: "2026-06-20", transferGroupId: "g" }),
    ];
    const result = safeToSpend({ accounts, balances, transactions: txs, usdPer: rates, display: "TRY", today: "2026-06-15" });
    expect(result.liquid).toBe(40000);
    expect(result.plannedIncome).toBe(20000);
    expect(result.plannedExpense).toBe(41500);
    expect(result.total).toBe(18500);
  });
});

describe("goalProgress", () => {
  const goal: Goal = { id: "g1", name: "Emergency fund", accountId: "usd", targetAmount: 10000, targetDate: "2026-12-15", createdAt: "2026-01-01" };

  it("computes pct, remaining and required monthly to target date", () => {
    const progress = goalProgress(goal, 6400, "2026-06-15");
    expect(progress.pct).toBe(64);
    expect(progress.remaining).toBe(3600);
    expect(progress.requiredMonthly).toBe(600); // 6 months left
  });

  it("handles reached goals and missing dates", () => {
    expect(goalProgress(goal, 12000, "2026-06-15")).toMatchObject({ pct: 100, remaining: 0, requiredMonthly: null });
    expect(goalProgress({ ...goal, targetDate: null }, 5000, "2026-06-15").requiredMonthly).toBeNull();
  });
});
