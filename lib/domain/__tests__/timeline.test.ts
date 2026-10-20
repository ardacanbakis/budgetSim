import { describe, expect, it } from "vitest";
import { buildDemoSeed } from "@/lib/data/demoSeed";
import { Account, Loan, Purchase, RecurringTemplate, Transaction } from "@/lib/data/types";
import { computeBalances } from "../balances";
import { buildCardBook, cardSchedule, paymentDateIn } from "../cards";
import { buildSchedule } from "../loanSchedule";
import { cardStandings, findDueCardPayments, lastDueDate } from "../purchases";
import { addDays, todayISO } from "../recurrence";
import {
  balanceAt,
  balanceSeries,
  buildTimeline,
  debtMilestones,
  expectedVictvsEvents,
  ledgerEvents,
  lowestAhead,
  statementEvents,
  TimelineEvent,
  typicalPayoutDay,
} from "../timeline";
import { comingUp } from "@/lib/ui/pocket/attention";

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
    id: `t${String(seq).padStart(3, "0")}`,
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
    createdAt: `2026-01-01T00:00:${String(seq % 60).padStart(2, "0")}.000Z`,
    ...overrides,
  };
}

/** Both legs of a move between two accounts: the leaving leg first. */
function transfer(from: string, to: string, date: string, amount: number, status: Transaction["status"], toAmount = amount): Transaction[] {
  const group = `g${++seq}`;
  return [
    tx(from, date, amount, { transferGroupId: group, status, description: `to ${to}` }),
    tx(to, date, toAmount, { direction: "income", transferGroupId: group, status, description: `from ${from}` }),
  ];
}

const today = "2026-10-19";
const bank = account("bank", { openingBalance: 10000 });
const wise = account("wise", { currency: "USD", openingBalance: 500 });
const card = account("card", { kind: "credit_card", paymentAccountId: "bank", paymentDay: 15 });
const accounts = [bank, wise, card];
const byId = new Map(accounts.map((a) => [a.id, a] as const));

function timelineOf(transactions: Transaction[], extra: Partial<Parameters<typeof buildTimeline>[0]> = {}, to = "2027-10-19") {
  const book = buildCardBook(extra.accounts ?? accounts, transactions);
  return buildTimeline({ accounts, transactions, book, ...extra }, { to, today });
}

const seriesOf = (transactions: Transaction[], events: TimelineEvent[], accts: Account[] = accounts) =>
  balanceSeries({ accounts: accts, transactions, events, today });

describe("paymentDateIn", () => {
  it("is the card's payment day in that month, clamped to its length", () => {
    expect(paymentDateIn("2026-10", 15)).toBe("2026-10-15");
    expect(paymentDateIn("2026-11", 31)).toBe("2026-11-30");
    expect(paymentDateIn("2027-02", 30)).toBe("2027-02-28");
    expect(paymentDateIn("2026-10", null)).toBeNull();
  });
});

describe("ledgerEvents", () => {
  it("shows a transfer once, as the leg that leaves, and moves both accounts", () => {
    const legs = transfer("wise", "bank", "2026-11-02", 100, "planned", 4180);
    const events = timelineOf(legs);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ key: legs[0].id, direction: "none", status: "planned" });
    expect(events[0].legs).toEqual([
      { accountId: "wise", delta: -100 },
      { accountId: "bank", delta: 4180 },
    ]);
    const series = seriesOf(legs, events);
    expect(balanceAt(series.get("wise")!.points, "2026-11-02")).toBe(400);
    expect(balanceAt(series.get("bank")!.points, "2026-11-02")).toBe(14180);
    expect(balanceAt(series.get("bank")!.points, "2026-11-01")).toBe(10000);
  });

  it("dates an overdue row where it was due and has it take effect today", () => {
    const late = tx("bank", "2026-10-02", 450);
    const [event] = timelineOf([late]);
    expect(event).toMatchObject({ status: "overdue", date: "2026-10-02", effectiveDate: today });
    const series = seriesOf([late], [event]);
    expect(balanceAt(series.get("bank")!.points, today)).toBe(9550);
    // it never moved the past
    expect(balanceAt(series.get("bank")!.points, "2026-10-10")).toBeNull();
  });

  it("steps a row completed before its date once, today, not again on its date", () => {
    const early = tx("bank", "2026-10-28", 2800, { status: "completed" });
    const events = timelineOf([early]);
    expect(events[0]).toMatchObject({ status: "completed", date: "2026-10-28", effectiveDate: today, early: true });
    const points = seriesOf([early], events).get("bank")!.points;
    expect(balanceAt(points, today)).toBe(7200);
    expect(balanceAt(points, "2026-10-28")).toBe(7200);
    expect(balanceAt(points, "2026-11-30")).toBe(7200);
  });

  it("lists legacy rows but never moves a balance with them", () => {
    const old = tx("bank", "2026-03-01", 900, { status: "completed", legacy: true });
    const events = timelineOf([old]);
    expect(events[0]).toMatchObject({ legacy: true, legs: [] });
    const series = seriesOf([old], events).get("bank")!;
    expect(series.now).toBe(10000);
    expect(series.points.every((p) => p.balance === 10000)).toBe(true);
  });

  it("keeps a card's charges and a payment's landing off, and the payment on the account it leaves", () => {
    const charge = tx("card", "2026-10-05", 300, { status: "completed" });
    const pay = transfer("bank", "card", "2026-11-15", 300, "planned");
    const events = ledgerEvents([charge, ...pay], buildCardBook(accounts, [charge, ...pay]), byId, today);
    expect(events.map((e) => e.key)).toEqual([pay[0].id]);
    expect(events[0]).toMatchObject({ direction: "expense", legs: [{ accountId: "bank", delta: -300 }] });
  });

  it("lets a landing leg whose other half is gone stand alone", () => {
    const [, landing] = transfer("wise", "bank", "2026-10-03", 100, "completed", 4180);
    const events = timelineOf([landing]);
    expect(events).toHaveLength(1);
    expect(events[0].legs).toEqual([{ accountId: "bank", delta: 4180 }]);
  });
});

