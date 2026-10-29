import { describe, expect, it } from "vitest";
import { Account, Loan, Transaction } from "@/lib/data/types";
import { buildCardBook, isIncome, isSpending } from "../cards";
import { computeDebtOverview, loanProgress, replanRepayments } from "../debt";
import { suggestPayoff } from "../debtPayoff";
import { UsdPerMap } from "../fx";
import { buildSchedule } from "../loanSchedule";

const usdPer: UsdPerMap = { USD: 1, TRY: 1 / 40, EUR: 1.1, BTC: 100000, XAU_G: 80 };

function account(id: string, currency: Account["currency"], kind: Account["kind"] = "fiat", openingBalance = 0): Account {
  return { id, name: id, currency, kind, openingBalance, archived: false, paymentAccountId: null, paymentDay: null, createdAt: "2026-01-01" };
}

let seq = 0;
function tx(partial: Partial<Transaction> & Pick<Transaction, "accountId" | "direction" | "amount">): Transaction {
  seq++;
  return {
    id: `t${seq}`,
    categoryId: null,
    status: "completed",
    dueDate: "2026-06-01",
    completedAt: "2026-06-01T10:00:00Z",
    description: "",
    fxSnapshot: null,
    transferGroupId: null,
    transferMarketRate: null,
    recurringTemplateId: null,
    loanId: null,
    victvsPayoutId: null,
    purchaseId: null,
    legacy: false,
    createdAt: "2026-06-01",
    ...partial,
  };
}

function debt(partial: Partial<Loan>): Loan {
  return {
    id: "d1",
    name: "Ahmet",
    kind: "personal",
    currency: "TRY",
    principal: 12500,
    monthlyRatePct: 0,
    termMonths: 1,
    startDate: "2026-09-01",
    installment: 0,
    scheduleKind: "lumpSum",
    kkdfPct: 0,
    bsmvPct: 0,
    customInstalments: null,
    recurringTemplateId: null,
    direction: "owe",
    counterparty: "Ahmet",
    depositAccountId: "try",
    payAccountId: "try",
    payoffDate: null,
    createdAt: "2026-09-01",
    ...partial,
  };
}

describe("a debt repaid in one payment (lumpSum)", () => {
  it("has one row on the payoff date, with simple interest for the months it ran; none without a date", () => {
    const base = { kind: "lumpSum" as const, principal: 10000, monthlyRatePct: 0, termMonths: 1, startDate: "2026-01-15", currency: "TRY" as const, kkdfPct: 0, bsmvPct: 0 };
    expect(buildSchedule({ ...base, payoffDate: null }).rows).toHaveLength(0);
    const plain = buildSchedule({ ...base, payoffDate: "2026-06-30" });
    expect(plain.rows).toEqual([expect.objectContaining({ n: 1, date: "2026-06-30", payment: 10000, remaining: 0 })]);
    // 2%/month for five whole months: 10,000 + 1,000
    const withInterest = buildSchedule({ ...base, monthlyRatePct: 2, payoffDate: "2026-06-30" });
    expect(withInterest.rows[0].payment).toBe(11000);
    expect(withInterest.totalInterest).toBe(1000);
  });
});

describe("loanProgress, from amounts paid", () => {
  it("counts a partial payment as it was, and the rest is what's left", () => {
    const loan = debt({});
    const rows = [
      tx({ accountId: "try", direction: "income", amount: 12500, loanId: "d1", loanPrincipal: true, dueDate: "2026-09-01" }),
      tx({ accountId: "try", direction: "expense", amount: 5000, loanId: "d1", dueDate: "2026-10-10" }),
    ];
    const p = loanProgress(loan, rows);
    // the money borrowed isn't a repayment
    expect(p.paidAmount).toBe(5000);
    expect(p.remaining).toBe(7500);
    expect(p.pct).toBe(40);
    expect(p.term).toBe(0);
    expect(p.endDate).toBeNull();
  });

  it("an early payoff that's been paid ends an installment loan", () => {
    const loan = debt({ scheduleKind: "annuity", monthlyRatePct: 3, termMonths: 12, principal: 120000, payoffDate: "2026-12-31" });
    const paid = loanProgress(loan, [tx({ accountId: "try", direction: "expense", amount: 90000, loanId: "d1", dueDate: "2026-12-31" })]);
    expect(paid.remaining).toBe(0);
    expect(paid.pct).toBe(100);
    expect(paid.endDate).toBe("2026-12-31");
  });
});

