import { describe, expect, it } from "vitest";
import { Account, Transaction, VictvsSession } from "@/lib/data/types";
import { checkData } from "../dataCheck";

const account = (id: string, overrides: Partial<Account> = {}): Account => ({
  id,
  name: id,
  currency: "TRY",
  kind: "fiat",
  openingBalance: 0,
  archived: false,
  paymentAccountId: null,
  paymentDay: null,
  creditLimit: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
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
    status: "completed",
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
    createdAt: `2026-01-01T00:00:${String(seq % 60).padStart(2, "0")}.000Z`,
    ...overrides,
  };
}

const TODAY = "2026-10-28";
const enparaTry = account("enparaTry");
const akbank = account("akbank", { kind: "credit_card", paymentAccountId: "enparaTry", paymentDay: 16 });
const garanti = account("garanti", { kind: "credit_card", paymentDay: 10, name: "CC Tansu Garanti" });
const tazminat = account("tazminat", { archived: true });
const accounts = [enparaTry, akbank, garanti, tazminat];

describe("checkData, on the shapes found in a real backup", () => {
  it("finds the old recurring copy of a big purchase's installment, and offers to delete it", () => {
    const own = tx("akbank", "2026-10-15", 11062.43, { purchaseId: "akkiz", description: "Semoş AkKız 100k  (2/12)" });
    const copy = tx("akbank", "2026-10-15", 11062.43, { description: "Semoş AkKız 100k neziroğlu" });
    const oldCopy = tx("akbank", "2026-09-15", 11062.43, { description: "Semoş AkKız 100k neziroğlu", legacy: true });
    const ownSep = tx("akbank", "2026-09-15", 11062.43, { purchaseId: "akkiz", legacy: true });
    const issues = checkData({ accounts, transactions: [own, copy, oldCopy, ownSep], today: TODAY }).filter(
      (i) => i.kind === "duplicateInstallment"
    );
    expect(issues.map((i) => [i.txs[0].id, i.severity, i.fix])).toEqual([
      [copy.id, "fix", { kind: "delete", txIds: [copy.id] }],
      [oldCopy.id, "tidy", { kind: "delete", txIds: [oldCopy.id] }],
    ]);
  });

  it("finds a row completed ahead of its date, and the same row entered twice", () => {
    const ahead = tx("enparaTry", "2026-12-15", 5256.46, { description: "draft December - Semoş CC" });
    const a = tx("enparaTry", "2026-11-15", 100, { status: "planned", description: "Gym" });
    const b = tx("enparaTry", "2026-11-15", 100, { status: "planned", description: "gym " });
    const issues = checkData({ accounts, transactions: [ahead, a, b], today: TODAY });
    expect(issues.find((i) => i.kind === "completedInFuture")?.fix).toEqual({ kind: "reopen", txId: ahead.id });
    expect(issues.find((i) => i.kind === "exactDuplicate")?.fix).toEqual({ kind: "delete", txIds: [b.id] });
  });

  it("finds half-done and mismatched card payments, and one-sided transfers on open accounts only", () => {
    const paying = tx("enparaTry", "2026-08-17", 62724.78, { transferGroupId: "aug", description: "CC Akbank statement" });
    const landing = tx("akbank", "2026-08-17", 62624.44, { transferGroupId: "aug", direction: "income", status: "planned" });
    const lonely = tx("garanti", "2026-08-06", 8974.79, { transferGroupId: "solo", direction: "income" });
    const closed = tx("tazminat", "2026-08-07", 31963.03, { transferGroupId: "gone" });
    const issues = checkData({ accounts, transactions: [paying, landing, lonely, closed], today: TODAY });
    const half = issues.find((i) => i.kind === "halfDoneTransfer")!;
    expect(half.fix).toEqual({ kind: "complete", txIds: [landing.id] });
    expect(issues.find((i) => i.kind === "legsDontMatch")?.amount).toBeCloseTo(100.34, 2);
    const oneSided = issues.filter((i) => i.kind === "oneSidedTransfer");
    expect(oneSided.map((i) => i.txs[0].id)).toEqual([lonely.id]);
  });

  it("suggests the account a card has always been paid from", () => {
    const pay = (date: string) => [
      tx("enparaTry", date, 1000, { transferGroupId: `g${date}` }),
      tx("garanti", date, 1000, { transferGroupId: `g${date}`, direction: "income" }),
    ];
    const issues = checkData({ accounts, transactions: [...pay("2026-09-10"), ...pay("2026-10-10")], today: TODAY });
    const payer = issues.find((i) => i.kind === "cardWithoutPayer")!;
    expect(payer.account?.id).toBe("garanti");
    expect(payer.fix).toEqual({ kind: "setPayer", cardId: "garanti", payerId: "enparaTry" });
    // Akbank already says who pays it
    expect(issues.filter((i) => i.kind === "cardWithoutPayer")).toHaveLength(1);
  });

  it("finds installments left planned, sessions unpaid for months, and borrowed money booked as income", () => {
    const ikea = tx("garanti", "2026-10-15", 3188.88, { purchaseId: "ikea", status: "planned" });
    const future = tx("garanti", "2026-11-15", 3188.88, { purchaseId: "ikea", status: "planned" });
    const advance = tx("enparaTry", "2026-10-25", 12500, { direction: "income", description: "enpara %0 nakit avans 12.5k" });
    const salary = tx("enparaTry", "2026-10-05", 2090, { direction: "income", description: "WBL 2026" });
    const debt = tx("enparaTry", "2026-10-01", 50000, { direction: "income", description: "Sinan dayı borç" });
    const session = (date: string, status: VictvsSession["status"]): VictvsSession => ({
      id: `s${date}`,
      date,
      sessionType: "other",
      sessionNo: "",
      amount: 52.5,
      status,
      payoutId: null,
      notes: "",
      source: "manual",
      createdAt: "2026-07-22T00:00:00.000Z",
    });
    const issues = checkData({
      accounts,
      transactions: [ikea, future, advance, salary, debt],
      victvsSessions: [session("2026-07-22", "unpaid"), session("2026-10-19", "unpaid"), session("2026-06-01", "paid")],
      today: TODAY,
    });
    expect(issues.find((i) => i.kind === "installmentStillPlanned")?.fix).toEqual({ kind: "complete", txIds: [ikea.id] });
    expect(issues.find((i) => i.kind === "oldUnpaidSession")?.sessions?.map((s) => s.date)).toEqual(["2026-07-22"]);
    expect(issues.filter((i) => i.kind === "borrowedAsIncome").map((i) => i.txs[0].id)).toEqual([advance.id, debt.id]);
  });

  it("puts what makes the numbers wrong first, and says nothing about a clean ledger", () => {
    const ahead = tx("enparaTry", "2026-12-15", 10);
    const ikea = tx("garanti", "2026-10-15", 3188.88, { purchaseId: "ikea", status: "planned" });
    const issues = checkData({ accounts: [enparaTry, akbank], transactions: [ikea, ahead], today: TODAY });
    expect(issues[0].severity).toBe("fix");
    expect(checkData({ accounts: [enparaTry], transactions: [tx("enparaTry", "2026-10-01", 5)], today: TODAY })).toEqual([]);
  });
});
