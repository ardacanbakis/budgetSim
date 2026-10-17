import { describe, expect, it } from "vitest";
import { Account, Category, Transaction } from "@/lib/data/types";
import { buildCardBook, CardBook, isIncome, isSpending } from "@/lib/domain/cards";
import { Currency } from "@/lib/domain/currencies";
import { convert, UsdPerMap } from "@/lib/domain/fx";
import {
  ActivityFilters,
  applyFilters,
  filtersFromParams,
  foldSearch,
  hasActiveFilters,
  historyStatus,
  monthsAhead,
  needsAction,
  netOf,
  NO_FILTERS,
  scopeRows,
  toggleChip,
} from "../pocket/activityFilter";
import { groupMonthsDays, listedRows } from "../pocket/dayGroups";

const TODAY = "2026-10-17";

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
const planned = (accountId: string, dueDate: string, amount: number, overrides: Partial<Transaction> = {}) =>
  tx(accountId, dueDate, amount, { status: "planned", completedAt: null, ...overrides });

const usdPer: UsdPerMap = { USD: 1, TRY: 0.025, EUR: 1.1, BTC: 60000, XAU_G: 80 };
const septemberRates: UsdPerMap = { ...usdPer, TRY: 0.0263 };

const bank = account("Ziraat TRY", "TRY");
const wise = account("Wise USD", "USD");
const card = account("Bonus Card", "TRY", "credit_card");
const accounts = [bank, wise, card];
const accountsById = new Map(accounts.map((a) => [a.id, a]));

const health: Category = { id: "c-health", name: "Health", direction: "expense", color: "#ec4899" };
const salaryCat: Category = { id: "c-salary", name: "Maaş", direction: "income", color: "#16a34a" };
const categoriesById = new Map([health, salaryCat].map((c) => [c.id, c]));

// completed history across two months
const salary = tx(wise.id, "2026-10-01", 1000, { direction: "income", categoryId: salaryCat.id, description: "October salary" });
const groceries = tx(bank.id, "2026-10-02", 2000, { description: "Weekly market" });
const transferOut = tx(wise.id, "2026-10-03", 500, { transferGroupId: "g-fx", description: "To Ziraat TRY" });
const transferIn = tx(bank.id, "2026-10-03", 20000, { direction: "income", transferGroupId: "g-fx", description: "From Wise USD" });
const cardPaying = tx(bank.id, "2026-10-05", 4000, { transferGroupId: "g-card", description: "Bonus statement" });
const cardLanding = tx(card.id, "2026-10-05", 4000, { direction: "income", transferGroupId: "g-card" });
const cardCharge = tx(card.id, "2026-10-06", 1500, { description: "Migros on the card" });
const legacyRow = tx(bank.id, "2026-10-07", 10000, { legacy: true, description: "Old fridge" });
const adjustment = tx(bank.id, "2026-10-07", 35, { adjustment: true, description: "EFT fee" });
const refund = tx(bank.id, "2026-09-20", 4000, {
  direction: "income",
  description: "Refund",
  fxSnapshot: { usdPer: septemberRates, at: "2026-09-20T12:00:00.000Z" },
});
// planned: two overdue, one today, one in 5 days, one in 11 days, one far ahead
const lateRetainer = planned(wise.id, "2026-10-05", 900, { direction: "income", description: "VICTVS retainer" });
const lateRent = planned(bank.id, "2026-10-10", 27500, { description: "Rent" });
const dueToday = planned(bank.id, TODAY, 300, { description: "Gym" });
const soon = planned(bank.id, "2026-10-22", 1200, { description: "Phone bill" });
const dentist = planned(bank.id, "2026-10-28", 2800, { categoryId: health.id, description: "Dentist follow-up" });
const farAway = planned(wise.id, "2026-11-17", 1200, { direction: "income", description: "Contract work — invoice #15" });
// a planned transfer, both legs
const plannedOut = planned(wise.id, "2026-10-20", 100, { transferGroupId: "g-plan", description: "To Ziraat TRY" });
const plannedIn = planned(bank.id, "2026-10-20", 4000, { direction: "income", transferGroupId: "g-plan", description: "From Wise USD" });

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
  refund,
  lateRetainer,
  lateRent,
  dueToday,
  soon,
  dentist,
  farAway,
  plannedOut,
  plannedIn,
];
const book = buildCardBook(accounts, ledger);
const listed = listedRows(ledger, book);

const ctx = { today: TODAY, categoriesById, accountsById, locale: "en" };
const run = (filters: Partial<ActivityFilters>, locale = "en") => applyFilters(listed, { ...NO_FILTERS, ...ctx, locale, ...filters });
const ids = (rows: Transaction[]) => rows.map((r) => r.id);

