import { describe, expect, it } from "vitest";
import { Account, NetWorthSnapshot, Transaction } from "@/lib/data/types";
import { buildCardBook } from "@/lib/domain/cards";
import { UsdPerMap } from "@/lib/domain/fx";
import { cardStandings, findDueCardPayments } from "@/lib/domain/purchases";
import { debtHref, monthItems, statementRows, thisMonthSummary, trendPoints } from "../dashboardCards";

const usdPer: UsdPerMap = { USD: 1, TRY: 1 / 40, EUR: 1 / 0.9, BTC: 60000, XAU_G: 100 };
const today = "2026-10-16";

describe("thisMonthSummary", () => {
  const flow = [
    { month: "2026-05", income: 1000, expense: 600 },
    { month: "2026-06", income: 1000, expense: 800 },
    { month: "2026-07", income: 1000, expense: 700 },
    { month: "2026-08", income: 1000, expense: 900 },
    { month: "2026-09", income: 1000, expense: 1000 },
    { month: "2026-10", income: 2000, expense: 400 },
  ];

  it("takes in, out, net and the share kept from this month", () => {
    const m = thisMonthSummary(flow, today)!;
    expect(m).toMatchObject({ month: "2026-10", income: 2000, expense: 400, net: 1600 });
    expect(m.savingsRate).toBeCloseTo(0.8, 10);
  });

  it("compares with the mean of the earlier months, and paces spending against it", () => {
    const m = thisMonthSummary(flow, today)!;
    expect(m.usual).toEqual({ income: 1000, expense: 800, net: 200 });
    // 400 of a usual 800 spent, 16 of 31 days gone: on pace
    expect(m.pace!.pct).toBeCloseTo(50, 10);
    expect(m.pace!.tone).toBe("ok");
  });

  it("says nothing it can't: no income, no earlier months, no month at all", () => {
    const alone = thisMonthSummary([{ month: "2026-10", income: 0, expense: 50 }], today)!;
    expect(alone.savingsRate).toBeNull();
    expect(alone.usual).toBeNull();
    expect(alone.pace).toBeNull();
    expect(thisMonthSummary([], today)).toBeNull();
  });
});

describe("trendPoints", () => {
  const snap = (date: string, totalUsd: number): NetWorthSnapshot => ({
    id: date,
    snapshotDate: date,
    balances: {},
    usdPer,
    totalUsd,
  });

  it("keeps the last 12 months, one point a month, then now", () => {
    const snapshots = [
      snap("2025-09-01", 1),
      snap("2025-11-01", 100),
      snap("2026-09-01", 300),
      snap("2026-10-01", 400),
      snap("2026-10-02", 450),
    ];
    const trend = trendPoints({ snapshots, now: 20000, usdPer, display: "TRY", today });
    expect(trend.points.map((p) => p.month)).toEqual(["2025-11", "2026-09", "2026-10", "now"]);
    expect(trend.points[2].value).toBeCloseTo(18000, 6);
    expect(trend.change).toBeCloseTo(2000, 6);
    expect(trend.overPeriod).toBeCloseTo(16000, 6);
  });

  it("is just now without snapshots", () => {
    const trend = trendPoints({ snapshots: [], now: 5, usdPer, display: "USD", today });
    expect(trend).toEqual({ points: [{ month: "now", value: 5 }], change: null, overPeriod: null });
  });
});

