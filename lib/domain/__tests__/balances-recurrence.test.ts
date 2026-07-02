import { describe, expect, it } from "vitest";
import { computeBalances, computeNetWorth } from "../balances";
import { addMonthsClamped, occurrencesBetween } from "../recurrence";
import { Account, Transaction } from "@/lib/data/types";
import { UsdPerMap } from "../fx";

function account(id: string, currency: Account["currency"], opening = 0): Account {
  return {
    id,
    name: id,
    currency,
    kind: currency === "BTC" ? "crypto" : currency === "XAU_G" ? "gold" : "fiat",
    openingBalance: opening,
    archived: false,
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
    createdAt: "2026-06-01",
    ...partial,
  };
}

const rates: UsdPerMap = { USD: 1, TRY: 1 / 40, EUR: 1.1, BTC: 100000, XAU_G: 75 };

describe("computeBalances", () => {
  it("derives balances from opening + completed transactions only", () => {
    const accounts = [account("usd", "USD", 1000), account("try", "TRY", 5000)];
    const txs = [
      tx({ accountId: "usd", direction: "income", amount: 250.5 }),
      tx({ accountId: "usd", direction: "expense", amount: 100.25 }),
      tx({ accountId: "usd", direction: "income", amount: 999, status: "planned" }), // ignored
      tx({ accountId: "try", direction: "expense", amount: 1200 }),
    ];
    const balances = computeBalances(accounts, txs);
    expect(balances.get("usd")).toBe(1150.25);
    expect(balances.get("try")).toBe(3800);
  });

  it("handles transfer legs as normal income/expense on each account", () => {
    const accounts = [account("usd", "USD", 1000), account("try", "TRY", 0)];
    const txs = [
      tx({ accountId: "usd", direction: "expense", amount: 100, transferGroupId: "g1" }),
      tx({ accountId: "try", direction: "income", amount: 4100, transferGroupId: "g1" }),
    ];
    const balances = computeBalances(accounts, txs);
    expect(balances.get("usd")).toBe(900);
    expect(balances.get("try")).toBe(4100);
  });
});

describe("computeNetWorth", () => {
  it("converts all balances to display currency, skipping unavailable rates", () => {
    const accounts = [account("usd", "USD", 1000), account("gold", "XAU_G", 10)];
    const balances = new Map([
      ["usd", 1000],
      ["gold", 10],
    ]);
    const full = computeNetWorth(accounts, balances, rates, "USD");
    expect(full.total).toBe(1750); // 1000 + 10g * 75
    expect(full.skippedAccountIds).toEqual([]);

    const noGold = computeNetWorth(accounts, balances, { ...rates, XAU_G: null }, "USD");
    expect(noGold.total).toBe(1000);
    expect(noGold.skippedAccountIds).toEqual(["gold"]);
  });
});

describe("recurrence", () => {
  it("clamps month-end days", () => {
    expect(addMonthsClamped("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsClamped("2024-01-31", 1)).toBe("2024-02-29"); // leap year
    expect(addMonthsClamped("2026-01-31", 2)).toBe("2026-03-31"); // not sticky
  });

  it("generates monthly occurrences on the anchor day", () => {
    const dates = occurrencesBetween(
      { frequency: "monthly", startDate: "2026-01-15", endDate: null },
      "2026-03-01",
      "2026-06-30"
    );
    expect(dates).toEqual(["2026-03-15", "2026-04-15", "2026-05-15", "2026-06-15"]);
  });

  it("respects endDate and weekly cadence", () => {
    const dates = occurrencesBetween(
      { frequency: "weekly", startDate: "2026-06-01", endDate: "2026-06-20" },
      "2026-06-01",
      "2026-12-31"
    );
    expect(dates).toEqual(["2026-06-01", "2026-06-08", "2026-06-15"]);
  });
});