/**
 * The Classic Transactions page: its filters (account, status, direction on
 * tx.direction) and its month header (app/(app)/transactions/page.tsx).
 */
function classicMonths(
  rows: Transaction[],
  b: CardBook,
  display: Currency,
  rates: UsdPerMap,
  filters: { account?: string; status?: "planned" | "completed"; direction?: "income" | "expense" }
) {
  let list = rows.filter((t) => b.roleOf(t) !== "charge" && b.roleOf(t) !== "cardSide");
  if (filters.account) list = list.filter((t) => t.accountId === filters.account);
  if (filters.status) list = list.filter((t) => t.status === filters.status);
  if (filters.direction) list = list.filter((t) => t.direction === filters.direction);
  const currencyOf = new Map(accounts.map((a) => [a.id, a.currency] as const));
  const byMonth = new Map<string, number>();
  for (const t of list) {
    const month = t.dueDate.slice(0, 7);
    let net = byMonth.get(month) ?? 0;
    const income = isIncome(t, b);
    if (income || isSpending(t, b)) {
      const currency = currencyOf.get(t.accountId);
      const r = t.fxSnapshot?.usdPer ?? rates;
      const converted = currency && r ? convert(t.amount, currency, display, r) : null;
      if (converted != null && !t.legacy) net += income ? converted : -converted;
    }
    byMonth.set(month, net);
  }
  return byMonth;
}

function pocketMonths(filters: Partial<ActivityFilters>, display: Currency) {
  const rows = run(filters);
  return new Map(
    groupMonthsDays(rows, { accountsById, usdPer, display, book, order: filters.sort ?? "newest" }).map((m) => [m.month, m.net])
  );
}

function expectSameNets(pocket: Map<string, number>, classic: Map<string, number>) {
  expect([...pocket.keys()].sort()).toEqual([...classic.keys()].sort());
  for (const [month, net] of classic) expect(pocket.get(month)).toBeCloseTo(net, 6);
}

describe("foldSearch", () => {
  it("folds the Turkish dotted and dotless i together, under either language", () => {
    for (const locale of ["en", "tr"]) {
      expect(foldSearch("DENTİST", locale)).toBe("dentist");
      expect(foldSearch("DENTIST", locale)).toBe("dentist");
      expect(foldSearch("dentıst", locale)).toBe("dentist");
      expect(foldSearch("  Dentist  ", locale)).toBe("dentist");
    }
  });

  it("folds accents, so a search typed without them still finds the row", () => {
    expect(foldSearch("Ödeme", "tr")).toBe("odeme");
    expect(foldSearch("MAAŞ", "tr")).toBe("maas");
    expect(foldSearch("Çağrı", "en")).toBe("cagri");
  });
});

describe("applyFilters: search", () => {
  it("finds 'dentist' whatever its case, including the Turkish İ and ı, planned or not", () => {
    for (const query of ["dentist", "DENTIST", "Dentİst", "DENTİST", "dentıst"]) {
      for (const locale of ["en", "tr"]) {
        expect(ids(run({ search: query }, locale)), `${query} (${locale})`).toEqual([dentist.id]);
      }
    }
  });

  it("matches the category name and the account name too", () => {
    expect(ids(run({ search: "health" }))).toEqual([dentist.id]);
    expect(ids(run({ search: "maas" }))).toEqual([salary.id]);
    // every row on Wise USD, planned and completed, newest first
    expect(ids(run({ search: "wise" }))).toEqual(
      ids([farAway, plannedOut, transferIn, plannedIn, lateRetainer, transferOut, salary].sort((a, b) => (a.dueDate < b.dueDate ? 1 : a.dueDate > b.dueDate ? -1 : a.createdAt < b.createdAt ? 1 : -1)))
    );
  });

  it("never lists a card's charges or a payment's landing on the card", () => {
    expect(run({ search: "migros" })).toEqual([]);
    expect(ids(run({ search: "bonus" }))).toEqual([cardPaying.id]);
  });
});

