import { describe, expect, it } from "vitest";
import { Account, Transaction } from "@/lib/data/types";
import { buildCardBook } from "@/lib/domain/cards";
import { UsdPerMap } from "@/lib/domain/fx";
import { dashboardAccountRows, DashboardAccountsInput } from "../dashboardAccounts";

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
    id: `t${seq}`,
    accountId,
    direction: "expense",
    categoryId: null,
    amount,
    dueDate,
    status: "completed",
    description: "",
    recurringTemplateId: null,
    transferGroupId: null,
    fxSnapshot: null,
    createdAt: `2026-01-01T00:00:${String(seq).padStart(2, "0")}.000Z`,
    ...overrides,
  } as Transaction;
}

const usdPer: UsdPerMap = { USD: 1, TRY: 1 / 40, EUR: 1 / 0.9, BTC: 60000, XAU_G: 100 };
const today = "2026-10-16";

// a bank ($500), a dollar account ($900), coins (10 g = $1,000 = ₺40,000),
// an empty account, an archived one, a card owing ₺800, a card owing nothing
// and a card in credit after a refund
const bank = account("bank", "fiat", { name: "Bank" });
const wise = account("wise", "fiat", { currency: "USD", name: "Wise" });
const coins = account("coins", "gold", { currency: "XAU_G", name: "Coins", holdings: [{ type: "ceyrek", qty: 2 }] } as Partial<Account>);
const zero = account("zero", "fiat", { name: "Zero" });
const old = account("old", "fiat", { archived: true, name: "Old" });
const card = account("card", "credit_card", { name: "Card" });
const idle = account("idle", "credit_card", { name: "Idle" });
const refunded = account("refunded", "credit_card", { name: "Refunded" });
const accounts = [bank, wise, coins, zero, old, card, idle, refunded];
const ledger = [tx("card", "2026-10-02", 800), tx("refunded", "2026-10-03", 120, { direction: "income" })];

const input: DashboardAccountsInput = {
  accounts,
  balances: new Map([
    ["bank", 20000],
    ["wise", 900],
    ["coins", 10],
    ["zero", 0],
    ["old", 999999],
    ["card", -800],
    ["refunded", 120],
  ]),
  book: buildCardBook(accounts, ledger),
  usdPer,
  display: "USD",
  today,
};

const ids = (r: ReturnType<typeof dashboardAccountRows>) => r.rows.map((l) => l.account.id);
const none = { hidden: [], hideEmpty: false };

describe("dashboardAccountRows", () => {
  it("lists open accounts by display value, cards last, archived never", () => {
    const result = dashboardAccountRows(input, none);
    // the card owing ₺800 ($20) comes before the one in credit by ₺120 ($3)
    expect(ids(result)).toEqual(["coins", "wise", "bank", "zero", "card", "refunded", "idle"]);
    expect(result).toMatchObject({ hiddenCount: 0, emptyHidden: 0, overflow: 0 });
  });

  it("shows a card as what it's owed, and mixed gold in lira", () => {
    const rows = dashboardAccountRows(input, none).rows;
    const byId = new Map(rows.map((l) => [l.account.id, l]));
    expect(byId.get("card")!.shown).toEqual({ amount: -800, currency: "TRY" });
    expect(byId.get("refunded")!.shown).toEqual({ amount: 120, currency: "TRY" });
    expect(byId.get("coins")!.shown.currency).toBe("TRY");
    expect(byId.get("coins")!.shown.amount).toBeCloseTo(40000, 6);
    expect(byId.get("coins")!.converted).toBeCloseTo(1000, 6);
  });

  it("leaves out the accounts on the deny-list, and counts them", () => {
    const result = dashboardAccountRows(input, { hidden: ["wise", "card", "gone"], hideEmpty: false });
    expect(ids(result)).toEqual(["coins", "bank", "zero", "refunded", "idle"]);
    expect(result.hiddenCount).toBe(2);
  });

  it("hides empty accounts by Portfolio's rule: a card owing nothing is empty, one in credit isn't", () => {
    const result = dashboardAccountRows(input, { hidden: [], hideEmpty: true });
    expect(ids(result)).toEqual(["coins", "wise", "bank", "card", "refunded"]);
    expect(result.emptyHidden).toBe(2);
    // an empty account that's hidden anyway counts once, as hidden
    const both = dashboardAccountRows(input, { hidden: ["zero"], hideEmpty: true });
    expect(both).toMatchObject({ hiddenCount: 1, emptyHidden: 1 });
  });

  it("cuts the list at the limit and says how many more there are", () => {
    const result = dashboardAccountRows(input, { hidden: ["idle"], hideEmpty: false }, 3);
    expect(ids(result)).toEqual(["coins", "wise", "bank"]);
    expect(result).toMatchObject({ overflow: 3, hiddenCount: 1 });
    expect(dashboardAccountRows(input, none, 50).overflow).toBe(0);
  });

  it("keeps working without rates: native figures, unrated rows by name", () => {
    const rows = dashboardAccountRows({ ...input, usdPer: undefined }, none).rows;
    expect(rows.map((l) => [l.account.id, l.shown.currency, l.converted])).toEqual([
      ["bank", "TRY", null],
      ["coins", "XAU_G", null],
      ["wise", "USD", null],
      ["zero", "TRY", null],
      ["card", "TRY", null],
      ["idle", "TRY", null],
      ["refunded", "TRY", null],
    ]);
  });
});
