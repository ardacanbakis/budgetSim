import { describe, expect, it } from "vitest";
import { Account, Loan, Transaction } from "@/lib/data/types";
import { computeBalances, computeNetWorth } from "@/lib/domain/balances";
import { buildCardBook, totalOwed } from "@/lib/domain/cards";
import { Currency } from "@/lib/domain/currencies";
import { computeDebtOverview } from "@/lib/domain/debt";
import { convert, UsdPerMap } from "@/lib/domain/fx";
import { goldRatiosOf } from "@/lib/domain/gold";
import {
  accountFeed,
  canAdjust,
  isMixedGold,
  isPortfolioSegment,
  ordinal,
  parseScroll,
  PORTFOLIO_SEGMENTS,
  SEGMENT_SECTIONS,
  sections,
  SectionsInput,
} from "../pocket/portfolioSections";

const TODAY = "2026-10-17";
const usdPer: UsdPerMap = { USD: 1, TRY: 0.024, EUR: 1.09, BTC: 104000, XAU_G: 78.5 };

const account = (id: string, currency: Currency, kind: Account["kind"] = "fiat", extra: Partial<Account> = {}): Account => ({
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

const ziraat = account("Ziraat TRY", "TRY", "fiat", { openingBalance: 260000 });
const wise = account("Wise USD", "USD", "fiat", { openingBalance: 6400 });
const eur = account("EUR Savings", "EUR", "fiat", { openingBalance: 2150 });
const empty = account("Cash drawer", "TRY", "fiat");
const wallet = account("Cold Wallet", "BTC", "crypto", { openingBalance: 0.0412 });
const gram = account("Gram Gold", "XAU_G", "gold", { openingBalance: 36 });
const coins = account("Coins", "XAU_G", "gold", { holdings: [{ type: "ceyrek", qty: 4 }, { type: "gram", qty: 10 }] });
const bonus = account("Bonus Card", "TRY", "credit_card", { paymentAccountId: ziraat.id, paymentDay: 15, creditLimit: 100000 });
const idleCard = account("Idle Card", "USD", "credit_card");
const old = account("Old bank", "EUR", "fiat", { archived: true, openingBalance: 300 });

const accounts = [ziraat, wise, eur, empty, wallet, gram, coins, bonus, idleCard, old];

const ledger: Transaction[] = [
  tx(ziraat.id, "2026-10-02", 2000, { description: "Weekly market" }),
  tx(wise.id, "2026-10-01", 1300, { direction: "income", description: "Salary" }),
  tx(ziraat.id, "2026-10-17", 37.5, { adjustment: true, description: "EFT fee" }),
  tx(ziraat.id, "2026-09-03", 10000, { legacy: true, description: "Imported" }),
  // the card: charges from last month no payment covers, and one this month
  tx(bonus.id, "2026-09-12", 20220.3, { description: "Migros" }),
  tx(bonus.id, "2026-10-04", 1500, { description: "Fuel" }),
  // planned rows on Ziraat, out of order
  tx(ziraat.id, "2026-11-01", 27500, { status: "planned", completedAt: null, description: "Rent", createdAt: "2026-10-01T00:00:00.000Z" }),
  tx(ziraat.id, "2026-10-28", 2800, { status: "planned", completedAt: null, description: "Dentist", createdAt: "2026-10-02T00:00:00.000Z" }),
  tx(ziraat.id, "2026-10-28", 900, { status: "planned", completedAt: null, description: "Internet", createdAt: "2026-10-01T00:00:00.000Z" }),
];

const loan: Loan = {
  id: "loan-1",
  name: "Car loan — Garanti",
  kind: "car",
  currency: "TRY",
  principal: 800000,
  monthlyRatePct: 2.79,
  termMonths: 36,
  startDate: "2026-06-15",
  installment: 33500,
  scheduleKind: "annuity",
  kkdfPct: 0,
  bsmvPct: 0,
  customInstalments: null,
  direction: "owe",
  counterparty: null,
  depositAccountId: null,
  payAccountId: null,
  payoffDate: null,
  recurringTemplateId: null,
  createdAt: "2026-06-01T00:00:00.000Z",
};
const loanPaid = [1, 2, 3].map((n) =>
  tx(ziraat.id, `2026-0${6 + n}-15`, 33500, { loanId: loan.id, description: `Car loan installment ${n}/36` })
);
const all = [...ledger, ...loanPaid];

const table = { usdPer };
const balances = computeBalances(accounts, all, goldRatiosOf(table));
const book = buildCardBook(accounts, all);

function input(overrides: Partial<SectionsInput> = {}): SectionsInput {
  const display = overrides.display ?? "USD";
  const debt = computeDebtOverview({
    loans: [loan],
    accounts,
    balances,
    transactions: all,
    usdPer,
    display,
    today: TODAY,
  });
  return { accounts, balances, book, debt, usdPer, display, hideEmpty: false, today: TODAY, ...overrides };
}

const names = (rows: Array<{ account: Account }>) => rows.map((r) => r.account.name);

describe("portfolio sections", () => {
  it("puts each open account in its section and the archived ones apart", () => {
    const s = sections(input());
    expect(names(s.cash.rows)).toEqual(["Ziraat TRY", "Wise USD", "EUR Savings", "Cash drawer"]);
    expect(names(s.cryptoGold.rows)).toEqual(["Cold Wallet", "Gram Gold", "Coins"]);
    expect(names(s.cards.rows)).toEqual(["Bonus Card", "Idle Card"]);
    expect(names(s.archived)).toEqual(["Old bank"]);
    expect(s.loans.rows.map((l) => l.item.name)).toEqual(["Car loan — Garanti"]);
  });

  it("totals all = computeNetWorth − what the cards are owed, the Dashboard's net worth", () => {
    for (const display of ["USD", "TRY", "EUR"] as Currency[]) {
      const s = sections(input({ display }));
      const dashboard =
        computeNetWorth(accounts, balances, usdPer, display).total - totalOwed(book, accounts, TODAY, usdPer, display);
      expect(s.totals.all).toBe(dashboard);
      // and the sections add up to it: what you hold, less the cards
      expect(s.cash.subtotal! + s.cryptoGold.subtotal! + s.cards.subtotal!).toBeCloseTo(dashboard, 6);
    }
  });

  it("assets are the first two subtotals, the same as computeNetWorth", () => {
    const s = sections(input());
    expect(s.totals.assets).toBe(s.cash.subtotal! + s.cryptoGold.subtotal!);
    expect(s.totals.assets).toBeCloseTo(computeNetWorth(accounts, balances, usdPer, "USD").total, 6);
    // the archived account counts nowhere
    expect(s.cash.subtotal).toBeCloseTo(
      [ziraat, wise, eur, empty].reduce((sum, a) => sum + convert(balances.get(a.id)!, a.currency, "USD", usdPer)!, 0),
      6
    );
  });

  it("converts each subtotal to the display currency", () => {
    const s = sections(input({ display: "TRY" }));
    expect(s.cash.subtotal).toBeCloseTo(
      [ziraat, wise, eur, empty].reduce((sum, a) => sum + convert(balances.get(a.id)!, a.currency, "TRY", usdPer)!, 0),
      6
    );
    const wiseRow = s.cash.rows.find((r) => r.account.id === wise.id)!;
    expect(wiseRow.shown).toEqual({ amount: balances.get(wise.id), currency: "USD" });
    expect(wiseRow.converted).toBe(convert(balances.get(wise.id)!, "USD", "TRY", usdPer));
  });

  it("shows a card at −owed, never its ledger balance", () => {
    const s = sections(input());
    const row = s.cards.rows.find((r) => r.account.id === bonus.id)!;
    const owed = book.owed(bonus.id, TODAY);
    expect(owed).toBeCloseTo(21720.3, 2);
    expect(row.balance).toBe(-owed);
    expect(row.shown).toEqual({ amount: -owed, currency: "TRY" });
    expect(row.card).toMatchObject({ owed, limit: 100000, over: false, paymentDay: 15 });
    expect(row.card!.used).toBeCloseTo(owed / 100000, 6);
    expect(s.cards.subtotal).toBeCloseTo(-totalOwed(book, accounts, TODAY, usdPer, "USD"), 6);
  });

  it("caps a card's bar at its limit and says it's over", () => {
    const tight = { ...bonus, creditLimit: 20000 };
    const list = accounts.map((a) => (a.id === bonus.id ? tight : a));
    const s = sections(input({ accounts: list, book: buildCardBook(list, all) }));
    const card = s.cards.rows.find((r) => r.account.id === bonus.id)!.card!;
    expect(card.used).toBe(1);
    expect(card.over).toBe(true);
    const idle = s.cards.rows.find((r) => r.account.id === idleCard.id)!.card!;
    expect(idle.used).toBeNull();
  });

  it("reads a gold account holding coins in lira, with the same ≈", () => {
    const s = sections(input());
    const row = s.cryptoGold.rows.find((r) => r.account.id === coins.id)!;
    const grams = balances.get(coins.id)!;
    expect(grams).toBeGreaterThan(10);
    expect(row.shown).toEqual({ amount: convert(grams, "XAU_G", "TRY", usdPer), currency: "TRY" });
    expect(row.converted).toBe(convert(grams, "XAU_G", "USD", usdPer));
    // plain gram gold stays in grams
    const plain = s.cryptoGold.rows.find((r) => r.account.id === gram.id)!;
    expect(plain.shown).toEqual({ amount: 36, currency: "XAU_G" });
  });

  it("hides accounts at zero from the rows, never from a subtotal", () => {
    const shown = sections(input());
    const hidden = sections(input({ hideEmpty: true }));
    expect(shown.emptyCount).toBe(2); // the cash drawer and the idle card
    expect(hidden.emptyCount).toBe(2);
    expect(names(hidden.cash.rows)).not.toContain("Cash drawer");
    expect(names(hidden.cards.rows)).toEqual(["Bonus Card"]);
    expect(hidden.cash.subtotal).toBe(shown.cash.subtotal);
    expect(hidden.totals).toEqual(shown.totals);
  });

  it("lists loans from computeDebtOverview, and debts are every loan and card", () => {
    const s = sections(input());
    const debt = input().debt!;
    const loanItem = debt.items.find((i) => i.kind === "loan")!;
    expect(s.loans.rows[0].amount).toBe(-loanItem.outstanding);
    expect(s.loans.rows[0].item.endDate).toBe(loanItem.endDate);
    expect(s.loans.rows[0].converted).toBe(convert(-loanItem.outstanding, "TRY", "USD", usdPer));
    expect(s.totals.debts).toBe(-debt.totalInDisplay);
    expect(s.cards.subtotal! + s.loans.subtotal!).toBeCloseTo(s.totals.debts!, 2);
  });

  it("lists rows before rates arrive, with no subtotal or total", () => {
    const s = sections(input({ usdPer: undefined }));
    expect(s.cash.rows).toHaveLength(4);
    expect(s.cash.subtotal).toBeNull();
    expect(s.cash.rows[0].converted).toBeNull();
    expect(s.totals).toEqual({ all: null, assets: null, debts: null });
    // without a price, coins read in grams
    expect(s.cryptoGold.rows.find((r) => r.account.id === coins.id)!.shown.currency).toBe("XAU_G");
  });

  it("waits for loans: no loan rows and no debts total yet", () => {
    const s = sections(input({ debt: null }));
    expect(s.loans.rows).toEqual([]);
    expect(s.loans.subtotal).toBeNull();
    expect(s.totals.debts).toBeNull();
    expect(s.totals.all).not.toBeNull();
  });
});

describe("segments", () => {
  it("shows the first two sections for assets and the last two for debts", () => {
    expect(SEGMENT_SECTIONS.all).toEqual(["cash", "cryptoGold", "cards", "loans"]);
    expect(SEGMENT_SECTIONS.assets).toEqual(["cash", "cryptoGold"]);
    expect(SEGMENT_SECTIONS.debts).toEqual(["cards", "loans"]);
    expect(PORTFOLIO_SEGMENTS.every(isPortfolioSegment)).toBe(true);
    expect(isPortfolioSegment("net")).toBe(false);
  });
});

describe("adjust balance", () => {
  it("is offered where the Classic button is: not a card, coins or archived", () => {
    expect(canAdjust(ziraat)).toBe(true);
    expect(canAdjust(gram)).toBe(true);
    expect(canAdjust(wallet)).toBe(true);
    expect(canAdjust(bonus)).toBe(false);
    expect(canAdjust(coins)).toBe(false);
    expect(canAdjust(old)).toBe(false);
    expect(isMixedGold(coins)).toBe(true);
    expect(isMixedGold({ ...coins, holdings: [] })).toBe(false);
  });
});

describe("account feed", () => {
  it("lists what's planned oldest first and the completed rows apart", () => {
    const { upcoming, completed } = accountFeed(all, ziraat.id);
    expect(upcoming.map((t) => t.description)).toEqual(["Internet", "Dentist", "Rent"]);
    expect(completed.every((t) => t.accountId === ziraat.id && t.status === "completed")).toBe(true);
    expect(completed.map((t) => t.description)).toContain("EFT fee");
    expect(completed).toHaveLength(6);
    expect(accountFeed(all, wise.id).upcoming).toEqual([]);
  });
});

describe("small helpers", () => {
  it("writes a payment day as the Classic page does", () => {
    expect(ordinal(1, "en")).toBe("1st");
    expect(ordinal(2, "en")).toBe("2nd");
    expect(ordinal(3, "en")).toBe("3rd");
    expect(ordinal(11, "en")).toBe("11th");
    expect(ordinal(15, "en")).toBe("15th");
    expect(ordinal(22, "en")).toBe("22nd");
    expect(ordinal(15, "tr")).toBe("15.");
  });

  it("restores only a real scroll offset", () => {
    expect(parseScroll(null)).toBeNull();
    expect(parseScroll("0")).toBeNull();
    expect(parseScroll("abc")).toBeNull();
    expect(parseScroll("812.5")).toBe(813);
  });
});