describe("monthsAhead: a search opens at this month", () => {
  const months = (filters: Partial<ActivityFilters>) => groupMonthsDays(run(filters), { accountsById, usdPer, display: "USD", book, order: filters.sort ?? "newest" });
  const ahead = (filters: Partial<ActivityFilters>) => monthsAhead(months(filters), { ...NO_FILTERS, ...filters }, TODAY);

  it("folds the months after this one, newest first", () => {
    // "wise": November's invoice, then October, then nothing earlier on Wise
    expect(months({ search: "wise" }).map((m) => m.month)).toEqual(["2026-11", "2026-10"]);
    expect(ahead({ search: "wise" })).toBe(1);
    expect(ahead({ search: "wise", direction: "expense" })).toBe(0);
  });

  it("folds nothing oldest first, with Planned or Overdue on, or without a search", () => {
    expect(ahead({ search: "wise", sort: "oldest" })).toBe(0);
    expect(ahead({ search: "wise", planned: true, sort: "newest" })).toBe(0);
    expect(ahead({ planned: true, sort: "newest" })).toBe(0);
    expect(ahead({})).toBe(0);
  });

  it("folds nothing when every month found is ahead", () => {
    expect(months({ search: "invoice" }).map((m) => m.month)).toEqual(["2026-11"]);
    expect(ahead({ search: "invoice" })).toBe(0);
  });

  it("counts from today's month, not the rows'", () => {
    const later = [{ month: "2027-10" }, { month: "2027-01" }, { month: "2026-11" }, { month: "2026-10" }, { month: "2026-09" }];
    expect(monthsAhead(later, { ...NO_FILTERS, search: "x" }, TODAY)).toBe(3);
    expect(monthsAhead(later, { ...NO_FILTERS, search: "x" }, "2026-12-01")).toBe(2);
  });
});

describe("applyFilters: status, account, direction and order", () => {
  it("lists completed rows by default, newest first", () => {
    const rows = run({});
    expect(rows.every((r) => r.status === "completed")).toBe(true);
    expect(rows[0].dueDate >= rows[rows.length - 1].dueDate).toBe(true);
    expect(ids(rows)).toContain(legacyRow.id);
    expect(ids(rows)).not.toContain(cardCharge.id);
  });

  it("Planned lists every planned row; Overdue only those before today", () => {
    expect(new Set(ids(run({ planned: true })))).toEqual(
      new Set(ids([lateRetainer, lateRent, dueToday, soon, dentist, farAway, plannedOut, plannedIn]))
    );
    expect(ids(run({ overdue: true, sort: "oldest" }))).toEqual([lateRetainer.id, lateRent.id]);
  });

  it("an account keeps that account's rows, both legs of a transfer included", () => {
    const rows = run({ accountId: bank.id });
    expect(rows.every((r) => r.accountId === bank.id)).toBe(true);
    expect(ids(rows)).toContain(transferIn.id);
  });

  it("Income and Expense filter on the row's direction, as the Classic filter does", () => {
    expect(run({ direction: "income" }).every((r) => r.direction === "income")).toBe(true);
    expect(ids(run({ direction: "expense" }))).toContain(transferOut.id);
  });

  it("orders oldest first on request", () => {
    const rows = run({ sort: "oldest" });
    expect(rows[0]).toBe(refund);
  });

  it("historyStatus: a search looks through planned rows too", () => {
    expect(historyStatus({ planned: false, overdue: false, search: "" })).toBe("completed");
    expect(historyStatus({ planned: false, overdue: false, search: " x " })).toBe("all");
    expect(historyStatus({ planned: true, overdue: false, search: "x" })).toBe("planned");
    expect(historyStatus({ planned: false, overdue: true, search: "" })).toBe("overdue");
  });
});

describe("month nets equal the Classic month header for the same filter", () => {
  for (const display of ["USD", "TRY"] as const) {
    it(`completed rows (Classic Status: Completed), in ${display}`, () => {
      expectSameNets(pocketMonths({}, display), classicMonths(ledger, book, display, usdPer, { status: "completed" }));
    });
    it(`Planned (Classic Status: Planned), in ${display}`, () => {
      expectSameNets(
        pocketMonths(toggleChip(NO_FILTERS, "planned"), display),
        classicMonths(ledger, book, display, usdPer, { status: "planned" })
      );
    });
    it(`Income and Expense (Classic Direction), in ${display}`, () => {
      for (const direction of ["income", "expense"] as const) {
        expectSameNets(
          pocketMonths({ direction }, display),
          classicMonths(ledger, book, display, usdPer, { status: "completed", direction })
        );
      }
    });
  }

  it("the transfer counts once and not at all; the adjustment counts as an expense; legacy isn't summed", () => {
    const october = groupMonthsDays(run({}), { accountsById, usdPer, display: "USD", book }).find((m) => m.month === "2026-10")!;
    // salary 1000 − groceries 50 − card statement 100 − EFT fee 0.88 (₺35, to the cent)
    expect(october.income).toBeCloseTo(1000, 6);
    expect(october.expense).toBeCloseTo(50 + 100 + 0.88, 6);
    const rows = october.days.flatMap((d) => d.rows);
    expect(rows).toContain(transferOut);
    expect(rows).not.toContain(transferIn);
    expect(rows).toContain(legacyRow);
  });

  it("with an account, nets are in its currency, legacy listed but not summed", () => {
    const months = groupMonthsDays(run({ accountId: bank.id }), { accountsById, usdPer, display: "USD", book, accountId: bank.id });
    const october = months.find((m) => m.month === "2026-10")!;
    // +20000 transfer in − 2000 groceries − 4000 statement − 35 fee; the old fridge isn't summed
    expect(october.net).toBeCloseTo(20000 - 2000 - 4000 - 35, 6);
    expect(october.days.flatMap((d) => d.rows)).toContain(legacyRow);
  });
});

