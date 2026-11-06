import { describe, expect, it } from "vitest";
import { Account, CardEstimate, Loan, Transaction, VictvsSession } from "@/lib/data/types";
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

  // the shape behind "I changed the card's pay-from but the payment is still
  // on the old account": settings don't reach back into the ledger
  describe("a card payment drawn from an account that isn't the card's payer", () => {
    const payment = (from: string, status: Transaction["status"], group = "g1") => [
      tx(from, "2026-11-16", 25299.04, { status, transferGroupId: group, description: "CC Akbank statement" }),
      tx("akbank", "2026-11-16", 25299.04, { status, transferGroupId: group, direction: "income", description: "CC Akbank statement" }),
    ];
    const semos = account("semosIs", { name: "Semoş İŞ" });
    const all = [...accounts, semos];

    it("flags one still to be made, and offers to move it to the payer", () => {
      const [paying, landing] = payment("semosIs", "planned");
      const found = checkData({ accounts: all, transactions: [paying, landing], today: TODAY }).filter(
        (i) => i.kind === "paymentFromWrongAccount"
      );
      expect(found).toHaveLength(1);
      expect(found[0].severity).toBe("fix");
      expect(found[0].account?.id).toBe("akbank");
      expect(found[0].other?.id).toBe("enparaTry");
      expect(found[0].fix).toEqual({ kind: "moveLeg", txId: paying.id, accountId: "enparaTry" });
    });

    it("leaves a payment already made alone: the money really did come from there", () => {
      const legs = payment("semosIs", "completed");
      expect(checkData({ accounts: all, transactions: legs, today: TODAY }).filter((i) => i.kind === "paymentFromWrongAccount")).toEqual(
        []
      );
    });

    it("says nothing when the payment already comes from the payer, or the card has none", () => {
      const right = payment("enparaTry", "planned");
      const noPayer = payment("enparaTry", "planned", "g2").map((l) =>
        l.accountId === "akbank" ? { ...l, accountId: "garanti" } : l
      );
      const issues = checkData({ accounts: all, transactions: [...right, ...noPayer], today: TODAY });
      expect(issues.filter((i) => i.kind === "paymentFromWrongAccount")).toEqual([]);
    });
  });

  describe("the settings a plan silently depends on", () => {
    const estimate = (accountId: string, month: string, amount: number, notedOn: string): CardEstimate => ({
      id: `${accountId}-${month}-${notedOn}`,
      accountId,
      month,
      amount,
      notedOn,
      createdAt: `${notedOn}T00:00:00.000Z`,
    });
    const loan = (o: Partial<Loan> = {}): Loan => ({
      id: "l1",
      name: "Goku",
      kind: "personal",
      currency: "TRY",
      principal: 30000,
      monthlyRatePct: 0,
      termMonths: 1,
      startDate: "2026-10-16",
      installment: 0,
      scheduleKind: "lumpSum",
      kkdfPct: 0,
      bsmvPct: 0,
      customInstalments: null,
      recurringTemplateId: null,
      direction: "owe",
      counterparty: "Goku",
      depositAccountId: null,
      payAccountId: "enparaTry",
      payoffDate: null,
      purchaseId: null,
      createdAt: "2026-10-16T00:00:00.000Z",
      ...o,
    });

    it("flags expectations the months ahead still run on, noted long ago", () => {
      const old = [estimate("akbank", "2026-11", 35000, "2026-08-01"), estimate("akbank", "2026-12", 16000, "2026-08-01")];
      const found = checkData({ accounts, transactions: [], cardEstimates: old, today: TODAY }).filter((i) => i.kind === "staleEstimate");
      expect(found).toHaveLength(1);
      expect(found[0].account?.id).toBe("akbank");
      expect(found[0].date).toBe("2026-08-01");
    });

    it("leaves a fresh expectation alone, and never minds a month already past", () => {
      const fresh = [estimate("akbank", "2026-11", 35000, "2026-10-30")];
      const past = [estimate("akbank", "2026-01", 35000, "2026-01-02")];
      expect(checkData({ accounts, transactions: [], cardEstimates: fresh, today: TODAY }).some((i) => i.kind === "staleEstimate")).toBe(false);
      expect(checkData({ accounts, transactions: [], cardEstimates: past, today: TODAY }).some((i) => i.kind === "staleEstimate")).toBe(false);
    });

    it("flags a debt repaid in one go with no date, since no plan can show it going", () => {
      const found = checkData({ accounts, transactions: [], loans: [loan()], today: TODAY }).filter((i) => i.kind === "debtWithoutDate");
      expect(found).toHaveLength(1);
      expect(found[0].loan?.id).toBe("l1");
      expect(found[0].amount).toBe(30000);
      // one with a date, one lent rather than owed, and one on a schedule: all fine
      const quiet = [loan({ id: "l2", payoffDate: "2027-02-28" }), loan({ id: "l3", direction: "lent" }), loan({ id: "l4", scheduleKind: "zeroInterest" })];
      expect(checkData({ accounts, transactions: [], loans: quiet, today: TODAY }).some((i) => i.kind === "debtWithoutDate")).toBe(false);
    });

    it("flags a card with no limit, so the room-left bars can say why they're missing", () => {
      const limited = account("akbank", { kind: "credit_card", paymentAccountId: "enparaTry", paymentDay: 16, creditLimit: 100000 });
      const found = checkData({ accounts: [enparaTry, limited, garanti], transactions: [], today: TODAY }).filter(
        (i) => i.kind === "cardWithoutLimit"
      );
      expect(found.map((i) => i.account?.id)).toEqual(["garanti"]);
      // an archived card is nobody's problem
      const retired = account("old", { kind: "credit_card", archived: true });
      expect(
        checkData({ accounts: [enparaTry, limited, retired], transactions: [], today: TODAY }).some((i) => i.kind === "cardWithoutLimit")
      ).toBe(false);
    });

    it("flags a statement that came out far from what it was expected to be", () => {
      const legs = [
        tx("enparaTry", "2026-10-16", 45534.22, { status: "completed", transferGroupId: "g", description: "CC Akbank statement" }),
        tx("akbank", "2026-10-16", 45534.22, { status: "completed", transferGroupId: "g", direction: "income" }),
      ];
      const est = [estimate("akbank", "2026-10", 20000, "2026-10-01")];
      const found = checkData({ accounts, transactions: legs, cardEstimates: est, today: TODAY }).filter((i) => i.kind === "paymentOffEstimate");
      expect(found).toHaveLength(1);
      expect(found[0].amount).toBeCloseTo(25534.22, 2);

      // within a quarter, or small in absolute terms: not worth saying
      const close = [estimate("akbank", "2026-10", 44000, "2026-10-01")];
      expect(
        checkData({ accounts, transactions: legs, cardEstimates: close, today: TODAY }).some((i) => i.kind === "paymentOffEstimate")
      ).toBe(false);
    });

    it("says nothing about any of this when it isn't given the data", () => {
      const kinds = checkData({ accounts: [enparaTry, akbank], transactions: [], today: TODAY }).map((i) => i.kind);
      expect(kinds).not.toContain("staleEstimate");
      expect(kinds).not.toContain("debtWithoutDate");
      expect(kinds).not.toContain("paymentOffEstimate");
    });
  });

  it("puts what makes the numbers wrong first, and says nothing about a clean ledger", () => {
    const ahead = tx("enparaTry", "2026-12-15", 10);
    const ikea = tx("garanti", "2026-10-15", 3188.88, { purchaseId: "ikea", status: "planned" });
    const issues = checkData({ accounts: [enparaTry, akbank], transactions: [ikea, ahead], today: TODAY });
    expect(issues[0].severity).toBe("fix");
    expect(checkData({ accounts: [enparaTry], transactions: [tx("enparaTry", "2026-10-01", 5)], today: TODAY })).toEqual([]);
  });
});
