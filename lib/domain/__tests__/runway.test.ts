import { describe, expect, it } from "vitest";
import { Account, Transaction } from "@/lib/data/types";
import { buildCardBook } from "../cards";
import { businessDayBefore, tryRunway } from "../runway";
import { balanceSeries, buildTimeline } from "../timeline";

const account = (id: string, extra: Partial<Account> = {}): Account => ({
  id,
  name: id,
  currency: "TRY",
  kind: "fiat",
  openingBalance: 0,
  archived: false,
  paymentAccountId: null,
  paymentDay: null,
  creditLimit: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  ...extra,
});

let seq = 0;
function tx(accountId: string, dueDate: string, amount: number, overrides: Partial<Transaction> = {}): Transaction {
  seq += 1;
  return {
    id: `r${seq}`,
    accountId,
    direction: "expense",
    categoryId: null,
    amount,
    status: "planned",
    dueDate,
    completedAt: null,
    description: `row ${seq}`,
    fxSnapshot: null,
    transferGroupId: null,
    transferMarketRate: null,
    recurringTemplateId: null,
    loanId: null,
    victvsPayoutId: null,
    purchaseId: null,
    legacy: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function move(from: string, to: string, date: string, amount: number, toAmount = amount): Transaction[] {
  const group = `g${++seq}`;
  return [
    tx(from, date, amount, { transferGroupId: group }),
    tx(to, date, toAmount, { direction: "income", transferGroupId: group }),
  ];
}

// Monday 19 October 2026
const today = "2026-10-19";
const to = "2027-01-19";
const usdPer = { USD: 1, TRY: 1 / 40, EUR: 1.1, BTC: 100000, XAU_G: 80 };
const ziraat = account("ziraat", { openingBalance: 10000 });
const isbank = account("isbank", { openingBalance: 2000 });
const wise = account("wise", { currency: "USD", openingBalance: 3000 });
const savings = account("savings", { currency: "USD", openingBalance: 9000 });
const euro = account("euro", { currency: "EUR", openingBalance: 50000 });
const card = account("card", { kind: "credit_card", paymentAccountId: "isbank", paymentDay: 5 });
const accounts = [ziraat, isbank, wise, savings, euro, card];

function runwayOf(transactions: Transaction[], accts: Account[] = accounts) {
  const book = buildCardBook(accts, transactions);
  const events = buildTimeline({ accounts: accts, transactions, book, usdPer }, { to, today });
  const series = balanceSeries({ accounts: accts, transactions, events, today });
  return tryRunway({ series, today, to, usdPer });
}

describe("businessDayBefore", () => {
  it("steps back over the weekend, and never before today", () => {
    expect(businessDayBefore("2026-11-16", today)).toBe("2026-11-13"); // Monday → Friday
    expect(businessDayBefore("2026-11-14", today)).toBe("2026-11-13"); // Saturday → Friday
    expect(businessDayBefore("2026-11-12", today)).toBe("2026-11-11");
    expect(businessDayBefore(today, today)).toBe(today);
  });
});

describe("tryRunway", () => {
  it("walks the TRY accounts together and finds the first day short", () => {
    const rows = [tx("ziraat", "2026-11-01", 8000), tx("isbank", "2026-11-16", 5000), tx("ziraat", "2026-12-01", 3000, { direction: "income" })];
    const r = runwayOf(rows)!;
    expect(r.accounts.map((a) => a.id)).toEqual(["ziraat", "isbank"]);
    expect(r.now).toBe(12000);
    expect(r.shortOn).toBe("2026-11-16");
    expect(r.low).toEqual({ balance: -1000, date: "2026-11-16" });
    expect(r.shortfall).toBe(1000);
    // 1,000 short + a 500 floor of buffer = 1,500 lira = $37.50 → $40, from the biggest USD account
    expect(r.hint).toMatchObject({ amount: 40, toAmount: 1600, convertBy: "2026-11-13" });
    expect(r.hint!.fromAccount.id).toBe("savings");
    expect(r.hint!.toAccount.id).toBe("isbank");
  });

  it("counts an overdue row today", () => {
    const r = runwayOf([tx("ziraat", "2026-09-30", 13000)])!;
    expect(r.shortOn).toBe(today);
    expect(r.hint!.convertBy).toBe(today);
  });

  it("nets out a transfer between two TRY accounts", () => {
    const r = runwayOf(move("ziraat", "isbank", "2026-11-02", 11000))!;
    expect(r.shortOn).toBeNull();
    expect(r.low).toEqual({ balance: 12000, date: today });
    expect(r.hint).toBeNull();
  });

  it("counts a conversion into lira that's already planned", () => {
    const rows = [tx("ziraat", "2026-11-10", 15000), ...move("wise", "ziraat", "2026-11-09", 100, 4000)];
    expect(runwayOf(rows)!.shortOn).toBeNull();
  });

  it("never counts legacy rows", () => {
    const r = runwayOf([tx("ziraat", "2026-03-01", 50000, { status: "completed", legacy: true }), tx("ziraat", "2026-11-01", 50000, { legacy: true })])!;
    expect(r.now).toBe(12000);
    expect(r.shortOn).toBeNull();
  });

  it("counts card statements paid from a TRY account", () => {
    const r = runwayOf([tx("card", "2026-10-10", 13000, { status: "completed" })])!;
    expect(r.shortOn).toBe("2026-11-05");
    expect(r.low.balance).toBe(-1000);
  });

  it("converts from another currency when there's no dollar account, and needs one to convert", () => {
    const noUsd = accounts.filter((a) => a.currency !== "USD");
    const r = runwayOf([tx("ziraat", "2026-11-03", 20000)], noUsd)!;
    // 8,000 short + 5% = 8,400 lira = €190.9… → €200
    expect(r.hint).toMatchObject({ amount: 200, convertBy: "2026-11-02" });
    expect(r.hint!.fromAccount.id).toBe("euro");
    const onlyLira = runwayOf([tx("ziraat", "2026-11-03", 20000)], [ziraat, isbank])!;
    expect(onlyLira.shortOn).toBe("2026-11-03");
    expect(onlyLira.hint).toBeNull();
  });

  it("has nothing to say without a TRY account", () => {
    expect(runwayOf([], [wise])).toBeNull();
  });
});
