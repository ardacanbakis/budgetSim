import { describe, expect, it } from "vitest";
import { buildCardBook } from "../cards";
import {
  buildInstallmentPlan,
  buildPurchaseTransactionSpecs,
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
    paymentAccountId: null, paymentDay: null,
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
    legacy: false,
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

  const accounts = [account("bank", "TRY"), account("card", "TRY", "credit_card")];
  const installment = (n: number, status: Transaction["status"] = "planned") =>
    tx({ accountId: "card", direction: "expense", amount: 10000, purchaseId: "p1", status, dueDate: `2026-0${4 + n}-10` });
  const payment = (date: string, made: boolean) => [
    tx({ accountId: "bank", direction: "expense", amount: 10000, dueDate: date, transferGroupId: `g${date}`, status: made ? "completed" : "planned" }),
    tx({ accountId: "card", direction: "income", amount: 10000, dueDate: date, transferGroupId: `g${date}`, status: made ? "completed" : "planned" }),
  ];

  it("on a card, an installment is paid once the payment covering it is made", () => {
    // May and June installments; June's payment (made) covers May, July's (only planned) covers June
    const txs = [installment(1), installment(2), installment(3), ...payment("2026-06-16", true), ...payment("2026-07-16", false)];
    const book = buildCardBook(accounts, txs);
    const progress = purchaseProgress(purchase, book, txs, "TRY");
    expect(progress.paidCount).toBe(1);
    expect(progress.paidAmount).toBe(10000);
    expect(progress.remainingAmount).toBe(50000);
    expect(progress.totalCount).toBe(6);
  });

  it("history from before tracking counts as paid; ticking a row by hand doesn't", () => {
    const txs = [
      tx({ ...installment(1), legacy: true }),
      installment(2, "completed"),
      tx({ accountId: "card", direction: "expense", amount: 999, purchaseId: "other" }), // unrelated
    ];
    expect(purchaseProgress(purchase, buildCardBook(accounts, txs), txs, "TRY").paidCount).toBe(1);
  });

  it("off a card, an installment is paid when it's completed", () => {
    const onBank = { ...purchase, accountId: "bank" };
    const txs = [tx({ accountId: "bank", direction: "expense", amount: 10000, purchaseId: "p1", status: "completed" })];
    expect(purchaseProgress(onBank, buildCardBook(accounts, txs), txs, "TRY").paidCount).toBe(1);
  });
});

describe("buildPurchaseTransactionSpecs", () => {
  it("retroactive purchase: past installments are completed + legacy, current posts, future planned", () => {
    // bought 3 months ago, 6 installments — logged today
    const specs = buildPurchaseTransactionSpecs(
      { name: "TV", amount: 6000, installmentCount: 6, purchaseDate: "2026-03-10", firstDue: "2026-04-10" },
      "TRY",
      "2026-06-10"
    );
    expect(specs.map((s) => [s.dueDate, s.status, s.legacy])).toEqual([
      ["2026-04-10", "completed", true],
      ["2026-05-10", "completed", true],
      ["2026-06-10", "completed", false], // due today → posts to the card
      ["2026-07-10", "planned", false],
      ["2026-08-10", "planned", false],
      ["2026-09-10", "planned", false],
    ]);
  });

  it("an installment earlier this month posts (it's on the still-unpaid statement)", () => {
    const specs = buildPurchaseTransactionSpecs(
      { name: "TV", amount: 6000, installmentCount: 6, purchaseDate: "2026-05-05", firstDue: "2026-06-05" },
      "TRY",
      "2026-06-10"
    );
    // due June 5, today June 10 — completed but NOT legacy: the June statement isn't paid yet
    expect(specs[0]).toMatchObject({ dueDate: "2026-06-05", status: "completed", legacy: false });
  });

  it("one-shots always post (never auto-legacy)", () => {
    const [spec] = buildPurchaseTransactionSpecs(
      { name: "Chair", amount: 900, installmentCount: 1, purchaseDate: "2026-05-01", firstDue: "2026-05-01" },
      "TRY",
      "2026-06-10"
    );
    expect(spec.status).toBe("completed");
    expect(spec.legacy).toBe(false);
  });
});

