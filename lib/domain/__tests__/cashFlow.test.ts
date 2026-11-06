import { describe, expect, it } from "vitest";
import { Account, Transaction } from "@/lib/data/types";
import { buildCardBook } from "../cards";
import { dailyBalances, monthlyFlow, paymentRunway } from "../cashFlow";
import { UsdPerMap } from "../fx";
import { balanceSeries, buildTimeline, TimelineEvent } from "../timeline";

const usdPer: UsdPerMap = { USD: 1, TRY: 1 / 40, EUR: 1 / 0.9, BTC: 60000, XAU_G: 100 };
const today = "2026-11-06";
const horizon = "2027-02-28";

const account = (id: string, o: Partial<Account> = {}): Account => ({
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
  ...o,
});

let n = 0;
const tx = (accountId: string, dueDate: string, amount: number, o: Partial<Transaction> = {}): Transaction => ({
  id: `t${++n}`,
  accountId,
  direction: "expense",
  categoryId: null,
  amount,
  status: "planned",
  dueDate,
  completedAt: null,
  description: `row ${n}`,
  fxSnapshot: null,
  transferGroupId: null,
  transferMarketRate: null,
  recurringTemplateId: null,
  loanId: null,
  victvsPayoutId: null,
  purchaseId: null,
  legacy: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  ...o,
});

// the real shape: one lira account pays everything, a dollar account holds
// the salary, and two cards bill it on the 15th and the 16th
const enpara = account("enpara", { name: "EnPara TRY", openingBalance: 60000 });
const usd = account("usd", { name: "EnPara USD", currency: "USD", openingBalance: 1000 });
const akbank = account("akbank", { name: "CC Akbank", kind: "credit_card", paymentAccountId: "enpara", paymentDay: 16 });
const isbank = account("isbank", { name: "CC İş", kind: "credit_card", paymentAccountId: "enpara", paymentDay: 15 });
const accounts = [enpara, usd, akbank, isbank];

const transactions = [
  // what each account holds is its opening balance; no row stands in for it,
  // or the month would read 100,000 of income it never had
  // the loan instalment on the 26th, and the salary on the 5th of next month
  tx("enpara", "2026-11-26", 9046.8, { description: "Tansu Akbank 100k Kredi" }),
  tx("enpara", "2026-12-05", 43959.37, { description: "On Dijital Kredi" }),
  // what the cards are carrying: installments on their own days
  tx("akbank", "2026-11-15", 35000, { purchaseId: "akkiz", description: "Semoş AkKız (3/12)" }),
  tx("isbank", "2026-11-15", 25000, { purchaseId: "sigorta", description: "Quicksigorta (2/6)" }),
];

const book = buildCardBook(accounts, transactions);
const events = buildTimeline({ accounts, transactions, book, usdPer }, { to: horizon, today });
const series = balanceSeries({ accounts, transactions, events, today, to: horizon });