describe("toggleChip", () => {
  it("keeps Planned and Overdue exclusive, and lists them oldest first", () => {
    const p = toggleChip(NO_FILTERS, "planned");
    expect(p).toMatchObject({ planned: true, overdue: false, sort: "oldest" });
    const o = toggleChip(p, "overdue");
    expect(o).toMatchObject({ planned: false, overdue: true, sort: "oldest" });
    expect(toggleChip(o, "overdue")).toMatchObject({ planned: false, overdue: false, sort: "newest" });
  });

  it("keeps Income and Expense exclusive", () => {
    const i = toggleChip(NO_FILTERS, "income");
    expect(i.direction).toBe("income");
    expect(toggleChip(i, "expense").direction).toBe("expense");
    expect(toggleChip(i, "income").direction).toBeNull();
  });

  it("hasActiveFilters ignores the order", () => {
    expect(hasActiveFilters(NO_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...NO_FILTERS, sort: "oldest" })).toBe(false);
    expect(hasActiveFilters({ ...NO_FILTERS, search: "  " })).toBe(false);
    expect(hasActiveFilters({ ...NO_FILTERS, accountId: bank.id })).toBe(true);
    expect(hasActiveFilters(toggleChip(NO_FILTERS, "expense"))).toBe(true);
  });
});

describe("needsAction", () => {
  const scoped = (filters: Partial<ActivityFilters> = {}) => scopeRows(listed, { ...NO_FILTERS, ...ctx, ...filters });

  it("splits planned rows into overdue, the next 7 days (today included), and later", () => {
    const n = needsAction(scoped(), { today: TODAY, days: 7 });
    expect(ids(n.overdue)).toEqual([lateRetainer.id, lateRent.id]);
    // the planned transfer once, as the leg that leaves
    expect(ids(n.coming)).toEqual([dueToday.id, plannedOut.id, soon.id]);
    expect(n.later).toBe(2);
  });

  it("looks 30 days ahead on request", () => {
    const n = needsAction(scoped(), { today: TODAY, days: 30 });
    expect(ids(n.coming)).toEqual([dueToday.id, plannedOut.id, soon.id, dentist.id]);
    expect(n.later).toBe(1);
  });

  it("follows the account, search and direction filters; on one account, its own transfer leg", () => {
    const onBank = needsAction(scoped({ accountId: bank.id }), { today: TODAY, days: 7, accountId: bank.id });
    expect(ids(onBank.overdue)).toEqual([lateRent.id]);
    expect(ids(onBank.coming)).toEqual([dueToday.id, plannedIn.id, soon.id]);
    expect(needsAction(scoped({ direction: "income" }), { today: TODAY, days: 7 }).overdue).toEqual([lateRetainer]);
    expect(needsAction(scoped({ search: "rent" }), { today: TODAY, days: 7 }).overdue).toEqual([lateRent]);
  });

  it("netOf sums a block by the month headers' rule", () => {
    const n = needsAction(scoped(), { today: TODAY, days: 7 });
    // +$900 retainer − ₺27,500 rent ($687.50)
    expect(netOf(n.overdue, { accountsById, usdPer, display: "USD", book })).toBeCloseTo(900 - 687.5, 6);
    // the transfer is neither in nor out: the gym and the phone bill
    expect(netOf(n.coming, { accountsById, usdPer, display: "TRY", book })).toBeCloseTo(-300 - 1200, 6);
  });
});

describe("filtersFromParams", () => {
  it("reads ?filter, ?account and ?q", () => {
    expect(filtersFromParams({})).toEqual(NO_FILTERS);
    expect(filtersFromParams({ filter: "overdue", account: bank.id, q: "rent" })).toEqual({
      ...NO_FILTERS,
      overdue: true,
      sort: "oldest",
      accountId: bank.id,
      search: "rent",
    });
    expect(filtersFromParams({ filter: "planned" })).toMatchObject({ planned: true, overdue: false });
    expect(filtersFromParams({ filter: "nonsense", account: "" })).toEqual(NO_FILTERS);
  });
});
