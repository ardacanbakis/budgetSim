import { describe, expect, it } from "vitest";
import { cardsDueSoon, cardStandings, daysUntilPaymentDay } from "../purchases";
import type { Account, Transaction } from "@/lib/data/types";

const card = (over: Partial<Account> = {}): Account => ({
  id: "card",
  name: "Akbank",
  currency: "TRY",
  kind: "credit_card",
  openingBalance: 0,
  archived: false,
  paymentAccountId: null,
  paymentDay: 16,
  creditLimit: 100_000,
  createdAt: "2026-01-01T00:00:00Z",
  ...over,
});

const tx = (over: Partial<Transaction>): Transaction => ({
  id: Math.random().toString(36).slice(2),
  accountId: "card",
  direction: "expense",
  categoryId: null,
  amount: 0,
  status: "planned",
  dueDate: "2026-09-01",
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
  createdAt: "2026-01-01T00:00:00Z",
  ...over,
});

describe("daysUntilPaymentDay", () => {
  it("counts to this month's day when it hasn't passed", () => {
    expect(daysUntilPaymentDay(16, "2026-08-10")).toBe(6);
    expect(daysUntilPaymentDay(16, "2026-08-16")).toBe(0);
  });

  it("rolls to next month once it has", () => {
    expect(daysUntilPaymentDay(16, "2026-08-20")).toBe(27);
  });

  it("clamps a 31st to the length of a short month", () => {
    expect(daysUntilPaymentDay(31, "2026-09-01")).toBe(29); // September has 30
  });
});

describe("cardStandings", () => {
  const balances = new Map([["card", -30_000]]);

  it("counts what's owed and what's still coming against the limit", () => {
    const [s] = cardStandings(
      [card()],
      balances,
      [tx({ amount: 20_000 }), tx({ amount: 5_000 })],
      "2026-08-10"
    );
    expect(s.postedDebt).toBe(30_000);
    expect(s.scheduled).toBe(25_000);
    // ₺100k limit, ₺55k committed
    expect(s.available).toBe(45_000);
    expect(s.daysToDue).toBe(6);
    expect(s.idle).toBe(false);
  });

  it("gives back the room a scheduled payment will free", () => {
    const [s] = cardStandings(
      [card()],
      balances,
      [tx({ direction: "income", amount: 30_000, transferGroupId: "g1" })],
      "2026-08-10"
    );
    expect(s.scheduledPayments).toBe(30_000);
    expect(s.available).toBe(100_000);
  });

  it("says nothing about a limit that was never set", () => {
    const [s] = cardStandings([card({ creditLimit: null })], balances, [], "2026-08-10");
    expect(s.available).toBe(null);
  });

  it("knows a card with nothing owed and nothing coming is idle", () => {
    const [s] = cardStandings([card()], new Map(), [], "2026-08-10");
    expect(s.idle).toBe(true);
  });
});

describe("cardsDueSoon", () => {
  const standings = (days: number, debt: number) =>
    [{ daysToDue: days, postedDebt: debt } as ReturnType<typeof cardStandings>[number]];

  it("nudges once the day is close, soonest first", () => {
    const list = [...standings(4, 100), ...standings(1, 200)];
    expect(cardsDueSoon(list).map((s) => s.daysToDue)).toEqual([1, 4]);
  });

  it("stays quiet when the day is far off or nothing is owed", () => {
    expect(cardsDueSoon(standings(9, 5_000))).toEqual([]);
    expect(cardsDueSoon(standings(1, 0))).toEqual([]);
  });
});
