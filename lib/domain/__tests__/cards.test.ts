import { describe, expect, it } from "vitest";
import { Account, Transaction } from "@/lib/data/types";
import { buildCardBook, cardSchedule, isIncome, isSpending, totalOwed } from "../cards";

const account = (id: string, kind: Account["kind"] = "fiat"): Account => ({
  id,
  name: id,
  currency: "TRY",
  kind,
  openingBalance: 0,
  archived: false,
  paymentAccountId: null,
  paymentDay: null,
  creditLimit: null,
  createdAt: "2026-01-01T00:00:00.000Z",
});

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

/** Both legs of a payment from the bank into a card. */
function payment(cardId: string, date: string, amount: number, made: boolean): Transaction[] {
  const group = `g-${cardId}-${date}`;
  const status = made ? ("completed" as const) : ("planned" as const);
  return [
    tx("bank", date, amount, { direction: "expense", transferGroupId: group, status, description: `${cardId} statement` }),
    tx(cardId, date, amount, { direction: "income", transferGroupId: group, status }),
  ];
}

const accounts = [account("bank"), account("savings"), account("garanti", "credit_card"), account("enpara", "credit_card"), account("akbank", "credit_card")];

// Ikea Izmir on Garanti: 5 × 3,188.88 from Sep 15
const ikea = ["2026-09-15", "2026-10-15", "2026-11-15", "2026-12-15", "2027-01-15"].map((d, i) =>
  tx("garanti", d, 3188.88, { purchaseId: "ikea", status: i === 0 ? "completed" : "planned", description: `Ikea Izmir (${i + 1}/5)` })
);
// a recurring item billed to Akbank every month
const semos = ["2026-10-15", "2026-11-15", "2026-12-15"].map((d) =>
  tx("akbank", d, 11062.43, { recurringTemplateId: "semos", description: "Semoş AkKız" })
);
const salary = tx("bank", "2026-10-05", 2090, { direction: "income", status: "completed" });
const rent = tx("bank", "2026-10-10", 27500);
const toSavings = [
  tx("bank", "2026-10-02", 1000, { transferGroupId: "move", status: "completed" }),
  tx("savings", "2026-10-02", 1000, { transferGroupId: "move", direction: "income", status: "completed" }),
];

const ledger = [
  ...payment("garanti", "2026-08-06", 8974.79, true),
  ...ikea,
  ...payment("enpara", "2026-10-16", 10019.54, false),
  ...payment("akbank", "2026-10-15", 45534.22, false),
  ...semos,
  salary,
  rent,
  ...toSavings,
];
const TODAY = "2026-10-07";

describe("what each row is", () => {
  const book = buildCardBook(accounts, ledger);
  const akbankPayment = book.payments("akbank")[0];

  it("tells a card payment, its card side, a charge and everything else apart", () => {
    expect(book.roleOf(akbankPayment.paying)).toBe("payment");
    expect(book.roleOf(akbankPayment.landing)).toBe("cardSide");
    expect(book.roleOf(ikea[1])).toBe("charge");
    expect(book.roleOf(semos[0])).toBe("charge");
    expect(book.roleOf(rent)).toBe("regular");
    expect(book.roleOf(toSavings[0])).toBe("transfer");
  });

  it("counts the payment as spending, never the charges it covers", () => {
    expect(isSpending(akbankPayment.paying, book)).toBe(true);
    expect(isSpending(akbankPayment.landing, book)).toBe(false);
    expect(isSpending(ikea[1], book)).toBe(false);
    expect(isSpending(semos[0], book)).toBe(false);
    expect(isSpending(rent, book)).toBe(true);
    expect(isSpending(toSavings[0], book)).toBe(false);
  });

  it("counts only ordinary income as income", () => {
    expect(isIncome(salary, book)).toBe(true);
    expect(isIncome(akbankPayment.landing, book)).toBe(false);
    expect(isIncome(toSavings[1], book)).toBe(false);
  });
});

