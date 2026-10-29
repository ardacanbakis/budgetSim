import { describe, expect, it } from "vitest";
import { Account, CardEstimate, Transaction } from "@/lib/data/types";
import { buildCardBook, cardSchedule, cardStatements, estimateTopUps, nextCardPayment } from "../cards";
import { projectCashflow } from "../projector";
import { buildTimeline } from "../timeline";

const TODAY = "2026-10-29";

const bank: Account = {
  id: "bank",
  name: "EnPara TRY",
  currency: "TRY",
  kind: "fiat",
  openingBalance: 100000,
  archived: false,
  paymentAccountId: null,
  paymentDay: null,
  creditLimit: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};
const akbank: Account = { ...bank, id: "akbank", name: "CC Akbank", kind: "credit_card", openingBalance: 0, paymentAccountId: "bank", paymentDay: 16 };
const accounts = [bank, akbank];

let seq = 0;
function tx(accountId: string, dueDate: string, amount: number, overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: `t${++seq}`,
    accountId,
    direction: "expense",
    categoryId: null,
    amount,
    status: "planned",
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
    ...overrides,
  };
}

function payment(date: string, amount: number, made: boolean): Transaction[] {
  const group = `g-${date}`;
  const status = made ? ("completed" as const) : ("planned" as const);
  return [
    tx("bank", date, amount, { transferGroupId: group, status }),
    tx("akbank", date, amount, { direction: "income", transferGroupId: group, status }),
  ];
}

const estimate = (month: string, amount: number, notedOn = "2026-10-29", id = `${month}-${amount}`): CardEstimate => ({
  id,
  accountId: "akbank",
  month,
  amount,
  notedOn,
  createdAt: `${notedOn}T10:00:00.000Z`,
});

// AkKız (3/12) and (4/12): 11,062.43 each, paid with Nov's and Dec's statements
const akkiz = [
  tx("akbank", "2026-11-15", 11062.43, { purchaseId: "akkiz", description: "AkKız (3/12)" }),
  tx("akbank", "2026-12-15", 11062.43, { purchaseId: "akkiz", description: "AkKız (4/12)" }),
];

describe("expected card statements", () => {
  it("a month pays the larger of the expectation and what's tracked", () => {
    const book = buildCardBook(accounts, akkiz, [estimate("2026-11", 31568.73), estimate("2026-12", 9000)]);
    expect(cardSchedule(book, "akbank", "2026-10")).toEqual([
      { month: "2026-11", total: 31568.73 },
      // below the tracked installment: the installment stands
      { month: "2026-12", total: 11062.43 },
    ]);
    expect(nextCardPayment(book, akbank, TODAY)).toEqual({ month: "2026-11", date: "2026-11-16", amount: 31568.73 });
    expect(estimateTopUps(book, "akbank", "2026-10").map((u) => [u.month, Math.round(u.amount * 100) / 100])).toEqual([["2026-11", 20506.3]]);
  });

  it("what the card is owed is only what's been charged", () => {
    const book = buildCardBook(accounts, akkiz, [estimate("2026-11", 31568.73)]);
    expect(book.owed("akbank", TODAY)).toBeCloseTo(22124.86, 2);
  });

  it("the latest noted counts, and a month you only expect something in is a statement", () => {
    const book = buildCardBook(accounts, [], [
      estimate("2027-01", 5000, "2026-10-20", "a"),
      estimate("2027-01", 7000, "2026-10-29", "b"),
    ]);
    expect(book.expected("akbank", "2027-01")?.amount).toBe(7000);
    expect(book.expected("akbank", "2027-01", "2026-10-25")?.amount).toBe(5000);
    expect(cardSchedule(book, "akbank", "2026-10")).toEqual([{ month: "2027-01", total: 7000 }]);
    const jan = cardStatements(book, akbank, TODAY).find((s) => s.month === "2027-01")!;
    expect([jan.status, jan.amount, jan.tracked]).toEqual(["upcoming", 7000, 0]);
  });

  it("once the month's payment is recorded, the payment is the figure, measured against what was expected by then", () => {
    const transactions = [...akkiz, ...payment("2026-11-16", 33000, false)];
    const book = buildCardBook(accounts, transactions, [
      estimate("2026-11", 31568.73, "2026-10-29", "x"),
      // noted after the payment was set down: not what it's measured against
      estimate("2026-11", 40000, "2026-11-20", "y"),
    ]);
    expect(estimateTopUps(book, "akbank", "2026-10")).toEqual([]);
    expect(cardSchedule(book, "akbank", "2026-10")[0]).toEqual({ month: "2026-11", total: 33000 });
    const nov = cardStatements(book, akbank, TODAY).find((s) => s.month === "2026-11")!;
    expect(nov.amount).toBe(33000);
    expect(nov.estimate?.amount).toBe(31568.73);
  });

  it("the plan pays the difference from the card's paying account", () => {
    const common = {
      accounts,
      transactions: akkiz,
      templates: [],
      usdPer: { TRY: 0.025, USD: 1, EUR: 1.1, BTC: 100000, XAU_G: 75 },
      display: "TRY" as const,
      fromDate: TODAY,
      months: 3,
    };
    const without = projectCashflow(common);
    const withEstimate = projectCashflow({ ...common, cardEstimates: [estimate("2026-11", 31568.73)] });
    const nov = (r: typeof without) => r.months.find((m) => m.month === "2026-11")!;
    expect(nov(without).expense).toBeCloseTo(11062.43, 2);
    expect(nov(withEstimate).expense).toBeCloseTo(31568.73, 2);
    expect(withEstimate.months.find((m) => m.month === "2026-12")!.expense).toBeCloseTo(11062.43, 2);
  });

  it("the Timeline's statement is the expected figure, leaving the paying account", () => {
    const book = buildCardBook(accounts, akkiz, [estimate("2026-11", 31568.73), estimate("2027-01", 4000)]);
    const events = buildTimeline({ accounts, transactions: akkiz, book }, { to: "2027-01-31", today: TODAY }).filter((e) => e.kind === "statement");
    expect(events.map((e) => [e.date, e.amount])).toEqual([
      ["2026-11-16", 31568.73],
      ["2026-12-16", 11062.43],
      ["2027-01-16", 4000],
    ]);
    expect(events[0].legs).toEqual([{ accountId: "bank", delta: -31568.73 }]);
  });
});
