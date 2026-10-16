import { afterEach, describe, expect, it, vi } from "vitest";
import { buildDemoSeed } from "@/lib/data/demoSeed";
import { Account, Transaction } from "@/lib/data/types";
import { buildCardBook } from "@/lib/domain/cards";
import { cardStandings, findDueCardPayments } from "@/lib/domain/purchases";
import { todayISO } from "@/lib/domain/recurrence";
import {
  comingUp,
  ComingUpItem,
  daysUntil,
  isLongOverdue,
  LEGACY_AGE_MONTHS,
  overdueCount,
  statementFigure,
} from "../pocket/attention";
import { listedRows } from "../pocket/dayGroups";

const account = (id: string, kind: Account["kind"] = "fiat", extra: Partial<Account> = {}): Account => ({
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

const today = "2026-10-16";
const keys = (items: ComingUpItem[]) => items.map((i) => (i.kind === "planned" ? i.tx.description : i.key));

describe("daysUntil and isLongOverdue", () => {
  it("counts whole calendar days", () => {
    expect(daysUntil("2026-10-16", today)).toBe(0);
    expect(daysUntil("2026-10-17", today)).toBe(1);
    expect(daysUntil("2026-10-14", today)).toBe(-2);
    expect(daysUntil("2026-11-01", today)).toBe(16);
    // across the March clock change, still whole days
    expect(daysUntil("2026-04-01", "2026-03-25")).toBe(7);
  });

  it("calls a planned row long overdue past the Classic legacy age", () => {
    expect(LEGACY_AGE_MONTHS).toBe(3);
    expect(isLongOverdue(tx("bank", "2026-07-15", 1), today)).toBe(true);
    expect(isLongOverdue(tx("bank", "2026-07-16", 1), today)).toBe(false);
    expect(isLongOverdue(tx("bank", "2026-10-01", 1), today)).toBe(false);
    expect(isLongOverdue(tx("bank", "2026-01-01", 1, { status: "completed" }), today)).toBe(false);
  });
});

describe("comingUp", () => {
  const bank = account("bank");
  const card = account("card", "credit_card", { paymentDay: 20 });
  const accounts = [bank, account("wise"), card];

  const dentist = tx("bank", "2026-10-28", 2800, { description: "Dentist" });
  const rent = tx("bank", "2026-10-18", 27500, { description: "Rent" });
  const lateBill = tx("bank", "2026-10-10", 600, { description: "Late bill" });
  const olderBill = tx("bank", "2026-09-30", 400, { description: "Older bill" });
  const dueToday = tx("bank", today, 100, { description: "Today" });
  const farAway = tx("bank", "2026-12-01", 100, { description: "December" });
  const done = tx("bank", "2026-10-17", 100, { description: "Done", status: "completed" });
  const charge = tx("card", "2026-10-18", 900, { description: "Card charge" });
  const fxOut = tx("wise", "2026-10-19", 500, { transferGroupId: "g1", description: "Transfer out" });
  const fxIn = tx("bank", "2026-10-19", 20000, { transferGroupId: "g1", direction: "income", description: "Transfer in" });
  const orphan = tx("gone", "2026-10-17", 1, { description: "Orphan" });
  const transactions = [dentist, rent, lateBill, olderBill, dueToday, farAway, done, charge, fxOut, fxIn, orphan];
  const book = buildCardBook(accounts, transactions);

  const run = (extra: Partial<Parameters<typeof comingUp>[0]> = {}) =>
    comingUp({
      transactions,
      accounts,
      book,
      today,
      days: 7,
      duePayments: [],
      standings: [],
      unpaidVictvsUsd: 0,
      unpaidVictvsCount: 0,
      ...extra,
    });

  it("puts overdue rows first, then the next days in date order", () => {
    const items = run();
    expect(keys(items)).toEqual(["Older bill", "Late bill", "Today", "Rent", "Transfer out"]);
    expect(items.slice(0, 2).every((i) => i.kind === "planned" && i.overdue)).toBe(true);
    expect(items.slice(2).every((i) => i.kind === "planned" && !i.overdue)).toBe(true);
  });

  it("leaves out card charges, completed rows, rows beyond the window and unknown accounts; a transfer once", () => {
    const listed = keys(run());
    expect(listed).not.toContain("Card charge");
    expect(listed).not.toContain("Done");
    expect(listed).not.toContain("December");
    expect(listed).not.toContain("Dentist");
    expect(listed).not.toContain("Orphan");
    expect(listed.filter((k) => k.startsWith("Transfer"))).toEqual(["Transfer out"]);
    expect(keys(run({ days: 30 }))).toContain("Dentist");
  });

  it("adds a card whose statement is due within the window, and VICTVS last", () => {
    const standings = cardStandings(accounts, book, today);
    const items = run({ standings, unpaidVictvsUsd: 187.5, unpaidVictvsCount: 5 });
    expect(keys(items)).toEqual(["Older bill", "Late bill", "Today", "Rent", "Transfer out", "card:card", "victvs"]);
    const cardItem = items.find((i) => i.kind === "card")!;
    expect(cardItem.kind === "card" && cardItem.date).toBe("2026-10-20");
    const last = items.at(-1)!;
    expect(last.kind === "victvs" && last.amountUsd).toBe(187.5);
  });

  it("keeps a statement whose payment day passed unpaid, as overdue", () => {
    const due = account("due", "credit_card", { paymentDay: 15 });
    const ledger = [tx("due", "2026-09-12", 1200, { status: "completed", description: "September groceries" })];
    const all = [bank, due];
    const b = buildCardBook(all, ledger);
    const standings = cardStandings(all, b, today);
    const duePayments = findDueCardPayments(all, b, today);
    // the 15th is behind us, so the forward-looking countdown alone would miss it
    expect(standings[0].daysToDue).toBeGreaterThan(7);
    const items = comingUp({
      transactions: ledger,
      accounts: all,
      book: b,
      today,
      days: 7,
      duePayments,
      standings,
      unpaidVictvsUsd: 0,
      unpaidVictvsCount: 0,
    });
    expect(items).toHaveLength(1);
    const item = items[0];
    expect(item.kind).toBe("card");
    if (item.kind !== "card") return;
    expect(item.overdue).toBe(true);
    expect(item.date).toBe("2026-10-15");
    expect(item.figure.amount).toBe(1200);
  });

  it("dates a statement with no payment day today", () => {
    const loose = account("loose", "credit_card");
    const ledger = [tx("loose", "2026-09-12", 300, { status: "completed" })];
    const all = [loose];
    const b = buildCardBook(all, ledger);
    const items = comingUp({
      transactions: ledger,
      accounts: all,
      book: b,
      today,
      days: 7,
      duePayments: findDueCardPayments(all, b, today),
      standings: cardStandings(all, b, today),
      unpaidVictvsUsd: 0,
      unpaidVictvsCount: 0,
    });
    expect(items.map((i) => i.kind === "card" && i.date)).toEqual([today]);
  });
});

describe("overdueCount", () => {
  it("counts planned rows past their date, a transfer once", () => {
    const accounts = [account("bank"), account("wise")];
    const rows = [
      tx("bank", "2026-10-01", 1),
      tx("bank", "2026-10-15", 1),
      tx("bank", today, 1),
      tx("bank", "2026-10-02", 1, { status: "completed" }),
      tx("wise", "2026-10-03", 1, { transferGroupId: "g" }),
      tx("bank", "2026-10-03", 1, { transferGroupId: "g", direction: "income" }),
    ];
    const book = buildCardBook(accounts, rows);
    expect(overdueCount(listedRows(rows, book), today)).toBe(3);
  });
});

describe("statementFigure", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("matches the demo's Bonus Card: the suggested payment, and everything owed", () => {
    vi.useFakeTimers({ now: new Date(2026, 9, 16, 12, 0, 0) });
    const seed = buildDemoSeed();
    const day = todayISO();
    expect(day).toBe("2026-10-16");
    const book = buildCardBook(seed.accounts, seed.transactions);
    const bonus = seed.accounts.find((a) => a.name === "Bonus Card")!;
    const due = findDueCardPayments(seed.accounts, book, day);
    const figure = statementFigure(bonus, book, day, due);
    expect(figure.amount).toBe(due.find((d) => d.account.id === bonus.id)!.suggestedAmount);
    expect(figure.amount).toBeCloseTo(20220.3, 6);
    expect(figure.totalOwed).toBe(book.owed(bonus.id, day));
    expect(figure.totalOwed).toBeCloseTo(90220.3, 6);
    // October's statement, then one installment a month through March
    expect(figure.monthsToGo).toBe(6);
  });

  it("agrees with findDueCardPayments and book.owed on the demo, whatever today is", () => {
    const seed = buildDemoSeed();
    const day = todayISO();
    const book = buildCardBook(seed.accounts, seed.transactions);
    const bonus = seed.accounts.find((a) => a.name === "Bonus Card")!;
    const due = findDueCardPayments(seed.accounts, book, day);
    const figure = statementFigure(bonus, book, day, due);
    const suggestion = due.find((d) => d.account.id === bonus.id);
    if (suggestion) expect(figure.amount).toBe(suggestion.suggestedAmount);
    expect(figure.totalOwed).toBe(book.owed(bonus.id, day));
  });

  it("falls back to this month's line of the schedule once a payment is recorded, else 0", () => {
    const card = account("card", "credit_card", { paymentDay: 20 });
    const bank = account("bank");
    const accounts = [bank, card];
    const ledger = [
      tx("card", "2026-09-10", 1000, { status: "completed" }),
      tx("card", "2026-10-02", 250, { status: "completed" }),
      // October's payment, recorded but not made yet
      tx("bank", "2026-10-20", 1000, { transferGroupId: "pay" }),
      tx("card", "2026-10-20", 1000, { transferGroupId: "pay", direction: "income" }),
    ];
    const book = buildCardBook(accounts, ledger);
    const due = findDueCardPayments(accounts, book, today);
    expect(due).toEqual([]);
    const figure = statementFigure(card, book, today, due);
    expect(figure.amount).toBe(1000);
    expect(figure.totalOwed).toBe(book.owed("card", today));
    // October's payment, then November's for the charge from the 2nd
    expect(figure.monthsToGo).toBe(2);

    const idle = account("idle", "credit_card");
    const idleBook = buildCardBook([idle], []);
    expect(statementFigure(idle, idleBook, today, [])).toEqual({ amount: 0, totalOwed: 0, monthsToGo: 0 });
  });
});
