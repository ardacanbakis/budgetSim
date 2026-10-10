import { describe, expect, it } from "vitest";
import { buildCardBook } from "../cards";
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

const bank: Account = { ...card(), id: "bank", name: "EnPara TRY", kind: "fiat", paymentDay: null, creditLimit: null };

/** both legs of a payment from the bank into the card */
const pay = (date: string, amount: number, made: boolean): Transaction[] => {
  const status = made ? ("completed" as const) : ("planned" as const);
  return [
    tx({ accountId: "bank", dueDate: date, amount, status, transferGroupId: `g-${date}` }),
    tx({ accountId: "card", dueDate: date, amount, status, direction: "income", transferGroupId: `g-${date}` }),
  ];
};

const standing = (accounts: Account[], transactions: Transaction[], today: string) =>
  cardStandings(accounts, buildCardBook(accounts, transactions), today)[0];

describe("cardStandings", () => {
  it("counts a recorded payment not yet made against the limit, and frees it once made", () => {
    // CC EnPara: ₺50,000 limit, this month's ₺10,019.54 statement recorded for the 16th
    const limited = card({ creditLimit: 50_000 });
    const planned = standing([limited, bank], pay("2026-10-16", 10_019.54, false), "2026-10-07");
    expect(planned.owed).toBeCloseTo(10_019.54, 2);
    expect(planned.available).toBeCloseTo(39_980.46, 2);
    expect(planned.paidThisMonth).toBe(true);

    const made = standing([limited, bank], pay("2026-10-16", 10_019.54, true), "2026-10-20");
    expect(made.owed).toBe(0);
    expect(made.available).toBe(50_000);
  });

  it("never reports more room than the limit because of a payment", () => {
    const s = standing([card({ creditLimit: 50_000 }), bank], [...pay("2026-10-16", 10_019.54, false), ...pay("2026-11-16", 8_704.84, false)], "2026-10-07");
    expect(s.available).toBeLessThanOrEqual(50_000);
  });

  it("holds every installment of a big purchase against the limit", () => {
    const installments = [1, 2, 3].map((n) => tx({ amount: 5_000, purchaseId: "p", dueDate: `2026-1${n - 1}-05`, status: "planned" }));
    const s = standing([card(), bank], installments, "2026-10-07");
    expect(s.owed).toBe(15_000);
    expect(s.available).toBe(85_000);
    expect(s.daysToDue).toBe(9);
    expect(s.idle).toBe(false);
  });

  it("says nothing about a limit that was never set", () => {
    expect(standing([card({ creditLimit: null }), bank], [], "2026-08-10").available).toBe(null);
  });

  it("knows a card with nothing owed and nothing coming is idle", () => {
    expect(standing([card(), bank], [], "2026-08-10").idle).toBe(true);
  });
});

describe("cardsDueSoon", () => {
  const due = (days: number, paidThisMonth = false) =>
    ({ daysToDue: days, paidThisMonth }) as ReturnType<typeof cardStandings>[number];

  it("nudges once the day is close and no payment is recorded, soonest first", () => {
    expect(cardsDueSoon([due(4), due(1)]).map((s) => s.daysToDue)).toEqual([1, 4]);
  });

  it("stays quiet when the day is far off or this month's payment is recorded", () => {
    expect(cardsDueSoon([due(9)])).toEqual([]);
    expect(cardsDueSoon([due(1, true)])).toEqual([]);
  });
});