describe("balanceSeries", () => {
  const rows = [
    tx("bank", "2026-09-10", 1200, { status: "completed" }),
    tx("bank", "2026-10-01", 5000, { status: "completed", direction: "income" }),
    tx("bank", "2026-10-25", 3000),
    tx("bank", "2026-11-10", 2000, { direction: "income" }),
    ...transfer("bank", "wise", "2026-10-03", 4180, "completed", 100),
  ];
  const events = timelineOf(rows);
  const series = seriesOf(rows, events);

  it("is anchored on computeBalances today, and walks back to what the account opened with", () => {
    const balances = computeBalances(accounts, rows);
    for (const id of ["bank", "wise"]) {
      const s = series.get(id)!;
      expect(s.now).toBe(balances.get(id));
      expect(balanceAt(s.points, today)).toBe(balances.get(id));
      expect(s.points[0].balance).toBe(byId.get(id)!.openingBalance);
    }
    expect(series.get("bank")!.points[0].date).toBe("2026-09-09");
    expect(series.has("card")).toBe(false);
  });

  it("steps on each day money moves, past and planned", () => {
    const points = series.get("bank")!.points;
    expect(points).toEqual([
      { date: "2026-09-09", balance: 10000 },
      { date: "2026-09-10", balance: 8800 },
      { date: "2026-10-01", balance: 13800 },
      { date: "2026-10-03", balance: 9620 },
      { date: today, balance: 9620 },
      { date: "2026-10-25", balance: 6620 },
      { date: "2026-11-10", balance: 8620 },
    ]);
  });

  it("finds the lowest point ahead, and the first day below zero", () => {
    expect(lowestAhead(series.get("bank")!.points, today, "2027-01-19")).toEqual({
      balance: 6620,
      date: "2026-10-25",
      belowZeroOn: null,
    });
    const short = [tx("bank", "2026-10-22", 12000), tx("bank", "2026-10-30", 500), tx("bank", "2026-11-01", 4000, { direction: "income" })];
    const points = seriesOf(short, timelineOf(short)).get("bank")!.points;
    expect(lowestAhead(points, today, "2027-01-19")).toEqual({ balance: -2500, date: "2026-10-30", belowZeroOn: "2026-10-22" });
    // a horizon before the dip doesn't see it
    expect(lowestAhead(points, today, "2026-10-21")).toEqual({ balance: 10000, date: today, belowZeroOn: null });
  });
});