describe("which payment pays a charge", () => {
  it("a payment covers the charges dated before its month", () => {
    const book = buildCardBook(accounts, [...ledger, ...payment("garanti", "2026-10-10", 3188.88, false)]);
    expect(book.coverOf(ikea[0])?.date).toBe("2026-10-10");
    // charged on the 15th: on the next statement, not this one
    expect(book.coverOf(ikea[1])).toBeNull();
  });

  it("a charge is paid once its covering payment is made, with nothing ticked by hand", () => {
    const planned = buildCardBook(accounts, [...ledger, ...payment("garanti", "2026-10-10", 3188.88, false)]);
    expect(planned.isPaid(ikea[0])).toBe(false);
    const made = buildCardBook(accounts, [...ledger, ...payment("garanti", "2026-10-10", 3188.88, true)]);
    expect(made.isPaid(ikea[0])).toBe(true);
    expect(made.isPaid(ikea[1])).toBe(false);
  });

  it("an earlier payment doesn't cover later charges", () => {
    const book = buildCardBook(accounts, ledger);
    // the Aug 6 payment paid a statement from before the Ikea purchase
    expect(book.coverOf(ikea[0])).toBeNull();
    expect(book.isPaid(ikea[0])).toBe(false);
  });

  it("a charge with no payment yet is paid the month after it", () => {
    const book = buildCardBook(accounts, ledger);
    expect(book.paidInMonth(ikea[1])).toBe("2026-11");
    expect(book.paidInMonth(ikea[4])).toBe("2027-02");
  });
});

describe("what a card is owed", () => {
  it("a recorded payment not yet made is owed", () => {
    // CC EnPara: ₺50,000 limit, ₺10,019.54 statement to pay on the 16th
    expect(buildCardBook(accounts, ledger).owed("enpara", TODAY)).toBeCloseTo(10019.54, 2);
  });

  it("once it's made, nothing is", () => {
    const paid = ledger.map((t) => (t.transferGroupId === "g-enpara-2026-10-16" ? { ...t, status: "completed" as const } : t));
    expect(buildCardBook(accounts, paid).owed("enpara", TODAY)).toBe(0);
  });

  it("every installment of a big purchase is held until a payment covers it", () => {
    // all five: September's isn't paid until October's statement is
    expect(buildCardBook(accounts, ledger).owed("garanti", TODAY)).toBeCloseTo(15944.4, 2);
    const octoberPaid = buildCardBook(accounts, [...ledger, ...payment("garanti", "2026-10-10", 3188.88, true)]);
    expect(octoberPaid.owed("garanti", TODAY)).toBeCloseTo(12755.52, 2);
  });

  it("a recurring item billed to the card isn't owed before its date", () => {
    const book = buildCardBook(accounts, ledger);
    expect(book.owed("akbank", TODAY)).toBeCloseTo(45534.22, 2);
    expect(book.owed("akbank", "2026-10-15")).toBeCloseTo(45534.22 + 11062.43, 2);
  });

  it("history from before tracking is left out, and a refund comes off", () => {
    const old = tx("enpara", "2026-05-01", 500, { status: "completed", legacy: true });
    const refund = tx("enpara", "2026-10-03", 120, { direction: "income", status: "completed" });
    const book = buildCardBook(accounts, [...ledger, old, refund]);
    expect(book.charges("enpara")).not.toContain(old);
    expect(book.owed("enpara", TODAY)).toBeCloseTo(10019.54 - 120, 2);
  });
});

describe("a card's bills by month", () => {
  it("shows a recorded payment in its month and uncovered charges in the month they'll be paid", () => {
    const book = buildCardBook(accounts, ledger);
    // Garanti: no October payment recorded, so September's installment
    // lands in October with the rest following a month behind each charge
    expect(cardSchedule(book, "garanti", "2026-10").map((m) => [m.month, Math.round(m.total * 100) / 100])).toEqual([
      ["2026-10", 3188.88],
      ["2026-11", 3188.88],
      ["2026-12", 3188.88],
      ["2027-01", 3188.88],
      ["2027-02", 3188.88],
    ]);
    // Akbank: October's statement, then the recurring item a month behind
    expect(cardSchedule(book, "akbank", "2026-10").map((m) => m.month)).toEqual(["2026-10", "2026-11", "2026-12", "2027-01"]);
  });

  it("adds up what every card is owed, in the display currency", () => {
    const book = buildCardBook(accounts, ledger);
    const rates = { USD: 1, TRY: 1 / 49.18, EUR: 1.13, BTC: 85000, XAU_G: 134 };
    expect(totalOwed(book, accounts, TODAY, rates, "TRY")).toBeCloseTo(15944.4 + 10019.54 + 45534.22, 1);
  });
});