describe("paymentRunway", () => {
  const runway = paymentRunway({ events, series, accounts, today, to: horizon });
  const lira = runway.rows.filter((r) => r.account.id === "enpara");

  it("lists what moves, in the order money moves, on the account it moves", () => {
    expect(lira.map((r) => [r.date, r.label])).toEqual([
      ["2026-11-15", "CC İş"],
      ["2026-11-16", "CC Akbank"],
      ["2026-11-26", "Tansu Akbank 100k Kredi"],
      ["2026-12-05", "On Dijital Kredi"],
    ]);
  });

  it("names a statement after its card, not after the account paying it", () => {
    expect(lira[0].label).toBe("CC İş");
    expect(lira[0].account.name).toBe("EnPara TRY");
  });

  it("carries the balance going in and coming out, so a day can be read on its own", () => {
    // 60,000 − 25,000 = 35,000 on the 15th, then − 35,000 = 0 on the 16th
    expect([lira[0].before, lira[0].after]).toEqual([60000, 35000]);
    expect([lira[1].before, lira[1].after]).toEqual([35000, 0]);
  });

  it("flags the first day an account would go short, and says how low each gets", () => {
    // the 26th takes 9,046.80 out of nothing
    expect(runway.firstShort).toBe("2026-11-26");
    expect(lira[2].short).toBe(true);
    expect(lira[1].short).toBe(false);
    const low = runway.lows.find((l) => l.account.id === "enpara")!;
    expect(low.balance).toBeCloseTo(-53006.17, 2);
    expect(low.date).toBe("2026-12-05");
  });

  it("narrows to one account when asked, without changing the balances", () => {
    const only = paymentRunway({ events, series, accounts, today, to: horizon, accountId: "enpara" });
    expect(only.rows.map((r) => r.key)).toEqual(lira.map((r) => r.key));
    expect(only.rows.map((r) => r.after)).toEqual(lira.map((r) => r.after));
  });

  it("leaves out what falls outside the window", () => {
    const short = paymentRunway({ events, series, accounts, today, to: "2026-11-20" });
    expect(short.rows.map((r) => r.date)).toEqual(["2026-11-15", "2026-11-16"]);
  });
});

describe("dailyBalances", () => {
  const daily = dailyBalances({ series, currency: "TRY", today, to: horizon });

  it("keeps only the days something moves, today first", () => {
    expect(daily.dates[0]).toBe(today);
    expect(daily.dates).toEqual([today, "2026-11-15", "2026-11-16", "2026-11-26", "2026-12-05"]);
  });

  it("never mixes currencies: a dollar account is not on the lira chart", () => {
    expect(daily.lines.map((l) => l.account.id)).toEqual(["enpara"]);
    expect(dailyBalances({ series, currency: "USD", today, to: horizon }).lines.map((l) => l.account.id)).toEqual(["usd"]);
  });

  it("totals the lines and finds the lowest the total gets", () => {
    expect(daily.total).toEqual([60000, 35000, 0, -9046.8, -53006.17]);
    expect(daily.low).toEqual({ balance: -53006.17, date: "2026-12-05" });
  });
});

describe("monthlyFlow", () => {
  const months = monthlyFlow({ events, series, today, months: 3, usdPer, display: "TRY" });

  it("gives this month and the ones after it, in order", () => {
    expect(months.map((m) => m.month)).toEqual(["2026-11", "2026-12", "2027-01"]);
  });

  it("counts what leaves and what arrives, and nets them", () => {
    // November: 25,000 + 35,000 + 9,046.80 out, nothing in
    expect(months[0].expense).toBeCloseTo(69046.8, 2);
    expect(months[0].income).toBe(0);
    expect(months[0].net).toBeCloseTo(-69046.8, 2);
  });

  it("closes each month on what the cash accounts hold at its end", () => {
    // −9,046.80 lira plus $1,000 at 40 = 40,000 lira
    expect(months[0].endBalance).toBeCloseTo(-9046.8 + 40000, 2);
    expect(months[1].endBalance).toBeCloseTo(-53006.17 + 40000, 2);
  });

  it("leaves an expected payout out of the flow unless it's asked for", () => {
    const expected: TimelineEvent = {
      key: "exp:2026-11",
      kind: "expected",
      status: "expected",
      date: "2026-11-20",
      effectiveDate: "2026-11-20",
      legs: [{ accountId: "usd", delta: 1500 }],
      accountId: "usd",
      amount: 1500,
      currency: "USD",
      direction: "income",
    };
    const all = [...events, expected];
    const without = monthlyFlow({ events: all, series, today, months: 1, usdPer, display: "TRY" });
    const withIt = monthlyFlow({
      events: all,
      series,
      today,
      months: 1,
      usdPer,
      display: "TRY",
      counts: (e) => e.kind === "expected",
    });
    expect(without[0].income).toBe(0);
    expect(withIt[0].income).toBeCloseTo(60000, 2);
  });
});