describe("statementEvents", () => {
  const ikea = ["2026-09-15", "2026-10-15", "2026-11-15", "2026-12-15"].map((d, i) =>
    tx("card", d, 1000, { purchaseId: "ikea", status: i < 2 ? "completed" : "planned" })
  );
  const market = tx("card", "2026-10-04", 250, { status: "completed" });

  it("bills each month's charges on the payment day, folding earlier months into this one", () => {
    const rows = [...ikea, market];
    const events = timelineOf(rows).filter((e) => e.kind === "statement");
    expect(events.map((e) => [e.date, e.amount, e.status])).toEqual([
      // September's instalment, paid in October, unpaid by the 15th: overdue
      ["2026-10-15", 1000, "overdue"],
      ["2026-11-15", 1250, "planned"],
      ["2026-12-15", 1000, "planned"],
      ["2027-01-15", 1000, "planned"],
    ]);
    expect(events[0].effectiveDate).toBe(today);
    expect(events[1].legs).toEqual([{ accountId: "bank", delta: -1250 }]);
    expect(events[1].charges?.map((c) => c.id)).toEqual([market.id, ikea[1].id]);
  });

  it("adds up, with the payments not yet made, to the card's schedule", () => {
    const pay = transfer("bank", "card", "2026-12-10", 1250, "planned");
    const rows = [...ikea, market, ...pay];
    const book = buildCardBook(accounts, rows);
    const statements = statementEvents(book, accounts, today, "2027-12");
    const events = ledgerEvents(rows, book, byId, today);
    const unmade = new Map<string, number>();
    for (const e of events) if (e.status !== "completed" && e.tx && book.roleOf(e.tx) === "payment") unmade.set(e.date.slice(0, 7), e.amount);
    const byMonth = new Map<string, number>();
    for (const s of statements) byMonth.set(s.date.slice(0, 7), s.amount);
    for (const [month, total] of unmade) byMonth.set(month, (byMonth.get(month) ?? 0) + total);
    // cardSchedule from the start; the months behind this one fold into it
    const schedule = new Map<string, number>();
    for (const line of cardSchedule(book, "card", "2000-01")) {
      const month = line.month < "2026-10" ? "2026-10" : line.month;
      schedule.set(month, (schedule.get(month) ?? 0) + line.total);
    }
    expect(byMonth).toEqual(schedule);
  });

  it("never doubles a scheduled card payment with the statement it pays", () => {
    // November's payment is already planned: it covers October's charges
    const pay = transfer("bank", "card", "2026-11-15", 1250, "planned");
    const rows = [...ikea, market, ...pay];
    const events = timelineOf(rows);
    const november = events.filter((e) => e.date.startsWith("2026-11"));
    const out = november.flatMap((e) => e.legs).filter((l) => l.accountId === "bank");
    expect(out).toEqual([{ accountId: "bank", delta: -1250 }]);
  });

  it("converts a statement paid from another currency at today's rates, marked approx", () => {
    const usdCard = account("usdcard", { kind: "credit_card", currency: "USD", paymentAccountId: "bank", paymentDay: 20 });
    const rows = [tx("usdcard", "2026-10-02", 10, { status: "completed" })];
    const all = [...accounts, usdCard];
    const book = buildCardBook(all, rows);
    const usdPer = { USD: 1, TRY: 1 / 40, EUR: 1.1, BTC: 100000, XAU_G: 80 };
    const [event] = statementEvents(book, all, today, "2027-12", usdPer);
    expect(event).toMatchObject({ date: "2026-11-20", amount: 10, currency: "USD" });
    expect(event.legs).toEqual([{ accountId: "bank", delta: -400, approx: true }]);
  });

  it("dates a card with no payment day on the 1st, or today for this month", () => {
    const loose = account("loose", { kind: "credit_card", paymentAccountId: "bank" });
    const rows = [tx("loose", "2026-09-02", 100, { status: "completed" }), tx("loose", "2026-10-02", 50, { status: "completed" })];
    const all = [...accounts, loose];
    const events = statementEvents(buildCardBook(all, rows), all, today, "2027-12");
    expect(events.map((e) => [e.date, e.status, e.dateApprox])).toEqual([
      [today, "planned", true],
      ["2026-11-01", "planned", true],
    ]);
  });
});

