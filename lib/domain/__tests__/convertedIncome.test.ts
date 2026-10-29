import { describe, expect, it } from "vitest";
import { Account, RecurringTemplate, Transaction } from "@/lib/data/types";
import { buildCardBook } from "../cards";
import { conversionFor, cutFrom, expectedArrival, middlemanCuts, pendingConversions, usualCut } from "../convertedIncome";
import { computeFxInsights } from "../fxInsights";
import { UsdPerMap } from "../fx";
import { findAutoCompletable } from "../materialize";
import { projectCashflow } from "../projector";
import { buildTimeline } from "../timeline";

// 40 lira a dollar
const usdPer: UsdPerMap = { USD: 1, TRY: 1 / 40, EUR: 1.1, BTC: 100000, XAU_G: 80 };

function account(id: string, currency: Account["currency"], openingBalance = 0): Account {
  return { id, name: id === "try" ? "EnPara TRY" : "EnPara USD", currency, kind: "fiat", openingBalance, archived: false, paymentAccountId: null, paymentDay: null, createdAt: "2026-01-01" };
}
const accounts = [account("usd", "USD"), account("try", "TRY")];

let seq = 0;
function tx(partial: Partial<Transaction> & Pick<Transaction, "accountId" | "direction" | "amount">): Transaction {
  seq++;
  return {
    id: `t${seq}`,
    categoryId: null,
    status: "completed",
    dueDate: "2026-06-05",
    completedAt: "2026-06-05T10:00:00Z",
    description: "WBL",
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

/** a conversion: $from out of USD, ₺to into TRY, at a market of 40 */
function conversion(date: string, from: number, to: number, convertsId: string | null = null): Transaction[] {
  const g = `g${++seq}`;
  return [
    tx({ accountId: "usd", direction: "expense", amount: from, dueDate: date, transferGroupId: g, transferMarketRate: 40, convertsId }),
    tx({ accountId: "try", direction: "income", amount: to, dueDate: date, transferGroupId: g, transferMarketRate: 40, convertsId }),
  ];
}

const wbl: RecurringTemplate = {
  id: "wbl",
  name: "WBL",
  accountId: "usd",
  direction: "income",
  categoryId: null,
  amount: 2090,
  frequency: "monthly",
  startDate: "2026-03-05",
  endDate: null,
  autoComplete: true,
  loanId: null,
  convertToAccountId: "try",
  convertFrom: "2026-10-01",
  createdAt: "2026-03-01",
};

describe("the middleman's usual cut", () => {
  it("is the average loss of the last three conversions, never below zero", () => {
    // 2% lost, 1% lost, 3% lost (latest three), and an old one at 10% that no longer counts
    const txs = [
      ...conversion("2026-01-05", 1000, 36000),
      ...conversion("2026-07-05", 1000, 39200),
      ...conversion("2026-08-05", 1000, 39600),
      ...conversion("2026-09-05", 1000, 38800),
    ];
    expect(cutFrom({ transactions: txs, accounts, usdPer, from: "USD", to: "TRY" })).toEqual({ cut: expect.closeTo(0.02, 6), samples: 3 });
    // a better-than-market one isn't a negative cut
    expect(usualCut({ transactions: conversion("2026-09-05", 1000, 41000), accounts, usdPer, from: "USD", to: "TRY" })).toBe(0);
    expect(cutFrom({ transactions: [], accounts, usdPer, from: "USD", to: "TRY" })).toEqual({ cut: 0, samples: 0 });
  });

  it("what should arrive: today's rate less the cut", () => {
    expect(expectedArrival(2090, "USD", "TRY", usdPer, 0.02)).toBe(81928);
    expect(expectedArrival(2090, "USD", "TRY", usdPer, 0)).toBe(83600);
  });

  it("per pair this year, for Reports", () => {
    const txs = [...conversion("2025-12-05", 1000, 30000), ...conversion("2026-07-05", 1000, 39200), ...conversion("2026-08-05", 1000, 39600)];
    const { conversions } = computeFxInsights({ transactions: txs, accounts, usdPer, display: "TRY" });
    expect(middlemanCuts(conversions, "2026")).toEqual([{ from: "USD", to: "TRY", avgPct: expect.closeTo(1.5, 6), cost: 1200, count: 2 }]);
  });
});

describe("paydays of a converted income", () => {
  it("convert from the item's first converted payday, into another currency", () => {
    const row = tx({ accountId: "usd", direction: "income", amount: 2090, recurringTemplateId: "wbl", dueDate: "2026-10-05" });
    expect(conversionFor(row, [wbl], accounts)?.to.id).toBe("try");
    expect(conversionFor({ ...row, dueDate: "2026-09-05" }, [wbl], accounts)).toBeNull();
    expect(conversionFor({ ...row, legacy: true }, [wbl], accounts)).toBeNull();
    expect(conversionFor(row, [{ ...wbl, convertToAccountId: null }], accounts)).toBeNull();
  });

  it("a payday done waits for what arrived until a transfer says it converts it", () => {
    const done = tx({ accountId: "usd", direction: "income", amount: 2090, recurringTemplateId: "wbl", dueDate: "2026-10-05" });
    const before = tx({ accountId: "usd", direction: "income", amount: 2090, recurringTemplateId: "wbl", dueDate: "2026-09-05" });
    expect(pendingConversions([done, before], [wbl], accounts).map((p) => p.row.id)).toEqual([done.id]);
    expect(pendingConversions([done, before, ...conversion("2026-10-06", 2090, 82000, done.id)], [wbl], accounts)).toEqual([]);
  });

  it("never auto-completes: what arrived has to be typed in", () => {
    const due = tx({ accountId: "usd", direction: "income", amount: 2090, recurringTemplateId: "wbl", status: "planned", dueDate: "2026-10-05" });
    const old = tx({ accountId: "usd", direction: "income", amount: 2090, recurringTemplateId: "wbl", status: "planned", dueDate: "2026-09-05" });
    expect(findAutoCompletable([wbl], [due, old], "2026-10-29").map((t) => t.id)).toEqual([old.id]);
  });
});

describe("the plan and the timeline", () => {
  const history = [...conversion("2026-08-05", 1000, 39200), ...conversion("2026-09-05", 1000, 39200)];
  const payday = tx({ accountId: "usd", direction: "income", amount: 2090, recurringTemplateId: "wbl", status: "planned", dueDate: "2026-11-05" });
  const cut = () => 0.02;

  it("a payday to come lands in lira, at the month's rate less the cut", () => {
    // dollars enough for the two conversions, so nothing is drawn to cover them
    const result = projectCashflow({
      accounts: [account("usd", "USD", 5000), account("try", "TRY")],
      transactions: [...history, payday],
      templates: [{ ...wbl, endDate: "2026-11-30" }],
      usdPer,
      display: "TRY",
      fromDate: "2026-11-01",
      months: 1,
      funding: { order: ["usd", "try"], routine: [] },
      conversionCut: cut,
    });
    const [nov] = result.months;
    expect(nov.income).toBeCloseTo(81928, 2);
    // into the lira account (two conversions + this payday), the dollars untouched
    expect(nov.sourceBalances.try).toBeCloseTo(39200 * 2 + 81928, 2);
    expect(nov.sourceBalances.usd).toBeCloseTo(3000, 2);
  });

  it("the timeline's leg is on the lira account, approx", () => {
    const book = buildCardBook(accounts, [payday]);
    const events = buildTimeline({ accounts, transactions: [payday], templates: [wbl], book, usdPer, conversionCut: cut }, { to: "2026-12-31", today: "2026-10-29" });
    const e = events.find((x) => x.key === payday.id)!;
    expect(e.legs).toEqual([{ accountId: "try", delta: 81928, approx: true }]);
    // shown as the income it is, in dollars
    expect(e.amount).toBe(2090);
    expect(e.currency).toBe("USD");
  });
});
