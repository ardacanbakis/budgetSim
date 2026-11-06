import { describe, expect, it } from "vitest";
import { Account, CardEstimate, Transaction } from "@/lib/data/types";
import { buildCardBook } from "@/lib/domain/cards";
import { UsdPerMap } from "@/lib/domain/fx";
import { paymentCalendar, payoffRows, statementMatrix } from "../cardViews";

const usdPer: UsdPerMap = { USD: 1, TRY: 1 / 40, EUR: 1 / 0.9, BTC: 60000, XAU_G: 100 };
const today = "2026-11-06";

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
const row = (accountId: string, dueDate: string, amount: number, o: Partial<Transaction> = {}): Transaction => ({
  id: `r${++n}`,
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

const bank = account("bank", { name: "EnPara TRY" });
// the two cards whose November statements sit on different days in the backup
const akbank = account("akbank", {
  name: "CC Akbank",
  kind: "credit_card",
  paymentAccountId: "bank",
  paymentDay: 16,
  creditLimit: 100000,
});
const garanti = account("garanti", { name: "CC Tansu Garanti", kind: "credit_card", paymentAccountId: "bank", paymentDay: 10 });
const noDay = account("nodayCard", { name: "CC No Day", kind: "credit_card", paymentAccountId: "bank" });
const accounts = [bank, akbank, garanti, noDay];

// Akbank: a three-month taksit tail; Garanti: one installment, then done
const transactions = [
  row("akbank", "2026-11-15", 11062.43, { purchaseId: "akkiz" }),
  row("akbank", "2026-12-15", 11062.43, { purchaseId: "akkiz" }),
  row("akbank", "2027-01-15", 11062.43, { purchaseId: "akkiz" }),
  row("garanti", "2026-11-10", 6866.74, { purchaseId: "damatlik" }),
  // a plain swipe is paid by the next statement after it, so October's falls in November
  row("nodayCard", "2026-10-04", 500, { description: "Market" }),
];
const estimates: CardEstimate[] = [
  { id: "e1", accountId: "akbank", month: "2026-11", amount: 35577.29, notedOn: "2026-10-30", createdAt: "2026-10-30T00:00:00.000Z" },
];
const book = buildCardBook(accounts, transactions, estimates);

describe("statementMatrix", () => {
  const matrix = statementMatrix({ accounts, book, today, usdPer, display: "TRY", months: 3 });

  it("puts every open card against the months ahead, this month first", () => {
    expect(matrix.months).toEqual(["2026-11", "2026-12", "2027-01"]);
    expect(matrix.rows.map((r) => r.account.name)).toEqual(["CC Akbank", "CC Tansu Garanti", "CC No Day"]);
  });

  it("uses what a month is expected to be where that beats what's tracked", () => {
    const akb = matrix.rows.find((r) => r.account.id === "akbank")!;
    // November: the expectation, not the one 11,062.43 installment logged
    expect(akb.cells.map((c) => c.total)).toEqual([35577.29, 11062.43, 11062.43]);
    expect(akb.total).toBeCloseTo(57702.15, 2);
  });

  it("totals the columns in the display currency, so cards of different currencies add up", () => {
    // 2026-11: 35,577.29 + 6,866.74 + 500 = 42,944.03 TRY
    expect(matrix.columnTotals[0]).toBeCloseTo(42944.03, 2);
    expect(matrix.grandTotal).toBeCloseTo(matrix.columnTotals.reduce((s, x) => s + x, 0), 2);
  });

  it("leaves out a card with nothing in the window", () => {
    const quiet = account("quiet", { name: "CC Quiet", kind: "credit_card", paymentAccountId: "bank", paymentDay: 1 });
    const m = statementMatrix({ accounts: [...accounts, quiet], book, today, usdPer, display: "TRY", months: 3 });
    expect(m.rows.some((r) => r.account.id === "quiet")).toBe(false);
  });
});

describe("paymentCalendar", () => {
  const cal = paymentCalendar({ accounts, book, today, month: "2026-11", usdPer, display: "TRY" });

  it("puts each statement on the day it falls due", () => {
    expect([...cal.byDay.keys()].sort((a, b) => a - b)).toEqual([10, 16]);
    expect(cal.byDay.get(10)!.map((e) => e.account.name)).toEqual(["CC Tansu Garanti"]);
    expect(cal.byDay.get(16)!.map((e) => [e.account.name, e.amount])).toEqual([["CC Akbank", 35577.29]]);
  });

  it("lists a card with no payment day apart, since it has no square to sit on", () => {
    expect(cal.undated.map((e) => e.account.name)).toEqual(["CC No Day"]);
  });

  it("knows the month's shape, so a grid can be drawn without re-deriving it", () => {
    // 1 November 2026 is a Sunday: the last column of a Monday-first week
    expect(cal.daysInMonth).toBe(30);
    expect(cal.firstWeekday).toBe(6);
  });

  it("splits the month's total into what's paid and what's still to pay", () => {
    expect(cal.totals.all).toBeCloseTo(35577.29 + 6866.74 + 500, 2);
    expect(cal.totals.paid).toBe(0);
    expect(cal.totals.toPay).toBeCloseTo(cal.totals.all, 2);
  });

  it("counts a payment already made as paid, at the rates it was made at", () => {
    const paid = [
      ...transactions,
      row("bank", "2026-11-10", 6866.74, { status: "completed", transferGroupId: "g", description: "CC Tansu Garanti statement" }),
      row("garanti", "2026-11-10", 6866.74, { status: "completed", transferGroupId: "g", direction: "income" }),
    ];
    const c = paymentCalendar({
      accounts,
      book: buildCardBook(accounts, paid, estimates),
      today,
      month: "2026-11",
      usdPer,
      display: "TRY",
    });
    expect(c.byDay.get(10)!.map((e) => e.status)).toEqual(["paid"]);
    expect(c.totals.paid).toBeCloseTo(6866.74, 2);
  });
});

describe("payoffRows", () => {
  const { rows, totals } = payoffRows({ accounts, book, today, usdPer, display: "TRY" });

  it("queues the cards by what clears soonest", () => {
    expect(rows.map((r) => r.account.name)).toEqual(["CC Tansu Garanti", "CC No Day", "CC Akbank"]);
    expect(rows[0].clearsIn).toBe("2026-11");
    expect(rows.at(-1)!.clearsIn).toBe("2027-01");
  });

  it("says what each card is owed, when it ends and what it averages a month", () => {
    const akb = rows.find((r) => r.account.id === "akbank")!;
    // owed is the whole taksit tail the bank holds against the limit
    expect(akb.owed).toBeCloseTo(33187.29, 2);
    expect(akb.monthsLeft).toBe(3);
    expect(akb.next).toEqual({ month: "2026-11", date: "2026-11-16", total: 35577.29 });
    expect(akb.perMonth).toBeCloseTo(57702.15 / 3, 2);
  });

  it("reads the limit where one is set, and says so where none is", () => {
    expect(rows.find((r) => r.account.id === "akbank")!.limitUsed).toBeCloseTo(33187.29 / 100000, 6);
    expect(rows.find((r) => r.account.id === "garanti")!.limitUsed).toBeNull();
  });

  it("adds up what's owed in all and what this month bills", () => {
    expect(totals.nextMonth).toBeCloseTo(35577.29 + 6866.74 + 500, 2);
    expect(totals.owed).toBeGreaterThan(0);
  });

  it("puts an idle card last, whatever it's called", () => {
    const aaa = account("aaa", { name: "AAA Card", kind: "credit_card", paymentAccountId: "bank", paymentDay: 1 });
    const r = payoffRows({ accounts: [...accounts, aaa], book, today, usdPer, display: "TRY" }).rows;
    expect(r.at(-1)!.account.id).toBe("aaa");
    expect(r.at(-1)!.idle).toBe(true);
  });
});