describe("debtMilestones", () => {
  it("marks when a loan, a taksit and a recurring item end, and what each frees", () => {
    const loan: Loan = {
      id: "car",
      name: "Car loan",
      kind: "car",
      currency: "TRY",
      principal: 120000,
      monthlyRatePct: 2,
      termMonths: 12,
      startDate: "2026-06-01",
      installment: 0,
      scheduleKind: "annuity",
      kkdfPct: 0,
      bsmvPct: 0,
      customInstalments: null,
      recurringTemplateId: "carTpl",
      createdAt: "2026-06-01T00:00:00.000Z",
    };
    const template = (id: string, extra: Partial<RecurringTemplate>): RecurringTemplate => ({
      id,
      name: id,
      accountId: "bank",
      direction: "expense",
      categoryId: null,
      amount: 229,
      frequency: "monthly",
      startDate: "2026-01-05",
      endDate: null,
      autoComplete: false,
      loanId: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      ...extra,
    });
    const purchase: Purchase = {
      id: "phone",
      name: "iPhone",
      accountId: "card",
      amount: 10000,
      purchaseDate: "2026-08-10",
      installmentCount: 3,
      firstDue: "2026-09-10",
      details: "",
      reflected: true,
      categoryId: null,
      createdAt: "2026-08-10T00:00:00.000Z",
    };
    const templates = [
      template("carTpl", { loanId: "car", endDate: "2027-06-01" }),
      template("netflix", { endDate: "2027-03-20" }),
      template("forever", {}),
    ];
    const events = debtMilestones({ loans: [loan], purchases: [purchase], templates, transactions: [], accounts, today });
    const schedule = buildSchedule({
      kind: "annuity",
      principal: 120000,
      monthlyRatePct: 2,
      termMonths: 12,
      startDate: "2026-06-01",
      currency: "TRY",
      kkdfPct: 0,
      bsmvPct: 0,
    });
    expect(events.map((e) => [e.key, e.date, e.status, e.legs.length])).toEqual([
      ["end:loan:car", schedule.rows.at(-1)!.date, "marker", 0],
      ["end:purchase:phone", lastDueDate("2026-09-10", 3), "marker", 0],
      ["end:template:netflix", "2027-03-05", "marker", 0],
    ]);
    expect(events[0].milestone).toMatchObject({ frees: schedule.rows.at(-1)!.payment, count: 12 });
    expect(events[0].accountId).toBe("bank");
    expect(events[1].milestone).toMatchObject({ frees: 3333.34, currency: "TRY", count: 3 });
    expect(events[2].milestone).toMatchObject({ frees: 229, frequency: "monthly", direction: "expense" });
  });
});

