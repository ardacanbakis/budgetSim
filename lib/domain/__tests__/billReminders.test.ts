import { describe, expect, it } from "vitest";
import { Account, Transaction } from "@/lib/data/types";
import { buildCardBook } from "../cards";
import { billReminders } from "../reminders";

const bank: Account = {
  id: "bank",
  name: "EnPara TRY",
  currency: "TRY",
  kind: "fiat",
  openingBalance: 0,
  archived: false,
  paymentAccountId: null,
  paymentDay: null,
  creditLimit: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};
const card: Account = { ...bank, id: "card", name: "CC Akbank", kind: "credit_card", paymentDay: 16 };
const accounts = [bank, card];

let seq = 0;
const tx = (accountId: string, dueDate: string, overrides: Partial<Transaction> = {}): Transaction => ({
  id: `t${++seq}`,
  accountId,
  direction: "expense",
  categoryId: null,
  amount: 10000,
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
});
const remind = (txs: Transaction[], today: string) => billReminders(txs, accounts, buildCardBook(accounts, txs), today);

describe("billReminders", () => {
  it("brings up a loan installment the day before, on the day, and while it's late", () => {
    const qnb = tx("bank", "2026-11-02", { loanId: "qnb", description: "Semoş QNB 30k" });
    expect(remind([qnb], "2026-10-31")).toEqual([]);
    expect(remind([qnb], "2026-11-01").map((r) => r.when)).toEqual(["tomorrow"]);
    expect(remind([qnb], "2026-11-02").map((r) => r.when)).toEqual(["today"]);
    expect(remind([qnb], "2026-11-05").map((r) => r.when)).toEqual(["overdue"]);
    expect(remind([{ ...qnb, status: "completed" }], "2026-11-02")).toEqual([]);
  });

  it("leaves out income, card charges, card payments and transfers", () => {
    const rows = [
      tx("bank", "2026-11-02", { direction: "income" }),
      tx("card", "2026-11-02", { purchaseId: "p" }),
      tx("bank", "2026-11-02", { transferGroupId: "pay" }),
      tx("card", "2026-11-02", { direction: "income", transferGroupId: "pay" }),
    ];
    expect(remind(rows, "2026-11-02")).toEqual([]);
  });

  it("puts the oldest first", () => {
    const rows = [tx("bank", "2026-11-03"), tx("bank", "2026-11-02"), tx("bank", "2026-10-30")];
    expect(remind(rows, "2026-11-02").map((r) => [r.tx.dueDate, r.when])).toEqual([
      ["2026-10-30", "overdue"],
      ["2026-11-02", "today"],
      ["2026-11-03", "tomorrow"],
    ]);
  });
});
