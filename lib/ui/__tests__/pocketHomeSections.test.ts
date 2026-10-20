import { describe, expect, it } from "vitest";
import { buildDemoSeed } from "@/lib/data/demoSeed";
import { Account, Budget, Transaction } from "@/lib/data/types";
import { computeBalances } from "@/lib/domain/balances";
import { budgetStatuses, BudgetStatus } from "@/lib/domain/budgets";
import { buildCardBook } from "@/lib/domain/cards";
import { UsdPerMap } from "@/lib/domain/fx";
import { goldRatiosOf } from "@/lib/domain/gold";
import { cardStandings, findDueCardPayments } from "@/lib/domain/purchases";
import { todayISO } from "@/lib/domain/recurrence";
import { comingUp, ComingUpItem } from "../pocket/attention";
import {
  accountTiles,
  AMOUNT_SLOT,
  canMove,
  comingUpTotal,
  decodeSections,
  encodeSections,
  moveSection,
  parseSections,
  recentRows,
  resetSections,
  SECTION_IDS,
  SectionEntry,
  serializeSections,
  shownSections,
  splitAtSlot,
  toggleSection,
  topBudgets,
} from "../pocket/homeSections";

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
    status: "completed",
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

// 1 USD = 40 TRY = 0.9 EUR
const usdPer: UsdPerMap = { USD: 1, TRY: 1 / 40, EUR: 1 / 0.9, BTC: 60000, XAU_G: 100 };
const today = "2026-10-16";
const ids = (entries: SectionEntry[]) => encodeSections(entries);

describe("home sections", () => {
  it("defaults to Coming up, Accounts, Budgets, Recent; flow, goals and gold hidden", () => {
    expect(SECTION_IDS).toEqual(["comingUp", "accounts", "budgets", "recent", "flow", "goals", "gold"]);
    expect(ids(resetSections())).toEqual(["comingUp", "accounts", "budgets", "recent", "!flow", "!goals", "!gold"]);
    expect(shownSections(resetSections())).toEqual(["comingUp", "accounts", "budgets", "recent"]);
  });

  it("decodes like navEntries: '!' hides, unknown ids and repeats drop, new ids append in their default state", () => {
    const entries = decodeSections(["budgets", "!recent", "hero", "accounts", "budgets", "!nope", "flow"]);
    expect(ids(entries)).toEqual(["budgets", "!recent", "accounts", "flow", "comingUp", "!goals", "!gold"]);
    expect(shownSections(entries)).toEqual(["budgets", "accounts", "flow", "comingUp"]);
    // anything that isn't a string is ignored
    expect(ids(decodeSections([1, null, "gold"]))).toEqual(["gold", ...ids(resetSections()).filter((s) => !s.endsWith("gold"))]);
    expect(decodeSections(null)).toEqual(resetSections());
  });

  it("round-trips through the stored string, and reads anything broken as the default", () => {
    const moved = moveSection(toggleSection(resetSections(), "recent"), "budgets", -1);
    expect(parseSections(serializeSections(moved))).toEqual(moved);
    expect(parseSections(null)).toEqual(resetSections());
    expect(parseSections("")).toEqual(resetSections());
    expect(parseSections("{not json")).toEqual(resetSections());
    expect(parseSections('{"order":[]}')).toEqual(resetSections());
  });

  it("moves one place at a time and stays put at either end", () => {
    const start = resetSections();
    expect(ids(moveSection(start, "budgets", -1)).slice(0, 4)).toEqual(["comingUp", "budgets", "accounts", "recent"]);
    expect(ids(moveSection(start, "comingUp", 1)).slice(0, 2)).toEqual(["accounts", "comingUp"]);
    expect(canMove(start, "comingUp", -1)).toBe(false);
    expect(canMove(start, "gold", 1)).toBe(false);
    expect(canMove(start, "gold", -1)).toBe(true);
    expect(moveSection(start, "comingUp", -1)).toEqual(start);
    expect(moveSection(start, "gold", 1)).toEqual(start);
    // the input is never changed
    expect(start).toEqual(resetSections());
  });

  it("toggles one section and resets to the default", () => {
    const hidden = toggleSection(resetSections(), "recent");
    expect(shownSections(hidden)).toEqual(["comingUp", "accounts", "budgets"]);
    expect(shownSections(toggleSection(hidden, "flow"))).toEqual(["comingUp", "accounts", "budgets", "flow"]);
    expect(shownSections(toggleSection(hidden, "recent"))).toEqual(shownSections(resetSections()));
  });
});

