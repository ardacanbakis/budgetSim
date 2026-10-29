import { describe, expect, it } from "vitest";
import { Account, Transaction } from "@/lib/data/types";
import { buildCardBook, cardSchedule, cardStatements, guessCardFor, isIncome, isSpending, totalOwed } from "../cards";

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
  it("a payment covers installments due in its month, and swipes from before it", () => {
    const book = buildCardBook(accounts, [...ledger, ...payment("garanti", "2026-10-10", 3188.88, false)]);
    // no September payment: September's installment waits for October's
    expect(book.coverOf(ikea[0])?.date).toBe("2026-10-10");
    // an installment's date is the statement it's paid with, even when the
    // payment day (the 10th) comes before the date entered (the 15th)
    expect(book.coverOf(ikea[1])?.date).toBe("2026-10-10");
    expect(book.coverOf(ikea[2])).toBeNull();
    // a recurring charge on the 15th is a swipe: the next statement pays it
    const akbank = buildCardBook(accounts, ledger);
    expect(akbank.coverOf(semos[0])).toBeNull();
  });

  it("a charge is paid once its covering payment is made, with nothing ticked by hand", () => {
    const planned = buildCardBook(accounts, [...ledger, ...payment("garanti", "2026-10-10", 3188.88, false)]);
    expect(planned.isPaid(ikea[0])).toBe(false);
    const made = buildCardBook(accounts, [...ledger, ...payment("garanti", "2026-10-10", 3188.88, true)]);
    expect(made.isPaid(ikea[0])).toBe(true);
    expect(made.isPaid(ikea[1])).toBe(true);
    expect(made.isPaid(ikea[2])).toBe(false);
  });

  it("an earlier payment doesn't cover later charges", () => {
    const book = buildCardBook(accounts, ledger);
    // the Aug 6 payment paid a statement from before the Ikea purchase
    expect(book.coverOf(ikea[0])).toBeNull();
    expect(book.isPaid(ikea[0])).toBe(false);
  });

  it("with no payment yet, an installment is paid in its own month and a swipe the month after", () => {
    const book = buildCardBook(accounts, ledger);
    expect(book.paidInMonth(ikea[1])).toBe("2026-10");
    expect(book.paidInMonth(ikea[4])).toBe("2027-01");
    expect(book.paidInMonth(semos[0])).toBe("2026-11");
  });

  it("knows what a payment made this month would cover", () => {
    const book = buildCardBook(accounts, ledger);
    // Garanti in October: September's and October's installments
    expect(book.wouldCover("garanti", "2026-10")).toEqual([ikea[0], ikea[1]]);
    // Akbank in October: not the swipe on Oct 15, that's November's statement
    expect(book.wouldCover("akbank", "2026-10")).toEqual([]);
    expect(book.wouldCover("akbank", "2026-11")).toEqual([semos[0]]);
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
    // October's payment pays September's and October's installments
    const octoberPaid = buildCardBook(accounts, [...ledger, ...payment("garanti", "2026-10-10", 3188.88, true)]);
    expect(octoberPaid.owed("garanti", TODAY)).toBeCloseTo(9566.64, 2);
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
    // Garanti: nothing paid since August, so September's overdue installment
    // is folded into October with October's own; the rest in their months
    expect(cardSchedule(book, "garanti", "2026-10").map((m) => [m.month, Math.round(m.total * 100) / 100])).toEqual([
      ["2026-10", 6377.76],
      ["2026-11", 3188.88],
      ["2026-12", 3188.88],
      ["2027-01", 3188.88],
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

describe("guessCardFor", () => {
  const cards = [
    { ...account("a", "credit_card"), name: "CC Akbank" },
    { ...account("ta", "credit_card"), name: "CC Tansu Akbank" },
    { ...account("e", "credit_card"), name: "CC EnPara" },
    { ...account("s", "credit_card"), name: "CC Semoş İş Bankası" },
  ];

  it("finds the card a draft statement names", () => {
    expect(guessCardFor("draft November - Akbank ", cards)?.name).toBe("CC Akbank");
    expect(guessCardFor("draft December - EnPara", cards)?.name).toBe("CC EnPara");
    expect(guessCardFor("draft December - Semoş CC", cards)?.name).toBe("CC Semoş İş Bankası");
    expect(guessCardFor("draft November - Semoş İş", cards)?.name).toBe("CC Semoş İş Bankası");
    expect(guessCardFor("Tansu Akbank statement", cards)?.name).toBe("CC Tansu Akbank");
  });

  it("names nothing when no card is mentioned", () => {
    expect(guessCardFor("Rent", cards)).toBeNull();
    expect(guessCardFor("CC payment", cards)).toBeNull();
  });
});

describe("an installment is paid with the first statement due on or after it", () => {
  const withDay = (id: string, day: number) => ({ ...account(id, "credit_card"), paymentDay: day });
  const cards = [account("bank"), withDay("akbank", 16), withDay("garanti", 10), withDay("yapikredi", 17)];
  // Semoş AkKız on Akbank, due the 15th; Akbank pays on the 16th
  const akkiz = ["2026-10-15", "2026-11-15"].map((d, i) => tx("akbank", d, 11062.43, { purchaseId: "akkiz", description: `AkKız (${i + 2}/12)` }));
  // Ikea on Garanti, due the 15th; Garanti pays on the 10th
  const ikea = ["2026-10-15", "2026-11-15"].map((d, i) => tx("garanti", d, 3188.88, { purchaseId: "ikea", description: `Ikea (${i + 2}/5)` }));
  // 25k Coverup on Yapikredi, due the 16th; Yapikredi pays on the 17th
  const coverup = tx("yapikredi", "2026-11-16", 9147.78, { purchaseId: "coverup" });

  it("is paid in its own month when the payment day is on or after its date", () => {
    const book = buildCardBook(cards, [...akkiz, ...payment("akbank", "2026-10-15", 45534.22, true), coverup]);
    // even a payment made a day early pays that month's statement
    expect(book.coverOf(akkiz[0])?.date).toBe("2026-10-15");
    expect(book.isPaid(akkiz[0])).toBe(true);
    expect(book.coverOf(akkiz[1])).toBeNull();
    expect(book.paidInMonth(akkiz[1])).toBe("2026-11");
    expect(book.paidInMonth(coverup)).toBe("2026-11");
  });

  it("waits for the next statement when the payment day comes before its date", () => {
    const book = buildCardBook(cards, [...ikea, ...payment("garanti", "2026-10-10", 16134.5, true)]);
    expect(book.coverOf(ikea[0])).toBeNull();
    expect(book.paidInMonth(ikea[0])).toBe("2026-11");
    expect(book.wouldCover("garanti", "2026-11")).toEqual([ikea[0]]);
  });
});

describe("cardStatements", () => {
  const akbank = { ...account("akbank", "credit_card"), paymentDay: 16 };
  const all = [account("bank"), akbank];
  const own = (d: string, n: number) => tx("akbank", d, 11062.43, { purchaseId: "akkiz", description: `AkKız (${n}/12)` });
  const swipe = tx("akbank", "2026-10-03", 500, { status: "completed", description: "Market" });

  it("says what each payment paid for, and what each month ahead will charge, newest first", () => {
    const rows = [
      own("2026-09-15", 1),
      own("2026-10-15", 2),
      own("2026-11-15", 3),
      swipe,
      ...payment("akbank", "2026-09-16", 11062.43, true),
      ...payment("akbank", "2026-10-15", 11062.43, true),
    ];
    const book = buildCardBook(all, rows);
    const statements = cardStatements(book, akbank, "2026-10-28");
    expect(statements.map((s) => [s.month, s.status, Math.round(s.amount * 100) / 100, s.charges.map((c) => c.description)])).toEqual([
      // November: its installment and October's swipe, nothing recorded yet
      ["2026-11", "upcoming", 11562.43, ["Market", "AkKız (3/12)"]],
      ["2026-10", "paid", 11062.43, ["AkKız (2/12)"]],
      ["2026-09", "paid", 11062.43, ["AkKız (1/12)"]],
    ]);
    expect(statements[0].date).toBe("2026-11-16");
    expect(statements[1].date).toBe("2026-10-15");
  });

  it("folds what's late into this month, due", () => {
    const book = buildCardBook(all, [own("2026-09-15", 1)]);
    expect(cardStatements(book, akbank, "2026-10-28").map((s) => [s.month, s.status])).toEqual([["2026-10", "due"]]);
  });
});
