import { describe, expect, it } from "vitest";
import { Account, Transaction } from "@/lib/data/types";
import { buildCardBook, CardBook, isIncome, isSpending } from "@/lib/domain/cards";
import { Currency } from "@/lib/domain/currencies";
import { convert, UsdPerMap } from "@/lib/domain/fx";
import {
  dayLabel,
  groupMonthsDays,
  isTransferLanding,
  listedRows,
  monthLabel,
  transferCounterparts,
} from "../pocket/dayGroups";

const account = (id: string, currency: Currency, kind: Account["kind"] = "fiat"): Account => ({
  id,
  name: id,
  currency,
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
  seq += 1;
  return {
    id: `t${String(seq).padStart(3, "0")}`,
    accountId,
    direction: "expense",
    categoryId: null,
    amount,
    status: "completed",
    dueDate,
    completedAt: `${dueDate}T12:00:00.000Z`,
    description: "",
    fxSnapshot: null,
    transferGroupId: null,
    transferMarketRate: null,
    recurringTemplateId: null,
    loanId: null,
    victvsPayoutId: null,
    purchaseId: null,
    legacy: false,
    createdAt: `${dueDate}T08:00:${String(seq % 60).padStart(2, "0")}.000Z`,
    ...overrides,
  };
}

const usdPer: UsdPerMap = { USD: 1, TRY: 0.025, EUR: 1.1, BTC: 60000, XAU_G: 80 };
const septemberRates: UsdPerMap = { ...usdPer, TRY: 0.0263 };

const bank = account("Ziraat TRY", "TRY");
const wise = account("Wise USD", "USD");
const card = account("Bonus Card", "TRY", "credit_card");
const accounts = [bank, wise, card];
const accountsById = new Map(accounts.map((a) => [a.id, a]));

// A month with one of everything the ledger has to get right.
const salary = tx(wise.id, "2026-10-01", 1000, { direction: "income", description: "Salary" });
const groceries = tx(bank.id, "2026-10-02", 2000, { description: "Weekly market" });
const transferOut = tx(wise.id, "2026-10-03", 500, { transferGroupId: "g-fx", description: "To Ziraat TRY" });
const transferIn = tx(bank.id, "2026-10-03", 20000, { direction: "income", transferGroupId: "g-fx", description: "From Wise USD" });
const cardPaying = tx(bank.id, "2026-10-05", 4000, { transferGroupId: "g-card", description: "Bonus statement" });
const cardLanding = tx(card.id, "2026-10-05", 4000, { direction: "income", transferGroupId: "g-card" });
const cardCharge = tx(card.id, "2026-10-06", 1500, { description: "Migros on the card" });
const legacyRow = tx(bank.id, "2026-10-07", 10000, { legacy: true, description: "Old fridge" });
const adjustment = tx(bank.id, "2026-10-07", 35, { adjustment: true, description: "EFT fee" });
const september = tx(bank.id, "2026-09-20", 4000, {
  direction: "income",
  description: "Refund",
  fxSnapshot: { usdPer: septemberRates, at: "2026-09-20T12:00:00.000Z" },
});
const planned = tx(bank.id, "2026-11-28", 2800, { status: "planned", completedAt: null, description: "Dentist" });
const orphan = tx("gone", "2026-10-04", 99, { description: "Account deleted" });

const ledger = [
  salary,
  groceries,
  transferOut,
  transferIn,
  cardPaying,
  cardLanding,
  cardCharge,
  legacyRow,
  adjustment,
  september,
  planned,
  orphan,
];
const book = buildCardBook(accounts, ledger);

/** The Classic Transactions page month header, as app/(app)/transactions/page.tsx computes it. */
function classicLedgerMonths(rows: Transaction[], b: CardBook, display: Currency, rates: UsdPerMap) {
  const currencyOf = new Map(accounts.map((a) => [a.id, a.currency] as const));
  const byMonth = new Map<string, { income: number; expense: number }>();
  for (const t of rows) {
    const month = t.dueDate.slice(0, 7);
    const bucket = byMonth.get(month) ?? { income: 0, expense: 0 };
    const income = isIncome(t, b);
    if (income || isSpending(t, b)) {
      const currency = currencyOf.get(t.accountId);
      const r = t.fxSnapshot?.usdPer ?? rates;
      const converted = currency && r ? convert(t.amount, currency, display, r) : null;
      if (converted != null && !t.legacy) {
        if (income) bucket.income += converted;
        else bucket.expense += converted;
      }
    }
    byMonth.set(month, bucket);
  }
  return new Map([...byMonth].map(([m, v]) => [m, { ...v, net: v.income - v.expense }]));
}

/** The Classic Portfolio history (completedMonths in app/(app)/accounts/page.tsx). */
function classicAccountMonths(rows: Transaction[], accountId: string) {
  const byMonth = new Map<string, number>();
  for (const t of rows.filter((r) => r.accountId === accountId && r.status === "completed")) {
    const month = t.dueDate.slice(0, 7);
    const net = byMonth.get(month) ?? 0;
    byMonth.set(month, t.legacy ? net : net + (t.direction === "income" ? t.amount : -t.amount));
  }
  return byMonth;
}

describe("listedRows", () => {
  it("leaves out a card's charges and a payment's landing on the card, as the Classic ledger does", () => {
    const listed = listedRows(ledger, book);
    expect(listed).not.toContain(cardCharge);
    expect(listed).not.toContain(cardLanding);
    expect(listed).toContain(cardPaying);
    expect(listed).toContain(transferOut);
    expect(listed).toContain(transferIn);
    expect(listed).toHaveLength(ledger.length - 2);
  });
});

describe("transferCounterparts", () => {
  it("maps a transfer's group to the leg that lands", () => {
    const map = transferCounterparts(ledger);
    expect(map.get("g-fx")).toBe(transferIn);
    expect(map.get("g-card")).toBe(cardLanding);
    expect(map.size).toBe(2);
    expect(isTransferLanding(transferIn)).toBe(true);
    expect(isTransferLanding(transferOut)).toBe(false);
    expect(isTransferLanding(salary)).toBe(false);
  });
});

describe("groupMonthsDays — the whole ledger", () => {
  const listed = listedRows(ledger, book);
  const months = groupMonthsDays(listed, { accountsById, usdPer, display: "USD", book });

  it("gives the Classic month nets", () => {
    const classic = classicLedgerMonths(listed, book, "USD", usdPer);
    for (const m of months) {
      const c = classic.get(m.month)!;
      expect(m.income).toBeCloseTo(c.income, 9);
      expect(m.expense).toBeCloseTo(c.expense, 9);
      expect(m.net).toBeCloseTo(c.net, 9);
    }
    expect(months.map((m) => m.month)).toEqual(["2026-11", "2026-10", "2026-09"]);
  });

  it("counts income and spending in the display currency; the adjustment is an ordinary expense", () => {
    const october = months.find((m) => m.month === "2026-10")!;
    // salary $1,000 in; ₺2,000 groceries + ₺4,000 card payment + ₺35 fee out at 40 TRY/USD
    expect(october.income).toBeCloseTo(1000, 9);
    expect(october.expense).toBeCloseTo(50 + 100 + 0.88, 9);
    expect(october.net).toBeCloseTo(849.12, 9);
    // a completed row keeps the rates it was completed under
    const sept = months.find((m) => m.month === "2026-09")!;
    expect(sept.income).toBeCloseTo(105.2, 9);
  });

  it("lists a transfer once, never the card charge, and legacy rows without summing them", () => {
    const rows = months.flatMap((m) => m.days.flatMap((d) => d.rows));
    expect(rows).toContain(transferOut);
    expect(rows).not.toContain(transferIn);
    expect(rows).not.toContain(cardCharge);
    expect(rows).not.toContain(cardLanding);
    expect(rows).toContain(cardPaying);
    expect(rows).toContain(legacyRow);
    expect(rows).toContain(adjustment);
    // the row whose account is gone renders nothing, so it isn't listed
    expect(rows).not.toContain(orphan);
  });

  it("splits a month into days, newest first, each with its own net and count", () => {
    const october = months.find((m) => m.month === "2026-10")!;
    expect(october.days.map((d) => d.date)).toEqual(["2026-10-07", "2026-10-05", "2026-10-03", "2026-10-02", "2026-10-01"]);
    const fee = october.days[0];
    expect(fee.count).toBe(2);
    expect(fee.net).toBeCloseTo(-0.88, 9);
    expect(october.days.find((d) => d.date === "2026-10-03")!.net).toBe(0);
    expect(october.days.find((d) => d.date === "2026-10-05")!.net).toBeCloseTo(-100, 9);
    const daySum = october.days.reduce((s, d) => s + d.net, 0);
    expect(daySum).toBeCloseTo(october.net, 9);
  });

  it("sorts oldest first on request: months, days and rows within a day", () => {
    const oldest = groupMonthsDays(listed, { accountsById, usdPer, display: "USD", book, order: "oldest" });
    expect(oldest.map((m) => m.month)).toEqual(["2026-09", "2026-10", "2026-11"]);
    const october = oldest[1];
    expect(october.days.map((d) => d.date)).toEqual(["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-05", "2026-10-07"]);
    expect(october.days[4].rows).toEqual([legacyRow, adjustment]);
    const newest = months.find((m) => m.month === "2026-10")!;
    expect(newest.days[0].rows).toEqual([adjustment, legacyRow]);
  });

  it("doesn't depend on the order rows arrive in", () => {
    const shuffled = [...listed].reverse();
    expect(groupMonthsDays(shuffled, { accountsById, usdPer, display: "USD", book })).toEqual(months);
  });

  it("converts to any display currency", () => {
    const inTry = groupMonthsDays(listed, { accountsById, usdPer, display: "TRY", book });
    const october = inTry.find((m) => m.month === "2026-10")!;
    expect(october.income).toBeCloseTo(40000, 6);
    expect(october.expense).toBeCloseTo(6035, 6);
    const classic = classicLedgerMonths(listed, book, "TRY", usdPer).get("2026-10")!;
    expect(october.net).toBeCloseTo(classic.net, 9);
  });

  it("leaves rows it can't convert out of the sums, as Classic does", () => {
    const noRates = groupMonthsDays(listed, { accountsById, usdPer: null, display: "USD", book });
    const october = noRates.find((m) => m.month === "2026-10")!;
    expect(october.income).toBe(0);
    expect(october.days.reduce((n, d) => n + d.count, 0)).toBe(6);
    // September's row carries its own rates
    expect(noRates.find((m) => m.month === "2026-09")!.income).toBeCloseTo(105.2, 9);
  });
});

describe("groupMonthsDays — one account", () => {
  it("nets in the account's currency, signed by direction, legacy listed but not counted", () => {
    const completed = ledger.filter((t) => t.status === "completed");
    const months = groupMonthsDays(completed, { accountsById, usdPer, display: "USD", book, accountId: bank.id });
    const classic = classicAccountMonths(ledger, bank.id);
    for (const m of months) expect(m.net).toBeCloseTo(classic.get(m.month)!, 9);
    const october = months.find((m) => m.month === "2026-10")!;
    // +₺20,000 arriving from Wise, −₺2,000 groceries, −₺4,000 to the card, −₺35 fee
    expect(october.net).toBeCloseTo(13965, 9);
    expect(october.income).toBeCloseTo(20000, 9);
    expect(october.expense).toBeCloseTo(6035, 9);
    const rows = october.days.flatMap((d) => d.rows);
    expect(rows).toContain(transferIn);
    expect(rows).toContain(legacyRow);
    expect(rows.every((r) => r.accountId === bank.id)).toBe(true);
  });

  it("keeps every row of the account, a card's charges included, when given the whole ledger", () => {
    const months = groupMonthsDays(ledger, { accountsById, usdPer, display: "USD", book, accountId: card.id });
    expect(months).toHaveLength(1);
    expect(months[0].net).toBeCloseTo(4000 - 1500, 9);
    expect(months[0].days.flatMap((d) => d.rows)).toEqual([cardCharge, cardLanding]);
  });
});

describe("labels", () => {
  const words = { today: "Today", yesterday: "Yesterday", tomorrow: "Tomorrow" };

  it("names the days around today", () => {
    expect(dayLabel("2026-10-16", "2026-10-16", "en", words)).toBe("Today");
    expect(dayLabel("2026-10-15", "2026-10-16", "en", words)).toBe("Yesterday");
    expect(dayLabel("2026-10-17", "2026-10-16", "en", words)).toBe("Tomorrow");
    expect(dayLabel("2026-10-31", "2026-11-01", "en", words)).toBe("Yesterday");
  });

  it("writes other days with the weekday, and the year only when it isn't this one", () => {
    expect(dayLabel("2026-10-09", "2026-10-16", "en", words)).toBe("Fri, Oct 9");
    expect(dayLabel("2026-10-09", "2026-10-16", "tr", words)).toBe("9 Eki Cum");
    expect(dayLabel("2025-12-30", "2026-01-02", "en", words)).toBe("Tue, Dec 30, 2025");
  });

  it("writes a month with its year", () => {
    expect(monthLabel("2026-10", "en")).toBe("October 2026");
    expect(monthLabel("2026-10", "tr")).toBe("Ekim 2026");
  });
});