describe("recentRows", () => {
  const bank = account("bank");
  const card = account("card", "credit_card", { paymentDay: 20 });
  const byId = new Map([bank, card].map((a) => [a.id, a]));

  it("lists completed rows of the last 7 days, newest first, as the ledger shows them, at most 8", () => {
    const weekAgo = tx("bank", "2026-10-09", 10, { description: "a week ago" });
    const tooOld = tx("bank", "2026-10-08", 10, { description: "eight days ago" });
    const planned = tx("bank", "2026-10-15", 10, { status: "planned", description: "planned" });
    const ahead = tx("bank", "2026-10-17", 10, { description: "tomorrow" });
    const charge = tx("card", "2026-10-15", 10, { description: "card charge" });
    const leave = tx("bank", "2026-10-14", 100, { transferGroupId: "g1", description: "leaves" });
    const land = tx("card", "2026-10-14", 100, { transferGroupId: "g1", direction: "income", description: "lands" });
    const stranger = tx("ghost", "2026-10-15", 10, { description: "unknown account" });
    const today1 = tx("bank", today, 10, { description: "today 1" });
    const today2 = tx("bank", today, 10, { description: "today 2" });
    const all = [weekAgo, tooOld, planned, ahead, charge, leave, land, stranger, today1, today2];
    const book = buildCardBook([bank, card], all);
    expect(recentRows(all, book, byId, today).map((r) => r.description)).toEqual(["today 2", "today 1", "leaves", "a week ago"]);

    const many = Array.from({ length: 12 }, (_, i) => tx("bank", "2026-10-12", i + 1));
    const top = recentRows(many, buildCardBook([bank], many), byId, today);
    expect(top).toHaveLength(8);
    expect(top[0].id > top[7].id).toBe(true);
  });

  it("drops a transfer's landing leg between your own accounts", () => {
    const wise = account("wise", "fiat", { currency: "USD" });
    const accounts = new Map([bank, wise].map((a) => [a.id, a]));
    const out = tx("wise", "2026-10-15", 500, { transferGroupId: "g2", description: "out" });
    const into = tx("bank", "2026-10-15", 20000, { transferGroupId: "g2", direction: "income", description: "in" });
    const rows = recentRows([out, into], buildCardBook([bank, wise], [out, into]), accounts, today);
    expect(rows.map((r) => r.description)).toEqual(["out"]);
  });
});

describe("comingUpTotal", () => {
  it("adds planned income, takes away spending and statements, ignores own transfers and VICTVS", () => {
    const bank = account("bank");
    const wise = account("wise", "fiat", { currency: "USD" });
    const card = account("card", "credit_card", { paymentDay: 20 });
    const salary = tx("wise", "2026-10-18", 1000, { status: "planned", direction: "income" });
    const rent = tx("bank", "2026-10-18", 4000, { status: "planned" });
    const move = tx("bank", "2026-10-18", 400, { status: "planned", transferGroupId: "g" });
    const moveIn = tx("wise", "2026-10-18", 10, { status: "planned", transferGroupId: "g", direction: "income" });
    const transactions = [salary, rent, move, moveIn];
    const book = buildCardBook([bank, wise, card], transactions);
    const accounts = [bank, wise, card];
    const items = comingUp({
      transactions,
      accounts,
      book,
      today,
      days: 7,
      duePayments: findDueCardPayments(accounts, book, today),
      standings: cardStandings(accounts, book, today),
      unpaidVictvsUsd: 187.5,
      unpaidVictvsCount: 4,
    });
    const statement: ComingUpItem = {
      kind: "card",
      key: "card:card",
      date: "2026-10-20",
      overdue: false,
      account: card,
      standing: cardStandings(accounts, book, today)[0],
      figure: { amount: 2000, totalOwed: 9000, monthsToGo: 3 },
    };
    // salary $1,000 − rent ₺4,000 ($100) − statement ₺2,000 ($50); the transfer and VICTVS count for nothing
    expect(comingUpTotal([...items, statement], { book, usdPer, display: "USD" })).toBeCloseTo(850, 10);
    expect(comingUpTotal([...items, statement], { book, usdPer, display: "TRY" })).toBeCloseTo(34000, 6);
    expect(comingUpTotal(items, { book, usdPer: undefined, display: "USD" })).toBeNull();
    expect(comingUpTotal([], { book, usdPer, display: "USD" })).toBe(0);
  });
});

