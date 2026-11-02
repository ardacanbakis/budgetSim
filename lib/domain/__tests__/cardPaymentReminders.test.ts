import { describe, expect, it } from "vitest";
import { Account, CardEstimate, Transaction } from "@/lib/data/types";
import { buildCardBook, cardPaymentReminders } from "../cards";

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
const garanti: Account = { ...akbank, id: "garanti", name: "CC Garanti", paymentDay: 10 };
const accounts = [bank, akbank, garanti];

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
const installment = (card: string, date: string, amount: number) => tx(card, date, amount, { purchaseId: "p1" });
function payment(card: string, date: string, amount: number, made: boolean): Transaction[] {
  const group = `g-${card}-${date}`;
  const status = made ? ("completed" as const) : ("planned" as const);
  return [
    tx("bank", date, amount, { transferGroupId: group, status }),
    tx(card, date, amount, { direction: "income", transferGroupId: group, status }),
  ];
}
const estimate = (month: string, amount: number): CardEstimate => ({
  id: `e-${month}`,
  accountId: "akbank",
  month,
  amount,
  notedOn: "2026-10-30",
  createdAt: "2026-10-30T00:00:00.000Z",
});

// the backup's shape: Akbank paid on 15 Oct, a 12-month purchase billed on the 15th, November expected at 35,577.29
const ledger = [
  installment("akbank", "2026-10-15", 11062.43),
  ...payment("akbank", "2026-10-15", 45534.22, true),
  installment("akbank", "2026-11-15", 11062.43),
  installment("akbank", "2026-12-15", 11062.43),
];
const remind = (txs: Transaction[], today: string, estimates: CardEstimate[] = [estimate("2026-11", 35577.29)]) =>
  cardPaymentReminders(accounts, buildCardBook(accounts, txs, estimates), today);

describe("cardPaymentReminders", () => {
  it("says nothing early in the month, though this month's installment isn't paid yet", () => {
    expect(remind(ledger, "2026-11-02")).toEqual([]);
    expect(remind(ledger, "2026-11-14")).toEqual([]);
  });

  it("asks the day before and on the day, for the whole statement, installments included", () => {
    const before = remind(ledger, "2026-11-15");
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({ month: "2026-11", date: "2026-11-16", when: "tomorrow", amount: 35577.29 });
    expect(before[0].charges.map((c) => c.dueDate)).toEqual(["2026-11-15"]);
    expect(remind(ledger, "2026-11-16")[0]).toMatchObject({ when: "today", amount: 35577.29 });
  });

  it("keeps asking once the day has passed with nothing paid, and stops once it's paid", () => {
    expect(remind(ledger, "2026-11-20")[0]).toMatchObject({ when: "overdue", date: "2026-11-16" });
    expect(remind([...ledger, ...payment("akbank", "2026-11-16", 35577.29, true)], "2026-11-20")).toEqual([]);
  });

  it("asks to mark a recorded payment paid once its date comes, and while it isn't", () => {
    const recorded = [...ledger, ...payment("akbank", "2026-11-16", 35000, false)];
    expect(remind(recorded, "2026-11-10")).toEqual([]);
    const late = remind(recorded, "2026-11-18");
    expect(late).toHaveLength(1);
    expect(late[0]).toMatchObject({ when: "overdue", date: "2026-11-16", amount: 35000 });
    expect(late[0].unmade).toHaveLength(1);
  });

  it("dates a charge carried over from a missed statement from that statement's day", () => {
    // October's swipe was due on 16 Oct and never paid: late on 2 Nov, not waiting for 16 Nov
    const missed = [tx("akbank", "2026-09-20", 500, { status: "completed" })];
    expect(remind(missed, "2026-11-02", [])[0]).toMatchObject({ when: "overdue", date: "2026-10-16", amount: 500 });
  });

  it("gives each card its own reminder, soonest first", () => {
    const both = [...ledger, installment("garanti", "2026-10-15", 3188.88)];
    // Garanti's statement is the 10th, so its 15 Oct installment is on November's
    expect(remind(both, "2026-11-09").map((r) => [r.account.id, r.when])).toEqual([["garanti", "tomorrow"]]);
    expect(remind(both, "2026-11-16").map((r) => [r.account.id, r.when])).toEqual([
      ["garanti", "overdue"],
      ["akbank", "today"],
    ]);
  });

  it("leaves retired cards out", () => {
    const retired = accounts.map((a) => (a.id === "akbank" ? { ...a, archived: true } : a));
    expect(cardPaymentReminders(retired, buildCardBook(retired, ledger), "2026-11-16")).toEqual([]);
  });

  it("asks the day before when tomorrow is next month's statement day", () => {
    const first: Account = { ...akbank, paymentDay: 1 };
    const accts = [bank, first];
    const r = cardPaymentReminders(accts, buildCardBook(accts, [tx("akbank", "2026-11-20", 900, { status: "completed" })]), "2026-11-30");
    expect(r[0]).toMatchObject({ month: "2026-12", date: "2026-12-01", when: "tomorrow", amount: 900 });
  });
});