describe("debts and income", () => {
  it("borrowed money isn't income, lent money isn't spending, money coming back isn't income; repaying a debt is spending", () => {
    const accounts = [account("try", "TRY")];
    const borrowed = tx({ accountId: "try", direction: "income", amount: 12500, loanId: "d1", loanPrincipal: true });
    const repaid = tx({ accountId: "try", direction: "expense", amount: 2000, loanId: "d1" });
    const lent = tx({ accountId: "try", direction: "expense", amount: 3000, loanId: "d2", loanPrincipal: true });
    const back = tx({ accountId: "try", direction: "income", amount: 3000, loanId: "d2" });
    const salary = tx({ accountId: "try", direction: "income", amount: 50000 });
    const book = buildCardBook(accounts, [borrowed, repaid, lent, back, salary]);
    expect(isIncome(borrowed, book)).toBe(false);
    expect(isSpending(borrowed, book)).toBe(false);
    expect(isSpending(repaid, book)).toBe(true);
    expect(isSpending(lent, book)).toBe(false);
    expect(isIncome(back, book)).toBe(false);
    expect(isIncome(salary, book)).toBe(true);
  });
});

describe("computeDebtOverview, both ways", () => {
  it("what you lent is owed to you, not debt", () => {
    const accounts = [account("try", "TRY")];
    const owe = debt({ id: "o", principal: 10000 });
    const lent = debt({ id: "l", direction: "lent", principal: 4000 });
    const overview = computeDebtOverview({ loans: [owe, lent], accounts, balances: new Map(), transactions: [], usdPer, display: "TRY", today: "2026-10-29" });
    expect(overview.totalInDisplay).toBeCloseTo(10000, 6);
    expect(overview.lentInDisplay).toBeCloseTo(4000, 6);
    expect(overview.items.map((i) => [i.id, i.direction])).toEqual([
      ["o", "owe"],
      ["l", "lent"],
    ]);
    // "when I can" has no end to count
    expect(overview.debtFreeDate).toBeNull();
  });
});

describe("replanRepayments", () => {
  const today = "2026-10-29";

  it("one payment: what's still due, on the payoff date, replacing what was planned", () => {
    const loan = debt({ payoffDate: "2027-02-28" });
    const old = tx({ accountId: "try", direction: "expense", amount: 12500, loanId: "d1", status: "planned", dueDate: "2027-01-31" });
    const part = tx({ accountId: "try", direction: "expense", amount: 2500, loanId: "d1", dueDate: "2026-10-01" });
    const plan = replanRepayments(loan, [old, part], today);
    expect(plan.remove).toEqual([old.id]);
    expect(plan.add).toEqual([{ dueDate: "2027-02-28", amount: 10000, description: "Ahmet" }]);
    expect(replanRepayments({ ...loan, payoffDate: null }, [old, part], today).add).toEqual([]);
  });

  it("dated installments: the unpaid ones from today, up to an early payoff, then what's left", () => {
    const loan = debt({ scheduleKind: "equalPrincipal", monthlyRatePct: 0, termMonths: 4, principal: 4000, startDate: "2026-09-15", payoffDate: "2026-12-31" });
    // rows on Oct 15 (paid), Nov 15, Dec 15, Jan 15
    const paid = tx({ accountId: "try", direction: "expense", amount: 1000, loanId: "d1", dueDate: "2026-10-15" });
    const nov = tx({ accountId: "try", direction: "expense", amount: 1000, loanId: "d1", status: "planned", dueDate: "2026-11-15" });
    const plan = replanRepayments(loan, [paid, nov], today);
    expect(plan.remove).toEqual([nov.id]);
    expect(plan.add.map((r) => [r.dueDate, r.amount])).toEqual([
      ["2026-11-15", 1000],
      ["2026-12-15", 1000],
      ["2026-12-31", 1000],
    ]);
  });

  it("a recurring item's installments end the day before the payoff", () => {
    const loan = debt({ scheduleKind: "zeroInterest", termMonths: 12, principal: 12000, startDate: "2026-05-15", recurringTemplateId: "tpl", payoffDate: "2027-01-31" });
    const jan = tx({ accountId: "try", direction: "expense", amount: 1000, loanId: "d1", status: "planned", dueDate: "2027-02-15", recurringTemplateId: "tpl" });
    const dec = tx({ accountId: "try", direction: "expense", amount: 1000, loanId: "d1", status: "planned", dueDate: "2026-12-15", recurringTemplateId: "tpl" });
    const plan = replanRepayments(loan, [jan, dec], today);
    expect(plan.templateEnd).toBe("2027-01-30");
    expect(plan.remove).toEqual([jan.id]);
    // eight of twelve scheduled before Jan 31 (Jun–Jan): four left
    expect(plan.add).toEqual([{ dueDate: "2027-01-31", amount: 4000, description: "Ahmet payoff" }]);
    // without a payoff it runs to the schedule's end again
    expect(replanRepayments({ ...loan, payoffDate: null }, [dec], today).templateEnd).toBe("2027-05-15");
  });
});

