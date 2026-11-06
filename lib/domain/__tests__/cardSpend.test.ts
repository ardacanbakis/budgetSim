import { describe, expect, it } from "vitest";
import { Account, CardEstimate, Transaction } from "@/lib/data/types";
import { buildCardBook, cardSchedule, estimateTopUps } from "../cards";
import { buildPlanningBook, DEFAULT_CARD_SPEND, normalizeCardSpend, typicalCardSpend, typicalSpendMap } from "../cardSpend";

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
const tx = (accountId: string, dueDate: string, amount: number, o: Partial<Transaction> = {}): Transaction => ({
  id: `t${++n}`,
  accountId,
  direction: "expense",
  categoryId: null,
  amount,
  status: "completed",
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

/** a statement settled from the bank on the card's payment day */
const paid = (cardId: string, date: string, amount: number) => {
  const g = `g${++n}`;
  return [
    tx("bank", date, amount, { transferGroupId: g, description: "statement" }),
    tx(cardId, date, amount, { transferGroupId: g, direction: "income", description: "statement" }),
  ];
};

const bank = account("bank", { name: "EnPara TRY" });
const akbank = account("akbank", { name: "CC Akbank", kind: "credit_card", paymentAccountId: "bank", paymentDay: 16 });
const accounts = [bank, akbank];

// three settled statements, each covering one 11,062.43 taksit; the rest is
// ordinary spending: 34,471.79 · 24,325.61 · 51,937.57
const history = [
  ...paid("akbank", "2026-08-16", 45534.22),
  ...paid("akbank", "2026-09-16", 35388.04),
  ...paid("akbank", "2026-10-16", 63000.0),
  tx("akbank", "2026-08-15", 11062.43, { purchaseId: "akkiz" }),
  tx("akbank", "2026-09-15", 11062.43, { purchaseId: "akkiz" }),
  // imported history: still taksit that sat on that statement
  tx("akbank", "2026-10-15", 11062.43, { purchaseId: "akkiz", legacy: true }),
  // and the tail still to come
  tx("akbank", "2026-12-15", 11062.43, { purchaseId: "akkiz", status: "planned" }),
  tx("akbank", "2027-01-15", 11062.43, { purchaseId: "akkiz", status: "planned" }),
];
const book = buildCardBook(accounts, history);

describe("typicalCardSpend", () => {
  const spend = typicalCardSpend({ card: akbank, book, transactions: history, today });

  it("reads each settled statement less the taksit it covered", () => {
    expect(spend.months.map((m) => [m.month, m.installments, Math.round(m.ordinary * 100) / 100])).toEqual([
      ["2026-10", 11062.43, 51937.57],
      ["2026-09", 11062.43, 24325.61],
      ["2026-08", 11062.43, 34471.79],
    ]);
  });

  it("counts imported history as the taksit it was, not as ordinary spending", () => {
    // October's installment is legacy: left out, ordinary would read 63,000
    expect(spend.months[0].ordinary).toBeCloseTo(51937.57, 2);
  });

  it("takes the median, so one big month doesn't set the figure for half a year", () => {
    expect(spend.measured).toBeCloseTo(34471.79, 2);
    expect(spend.value).toBeCloseTo(34471.79, 2);
  });

  it("reads only as many statements as asked for, newest first", () => {
    const two = typicalCardSpend({ card: akbank, book, transactions: history, today, lookback: 2 });
    expect(two.months.map((m) => m.month)).toEqual(["2026-10", "2026-09"]);
    expect(two.measured).toBeCloseTo((51937.57 + 24325.61) / 2, 2);
  });

  it("lets a figure of your own stand instead, zero included", () => {
    const mine = typicalCardSpend({ card: akbank, book, transactions: history, today, override: 20000 });
    expect(mine.measured).toBeCloseTo(34471.79, 2);
    expect(mine.value).toBe(20000);
    expect(typicalCardSpend({ card: akbank, book, transactions: history, today, override: 0 }).value).toBe(0);
  });

  it("says nothing about a card nothing has been paid on", () => {
    const fresh = account("fresh", { kind: "credit_card", paymentAccountId: "bank", paymentDay: 10 });
    const empty = typicalCardSpend({ card: fresh, book: buildCardBook([bank, fresh], []), transactions: [], today });
    expect(empty.months).toEqual([]);
    expect(empty.measured).toBeNull();
    expect(empty.value).toBe(0);
  });
});

describe("carrying it into the months ahead", () => {
  const settings = { on: true, lookback: 3, overrides: {} };
  const planning = buildPlanningBook({ accounts, transactions: history, settings, today });

  it("changes nothing at all while the setting is off", () => {
    const off = buildPlanningBook({ accounts, transactions: history, settings: DEFAULT_CARD_SPEND, today });
    expect(off.typical("akbank")).toBe(0);
    expect(cardSchedule(off, "akbank", "2026-11")).toEqual(cardSchedule(book, "akbank", "2026-11"));
  });

  it("adds the typical figure to the months the card already bills", () => {
    const plain = new Map(cardSchedule(book, "akbank", "2026-11").map((s) => [s.month, s.total]));
    const with_ = new Map(cardSchedule(planning, "akbank", "2026-11").map((s) => [s.month, s.total]));
    for (const month of ["2026-12", "2027-01"]) {
      expect(with_.get(month)! - plain.get(month)!).toBeCloseTo(34471.79, 2);
    }
  });

  it("reaches months the card doesn't bill at all, but only when given a horizon", () => {
    const bounded = cardSchedule(planning, "akbank", "2026-11").map((s) => s.month);
    expect(bounded).not.toContain("2027-03");
    const reaching = cardSchedule(planning, "akbank", "2026-11", { toMonth: "2027-03" }).map((s) => s.month);
    expect(reaching).toContain("2027-03");
    expect(reaching.at(-1)).toBe("2027-03");
  });

  it("leaves a month whose payment is already recorded alone", () => {
    const withNov = [...history, ...paid("akbank", "2026-11-16", 40000)];
    const b = buildPlanningBook({ accounts, transactions: withNov, settings, today });
    const nov = cardSchedule(b, "akbank", "2026-11").find((s) => s.month === "2026-11");
    // the payment is made, so the month is settled and nothing is added
    expect(nov).toBeUndefined();
  });

  it("sits on top of what you expect, because an expectation is what's committed", () => {
    const estimates: CardEstimate[] = [
      { id: "e1", accountId: "akbank", month: "2026-12", amount: 20000, notedOn: "2026-11-01", createdAt: "2026-11-01T00:00:00.000Z" },
    ];
    const b = buildPlanningBook({ accounts, transactions: history, estimates, settings, today });
    const dec = cardSchedule(b, "akbank", "2026-11").find((s) => s.month === "2026-12")!;
    // max(tracked 11,062.43, expected 20,000) + typical 34,471.79
    expect(dec.total).toBeCloseTo(20000 + 34471.79, 2);
  });

  it("never counts it as owed: a guess about next month is not a debt", () => {
    expect(planning.owed("akbank", today)).toBeCloseTo(book.owed("akbank", today), 2);
  });

  it("can be left out of a schedule that asks about debt rather than spending", () => {
    const committed = cardSchedule(planning, "akbank", "2026-11", { typical: false });
    expect(committed).toEqual(cardSchedule(book, "akbank", "2026-11"));
  });

  it("names the expectation behind a top-up, and null when typical spend alone made it", () => {
    const ups = estimateTopUps(planning, "akbank", "2026-11");
    expect(ups.every((u) => u.estimate === null)).toBe(true);
    expect(ups.every((u) => Math.abs(u.typical - 34471.79) < 0.01)).toBe(true);
  });
});

describe("typicalSpendMap", () => {
  it("is empty while the setting is off, so nothing is computed or changed", () => {
    expect(typicalSpendMap({ accounts, book, transactions: history, today, settings: DEFAULT_CARD_SPEND }).size).toBe(0);
  });

  it("leaves out a card set to zero", () => {
    const settings = { on: true, lookback: 3, overrides: { akbank: 0 } };
    expect(typicalSpendMap({ accounts, book, transactions: history, today, settings }).size).toBe(0);
  });
});

describe("normalizeCardSpend", () => {
  it("reads a stored setting, or nothing, into one with every field sane", () => {
    expect(normalizeCardSpend(null)).toEqual(DEFAULT_CARD_SPEND);
    expect(normalizeCardSpend({ on: true, lookback: 99, overrides: { a: -5, b: 10, c: "x" } })).toEqual({
      on: true,
      lookback: 3,
      overrides: { b: 10 },
    });
  });
});