describe("accountTiles", () => {
  it("orders by display value, puts cards last as what they're owed, reads mixed gold in lira, skips archived", () => {
    const bank = account("bank", "fiat", { name: "Bank" });
    const wise = account("wise", "fiat", { currency: "USD", name: "Wise" });
    const coins = account("coins", "gold", { currency: "XAU_G", name: "Coins", holdings: [{ type: "ceyrek", qty: 2 }] } as Partial<Account>);
    const old = account("old", "fiat", { archived: true, name: "Old" });
    const card = account("card", "credit_card", { name: "Card" });
    const charge = tx("card", "2026-10-02", 800);
    const accounts = [bank, wise, coins, old, card];
    const book = buildCardBook(accounts, [charge]);
    const balances = new Map([
      ["bank", 20000], // $500
      ["wise", 900], // $900
      ["coins", 10], // 10 g = $1,000 = ₺40,000
      ["old", 999999],
      ["card", -800],
    ]);
    const tiles = accountTiles({ accounts, balances, book, today, usdPer, display: "USD" });
    expect(tiles.map((t) => t.account.id)).toEqual(["coins", "wise", "bank", "card"]);
    expect(tiles[0]).toMatchObject({ currency: "TRY", display: 1000 });
    expect(tiles[0].amount).toBeCloseTo(40000, 6);
    expect(tiles[3]).toMatchObject({ card: true, currency: "TRY", amount: -800 });
    expect(tiles[3].display).toBeCloseTo(-20, 10);
    // without rates: native figures, no display value, still cards last
    const bare = accountTiles({ accounts, balances, book, today, usdPer: undefined, display: "USD" });
    expect(bare.map((t) => [t.account.id, t.currency, t.display])).toEqual([
      ["bank", "TRY", null],
      ["coins", "XAU_G", null],
      ["wise", "USD", null],
      ["card", "TRY", null],
    ]);
  });

  it("leaves out the accounts the dashboards hide, and the empty ones when asked", () => {
    const bank = account("bank", "fiat", { name: "Bank" });
    const zero = account("zero", "fiat", { name: "Zero" });
    const idle = account("idle", "credit_card", { name: "Idle card" });
    const accounts = [bank, zero, idle];
    const book = buildCardBook(accounts, []);
    const balances = new Map([
      ["bank", 20000],
      ["zero", 0],
    ]);
    const base = { accounts, balances, book, today, usdPer, display: "USD" as const };
    expect(accountTiles(base).map((t) => t.account.id)).toEqual(["bank", "zero", "idle"]);
    expect(accountTiles({ ...base, hideEmpty: true }).map((t) => t.account.id)).toEqual(["bank"]);
    expect(accountTiles({ ...base, hiddenIds: ["bank"] }).map((t) => t.account.id)).toEqual(["zero", "idle"]);
  });
});

describe("topBudgets", () => {
  it("takes the most used budgets first", () => {
    const status = (id: string, pct: number): BudgetStatus => ({
      budget: { id, categoryId: id, monthlyLimit: 100, currency: "TRY" } as Budget,
      spent: pct,
      pct,
      level: "ok",
    });
    const rows = [status("a", 10), status("b", 120), status("c", 50), status("d", 80)];
    expect(topBudgets(rows).map((r) => r.budget.id)).toEqual(["b", "d", "c"]);
    expect(topBudgets(rows, 9).map((r) => r.budget.id)).toEqual(["b", "d", "c", "a"]);
    expect(rows.map((r) => r.budget.id)).toEqual(["a", "b", "c", "d"]);
  });
});

describe("splitAtSlot", () => {
  it("cuts a translated sentence either side of its figure", () => {
    const fill = (template: string) => template.replaceAll("{amount}", AMOUNT_SLOT);
    expect(splitAtSlot(fill("Next 7 days · {amount}"))).toEqual(["Next 7 days · ", ""]);
    expect(splitAtSlot(fill("Kart borcu {amount}"))).toEqual(["Kart borcu ", ""]);
    expect(splitAtSlot(fill("{amount} owed on cards"))).toEqual(["", " owed on cards"]);
    expect(splitAtSlot("no figure here")).toBeNull();
  });
});

describe("on the demo data", () => {
  it("leads Coming up with the card statement and its Cards-page figure", () => {
    const seed = buildDemoSeed();
    const now = todayISO();
    const book = buildCardBook(seed.accounts, seed.transactions);
    const items = comingUp({
      transactions: seed.transactions,
      accounts: seed.accounts,
      book,
      today: now,
      days: 7,
      duePayments: findDueCardPayments(seed.accounts, book, now),
      standings: cardStandings(seed.accounts, book, now),
      unpaidVictvsUsd: 0,
      unpaidVictvsCount: 0,
    });
    const card = items.find((i) => i.kind === "card");
    // the Bonus Card's statement is due on the 15th: on or before, it's coming up; after, overdue
    if (card && card.kind === "card") {
      expect(card.account.name).toBe("Bonus Card");
      expect(card.figure.totalOwed).toBeGreaterThanOrEqual(card.figure.amount);
    }
    const balances = computeBalances(seed.accounts, seed.transactions, goldRatiosOf(undefined));
    const tiles = accountTiles({ accounts: seed.accounts, balances, book, today: now, usdPer, display: "USD" });
    expect(tiles.at(-1)?.account.kind).toBe("credit_card");
    // budgets read the same as Classic's BudgetsCard
    const statuses = budgetStatuses({ budgets: seed.budgets, transactions: seed.transactions, accounts: seed.accounts, usdPer, month: now.slice(0, 7) });
    expect(topBudgets(statuses)).toHaveLength(seed.budgets.length);
  });
});