describe("buildTimeline", () => {
  it("keeps overdue rows whatever the window, and sorts overdue first on a day", () => {
    const late = tx("bank", "2026-08-01", 10);
    const old = tx("bank", "2026-08-01", 20, { status: "completed" });
    const soon = tx("bank", "2026-10-20", 30);
    const events = buildTimeline(
      { accounts, transactions: [old, soon, late], book: buildCardBook(accounts, [old, soon, late]) },
      { from: "2026-10-01", to: "2026-12-31", today }
    );
    expect(events.map((e) => e.key)).toEqual([late.id, soon.id]);
    const all = timelineOf([old, soon, late]);
    expect(all.map((e) => e.key)).toEqual([late.id, old.id, soon.id]);
  });

  it("lets milestones reach past the horizon, and nothing else", () => {
    const template: RecurringTemplate = {
      id: "gym",
      name: "Gym",
      accountId: "bank",
      direction: "expense",
      categoryId: null,
      amount: 900,
      frequency: "monthly",
      startDate: "2026-01-10",
      endDate: "2029-01-10",
      autoComplete: false,
      loanId: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const far = tx("bank", "2028-05-01", 10);
    const events = timelineOf([far], { templates: [template] }, "2027-10-19");
    expect(events.map((e) => e.key)).toEqual(["end:template:gym"]);
  });

  it("covers what comingUp lists over the next seven days (the demo)", () => {
    const seed = buildDemoSeed();
    const now = todayISO();
    const book = buildCardBook(seed.accounts, seed.transactions);
    const events = buildTimeline(
      { accounts: seed.accounts, transactions: seed.transactions, templates: seed.templates, loans: seed.loans, purchases: seed.purchases, book },
      { to: addDays(now, 7), today: now }
    );
    const items = comingUp({
      transactions: seed.transactions,
      accounts: seed.accounts,
      book,
      today: now,
      days: 7,
      duePayments: findDueCardPayments(seed.accounts, book, now),
      standings: cardStandings(seed.accounts, book, now),
      unpaidVictvsUsd: 0,
      unpaidVictvsCount: 0,
    });
    const ahead = events.filter((e) => e.status === "planned" || e.status === "overdue");
    for (const item of items) {
      if (item.kind === "planned") {
        expect(ahead.find((e) => e.key === item.tx.id)).toMatchObject({ date: item.date, status: item.overdue ? "overdue" : "planned" });
      } else if (item.kind === "card" && item.figure.amount > 0) {
        const statement = ahead.find((e) => e.kind === "statement" && e.cardId === item.account.id);
        expect(statement).toMatchObject({ date: item.date, amount: item.figure.amount });
      }
    }
    // and nothing planned in the window that comingUp leaves out
    const planned = ahead.filter((e) => e.kind === "tx");
    expect(planned.length).toBe(items.filter((i) => i.kind === "planned").length);
  });

  it("covers comingUp's statements over a hand-made card month", () => {
    const rows = [tx("card", "2026-09-20", 700, { status: "completed" }), tx("card", "2026-10-02", 300, { status: "completed" })];
    const near = account("card", { kind: "credit_card", paymentAccountId: "bank", paymentDay: 24 });
    const accts = [bank, wise, near];
    const book = buildCardBook(accts, rows);
    const events = buildTimeline({ accounts: accts, transactions: rows, book }, { to: addDays(today, 7), today });
    const items = comingUp({
      transactions: rows,
      accounts: accts,
      book,
      today,
      days: 7,
      duePayments: findDueCardPayments(accts, book, today),
      standings: cardStandings(accts, book, today),
      unpaidVictvsUsd: 0,
      unpaidVictvsCount: 0,
    });
    const card = items.find((i) => i.kind === "card");
    expect(card).toBeDefined();
    expect(events.find((e) => e.kind === "statement")).toMatchObject({
      date: "2026-10-24",
      amount: card!.kind === "card" ? card!.figure.amount : NaN,
    });
  });
});

describe("expectedVictvsEvents", () => {
  const forecast = {
    earnings: [],
    cash: [
      { month: "2026-10", expected: 157.5, low: 157.5, high: 157.5, earned: 157.5 },
      { month: "2026-11", expected: 650, low: 520, high: 780, earned: 30 },
      { month: "2026-12", expected: 0, low: 0, high: 0, earned: 0 },
    ],
    lagDays: null,
    lagMonths: 1,
    historyMonths: 2,
    unpaid: 187.5,
  };
  const usdPer = { USD: 1, TRY: 1 / 40, EUR: 1.1, BTC: 100000, XAU_G: 80 };

  it("lands mid-month without payouts on record, never before today, and skips empty months", () => {
    const events = expectedVictvsEvents({ forecast, payoutDates: [], accountId: "wise", accounts, today, usdPer });
    expect(events.map((e) => [e.key, e.date, e.status, e.amount])).toEqual([
      // the 15th has passed this month: any day now
      ["victvs:2026-10", today, "expected", 157.5],
      ["victvs:2026-11", "2026-11-15", "expected", 650],
    ]);
    expect(events[1]).toMatchObject({ direction: "income", currency: "USD", accountId: "wise", expected: { low: 520, high: 780, earned: 30 } });
    expect(events[1].legs).toEqual([{ accountId: "wise", delta: 650 }]);
  });

  it("lands on the day payouts usually come, converted into a lira account", () => {
    expect(typicalPayoutDay(["2026-07-08", "2026-08-12", "2026-09-10"])).toBe(10);
    expect(typicalPayoutDay(["2026-07-08", "2026-08-12"])).toBe(10);
    const [, nov] = expectedVictvsEvents({ forecast, payoutDates: ["2026-08-28", "2026-09-30"], accountId: "bank", accounts, today, usdPer });
    expect(nov.date).toBe("2026-11-29");
    expect(nov.legs).toEqual([{ accountId: "bank", delta: 26000, approx: true }]);
    // no deposit account: listed, moving nothing
    expect(expectedVictvsEvents({ forecast, payoutDates: [], accountId: null, accounts, today }).every((e) => e.legs.length === 0)).toBe(true);
  });

  it("never moves a balance or the lowest point unless counted", () => {
    const bill = tx("wise", "2026-11-20", 400);
    const expected = expectedVictvsEvents({ forecast, payoutDates: [], accountId: "wise", accounts, today });
    const events = timelineOf([bill], { expected });
    const plain = balanceSeries({ accounts, transactions: [bill], events, today }).get("wise")!;
    expect(balanceAt(plain.points, "2026-12-31")).toBe(100);
    expect(lowestAhead(plain.points, today, "2027-01-19")).toMatchObject({ balance: 100, date: "2026-11-20" });
    const counted = balanceSeries({ accounts, transactions: [bill], events, today, counts: (e) => e.kind === "expected" }).get("wise")!;
    expect(balanceAt(counted.points, today)).toBe(657.5);
    expect(balanceAt(counted.points, "2026-12-31")).toBe(907.5);
    expect(lowestAhead(counted.points, today, "2027-01-19")).toMatchObject({ balance: 657.5, date: today });
  });
});