describe("suggestPayoff", () => {
  const today = "2026-11-10";
  const accounts = [account("try", "TRY", "fiat", 5000), account("gold", "XAU_G", "gold", 100)];
  // +10,000 on the 15th, −8,000 on the 20th, for a year: +2,000 a month
  const flows: Transaction[] = [];
  for (let i = 0; i < 12; i++) {
    const month = new Date(Date.UTC(2026, 10 + i, 1)).toISOString().slice(0, 7);
    flows.push(tx({ accountId: "try", direction: "income", amount: 10000, status: "planned", dueDate: `${month}-15` }));
    flows.push(tx({ accountId: "try", direction: "expense", amount: 8000, status: "planned", dueDate: `${month}-20` }));
  }
  const input = (loan: Loan, transactions: Transaction[] = flows) => ({
    loan,
    accounts,
    transactions,
    templates: [],
    usdPer,
    display: "TRY" as const,
    today,
    funding: { order: ["try", "gold"], routine: ["try"] },
    threshold: 1000,
  });

  it("the first month it's paid without selling gold, and an earlier one that sells some", () => {
    const loan = debt({ principal: 9000, depositAccountId: null });
    const s = suggestPayoff(input(loan));
    // November ends at 7,000: paying 9,000 then sells gold; December ends at 9,000
    expect(s.withoutSelling).toMatchObject({ month: "2026-12", date: "2026-12-31", amount: 9000, sells: [] });
    expect(s.ifSelling?.month).toBe("2026-11");
    expect(s.ifSelling?.sells).toEqual([expect.objectContaining({ accountId: "gold", currency: "XAU_G" })]);
    expect(s.ifSelling!.sells[0].amount).toBeCloseTo(2000 / 40 / 80, 4);
  });

  it("nothing for a debt someone owes you, or one that's paid", () => {
    expect(suggestPayoff(input(debt({ direction: "lent" })))).toEqual({ withoutSelling: null, ifSelling: null });
    const paid = tx({ accountId: "try", direction: "expense", amount: 12500, loanId: "d1" });
    expect(suggestPayoff(input(debt({}), [...flows, paid]))).toEqual({ withoutSelling: null, ifSelling: null });
  });

  it("an installment loan: its payments before the payoff stay, the payoff is what's left then", () => {
    // 1,000 a month for 12 months from Nov 15, planned as dated rows
    const loan = debt({ scheduleKind: "zeroInterest", termMonths: 12, principal: 12000, startDate: "2026-10-15", depositAccountId: null });
    const rows = Array.from({ length: 12 }, (_, i) =>
      tx({ accountId: "try", direction: "expense", amount: 1000, loanId: "d1", status: "planned", dueDate: `${new Date(Date.UTC(2026, 10 + i, 15)).toISOString().slice(0, 7)}-15` })
    );
    const s = suggestPayoff(input(loan, [...flows, ...rows]));
    expect(s.withoutSelling).not.toBeNull();
    // what's left by the month's end: twelve less those due before it
    const months = Number(s.withoutSelling!.month.slice(5)) - 10 + (s.withoutSelling!.month.startsWith("2027") ? 12 : 0);
    expect(s.withoutSelling!.amount).toBe(12000 - months * 1000);
  });
});