describe("findDueCardPayments", () => {
  const accounts = [account("bank", "TRY"), account("card", "TRY", "credit_card")];
  const due = (txs: Transaction[], today: string) => findDueCardPayments(accounts, buildCardBook(accounts, txs), today);
  const charge = (dueDate: string, amount: number) =>
    tx({ accountId: "card", direction: "expense", amount, dueDate, status: "planned", purchaseId: "p1", completedAt: null });
  const payment = (date: string) => [
    tx({ accountId: "bank", direction: "expense", amount: 1, dueDate: date, transferGroupId: `g${date}`, status: "planned" }),
    tx({ accountId: "card", direction: "income", amount: 1, dueDate: date, transferGroupId: `g${date}`, status: "planned" }),
  ];

  it("asks for a payment covering last month's charges", () => {
    const list = due([charge("2026-05-10", 1400), charge("2026-05-20", 5000), charge("2026-06-10", 1400)], "2026-06-15");
    expect(list).toHaveLength(1);
    // this month's charge goes on next month's statement
    expect(list[0].covers.map((c) => c.dueDate)).toEqual(["2026-05-10", "2026-05-20"]);
    expect(list[0].suggestedAmount).toBe(6400);
  });

  it("stays quiet once this month's payment is recorded, or when nothing is due yet", () => {
    expect(due([charge("2026-05-20", 5000), ...payment("2026-06-16")], "2026-06-15")).toHaveLength(0);
    expect(due([charge("2026-06-10", 1400)], "2026-06-15")).toHaveLength(0);
  });
});

describe("averageMonthlySpend", () => {
  const accounts = [account("try", "TRY"), account("card", "TRY", "credit_card")];
  const categories = [
    { id: "groc", name: "Groceries", direction: "expense" as const, color: "#f59e0b" },
    { id: "bills", name: "Bills", direction: "expense" as const, color: "#06b6d4" },
  ];

  it("averages per category and per account over the window, counting a card when it's paid", () => {
    const txs = [
      // charged to the card: the payment below covers them, so they don't count again
      tx({ accountId: "card", direction: "expense", amount: 4000, categoryId: "groc", dueDate: "2026-06-05" }),
      tx({ accountId: "card", direction: "expense", amount: 2000, categoryId: "groc", dueDate: "2026-05-05" }),
      // the card payment is the spending, and it's the card's
      tx({ accountId: "try", direction: "expense", amount: 6000, transferGroupId: "pay", dueDate: "2026-06-10" }),
      tx({ accountId: "card", direction: "income", amount: 6000, transferGroupId: "pay", dueDate: "2026-06-10" }),
      tx({ accountId: "try", direction: "expense", amount: 1500, categoryId: "bills", dueDate: "2026-06-01" }),
      tx({ accountId: "try", direction: "expense", amount: 9999, categoryId: "groc", dueDate: "2026-01-05" }), // outside window
      tx({ accountId: "try", direction: "expense", amount: 5000, transferGroupId: "g1", dueDate: "2026-06-02" }), // a transfer, no card
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
    // the payment has no category of its own
    expect(stats.categories[0]).toMatchObject({ categoryId: null, monthlyAverage: 2000 }); // 6000/3
    expect(stats.categories[1]).toMatchObject({ name: "Bills", monthlyAverage: 500 }); // 1500/3
    expect(stats.totalMonthlyAverage).toBe(2500);
    expect(stats.byAccount.get("card")).toBe(2000);
    expect(stats.byAccount.get("try")).toBe(500);
  });

  it("ignores imported legacy history, which carries the import date", () => {
    const txs = [
      tx({ accountId: "try", direction: "expense", amount: 1500, categoryId: "bills", dueDate: "2026-06-01" }),
      // a back-dated import stamped with the day it was loaded — counting it
      // would make this month look like a spending disaster
      tx({ accountId: "try", direction: "expense", amount: 90_000, categoryId: "groc", dueDate: "2026-06-10", legacy: true }),
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
    expect(stats.totalMonthlyAverage).toBe(500); // 1500/3, the legacy row excluded
    expect(stats.categories.some((c) => c.name === "Groceries")).toBe(false);
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