describe("statementRows", () => {
  const card = (id: string, paymentDay: number | null): Account => ({
    id,
    name: id,
    currency: "TRY",
    kind: "credit_card",
    openingBalance: 0,
    archived: false,
    paymentAccountId: null,
    paymentDay,
    creditLimit: 10000,
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  const charge = (accountId: string, dueDate: string, amount: number) =>
    ({
      id: `${accountId}-${dueDate}`,
      accountId,
      direction: "expense",
      categoryId: null,
      amount,
      status: "completed",
      dueDate,
      completedAt: null,
      description: "",
      fxSnapshot: null,
      transferGroupId: null,
      transferMarketRate: null,
      recurringTemplateId: null,
      loanId: null,
      victvsPayoutId: null,
      purchaseId: null,
      legacy: false,
      createdAt: "2026-01-01T00:00:00.000Z",
    }) as Transaction;

  it("lists cards with something to pay, soonest first, and sets the idle ones apart", () => {
    const accounts = [card("late", 25), card("soon", 20), card("idle", 5)];
    const book = buildCardBook(accounts, [charge("late", "2026-09-10", 1200), charge("soon", "2026-10-02", 300)]);
    const standings = cardStandings(accounts, book, today);
    const result = statementRows({ standings, book, today, duePayments: findDueCardPayments(accounts, book, today) });
    expect(result.active.map((r) => r.account.id)).toEqual(["soon", "late"]);
    expect(result.idle.map((a) => a.id)).toEqual(["idle"]);
    const late = result.active[1];
    expect(late.figure.amount).toBe(1200);
    expect(late.next).toEqual([{ month: "2026-10", total: 1200 }]);
    expect(result.active[0].next).toEqual([{ month: "2026-11", total: 300 }]);
  });
});

describe("debtHref", () => {
  it("opens the loans page", () => {
    expect(debtHref("loan-1")).toBe("/accounts?view=debts&loan=loan-1");
    expect(debtHref()).toBe("/accounts?view=debts");
  });
});

describe("monthItems", () => {
  const base: Account = {
    id: "bank", name: "EnPara TRY", currency: "TRY", kind: "fiat", openingBalance: 0, archived: false,
    paymentAccountId: null, paymentDay: null, creditLimit: null, createdAt: "2026-01-01T00:00:00.000Z",
  };
  const usd: Account = { ...base, id: "usd", name: "EnPara USD", currency: "USD" };
  const akbank: Account = { ...base, id: "akbank", name: "CC Akbank", kind: "credit_card", paymentAccountId: "bank", paymentDay: 16 };
  const enpara: Account = { ...base, id: "enpara", name: "CC EnPara", kind: "credit_card", paymentAccountId: "bank", paymentDay: 16 };
  const accounts = [base, usd, akbank, enpara];
  let n = 0;
  const row = (accountId: string, dueDate: string, amount: number, o: Partial<Transaction> = {}): Transaction => ({
    id: `r${++n}`, accountId, direction: "expense", categoryId: null, amount, status: "planned", dueDate, completedAt: null,
    description: `row ${n}`, fxSnapshot: null, transferGroupId: null, transferMarketRate: null, recurringTemplateId: null,
    loanId: null, victvsPayoutId: null, purchaseId: null, legacy: false, createdAt: "2026-01-01T00:00:00.000Z", ...o,
  });
  const transactions = [
    row("usd", "2026-10-05", 2090, { direction: "income", status: "completed", description: "WBL 2026" }),
    row("bank", "2026-10-04", 40476.14, { status: "completed", description: "Renault-Suzi Orfin" }),
    row("bank", "2026-10-26", 9046.8, { description: "Tansu Akbank 100k Kredi" }),
    // a card payment recorded: the payment counts, the charge it covers doesn't
    row("bank", "2026-10-16", 30000, { status: "completed", transferGroupId: "g", description: "CC Akbank statement" }),
    row("akbank", "2026-10-16", 30000, { direction: "income", status: "completed", transferGroupId: "g" }),
    row("akbank", "2026-09-20", 30000, { status: "completed", description: "Migros" }),
    // CC EnPara's October statement: nothing recorded, so it's expected
    row("enpara", "2026-09-28", 4000, { status: "completed", description: "Market" }),
    // a transfer between your own accounts is neither
    row("bank", "2026-10-10", 1000, { status: "completed", transferGroupId: "t" }),
    row("usd", "2026-10-10", 25, { direction: "income", status: "completed", transferGroupId: "t" }),
    // another month
    row("bank", "2026-11-04", 40476.14, { description: "Renault-Suzi Orfin" }),
  ];
  const book = buildCardBook(accounts, transactions);
  const items = monthItems({ transactions, accounts, book, today: "2026-10-20", usdPer, display: "TRY" });

  it("lists the month's incomes and expenses, done and still to come, and an expected card statement", () => {
    expect(items.income.map((i) => [i.label, i.status, i.value])).toEqual([["WBL 2026", "done", 83600]]);
    expect(items.expense.map((i) => [i.date, i.label, i.status])).toEqual([
      ["2026-10-04", "Renault-Suzi Orfin", "done"],
      ["2026-10-16", "CC Akbank statement", "done"],
      ["2026-10-16", "CC EnPara", "expected"],
      ["2026-10-26", "Tansu Akbank 100k Kredi", "planned"],
    ]);
    expect(items.expense.find((i) => i.status === "expected")?.accountName).toBe("EnPara TRY");
  });

  it("splits the totals into done and still to come", () => {
    expect(items.totals).toEqual({ incomeDone: 83600, incomeAhead: 0, expenseDone: 70476.14, expenseAhead: 13046.8 });
  });
});
