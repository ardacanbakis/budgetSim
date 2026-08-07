import { describe, expect, it } from "vitest";
import { monthlyInstallment } from "../loan";
import { PlanLoan, planLoanFlows, planLoanSummary } from "../planner";

const loan = (over: Partial<PlanLoan> = {}): PlanLoan => ({
  id: "l1",
  label: "Car loan",
  principal: 100_000,
  currency: "TRY",
  monthlyRatePct: 2.89,
  termMonths: 24,
  receivedMonth: "2026-09",
  firstPaymentMonth: "2026-10",
  accountId: null,
  enabled: true,
  ...over,
});

describe("planLoanSummary", () => {
  it("agrees with the amortization math the Debt page uses", () => {
    const s = planLoanSummary(loan());
    expect(s.installment).toBeCloseTo(monthlyInstallment(100_000, 2.89, 24), 6);
  });

  it("costs principal plus interest, and nothing else", () => {
    const s = planLoanSummary(loan());
    expect(s.totalPaid).toBeCloseTo(s.installment * 24, 6);
    expect(s.totalInterest).toBeCloseTo(s.totalPaid - 100_000, 6);
    // ₺100k over 24 months at 2.89%/month is expensive, and should look it
    expect(s.totalInterest).toBeGreaterThan(35_000);
  });

  it("compounds the monthly rate into the annual one you'd compare", () => {
    // 2.89%/month is nowhere near 34.68%/year once it compounds
    expect(planLoanSummary(loan()).annualRatePct).toBeCloseTo(40.79, 1);
  });

  it("ends on the last installment, not a month later", () => {
    expect(planLoanSummary(loan()).lastPaymentMonth).toBe("2028-09");
    expect(planLoanSummary(loan({ termMonths: 1 })).lastPaymentMonth).toBe("2026-10");
  });

  it("charges no interest at zero rate", () => {
    const s = planLoanSummary(loan({ monthlyRatePct: 0 }));
    expect(s.installment).toBeCloseTo(100_000 / 24, 6);
    expect(s.totalInterest).toBeCloseTo(0, 6);
  });
});

describe("planLoanFlows", () => {
  it("pays out once, then bills a level installment every month of the term", () => {
    const flows = planLoanFlows(loan({ termMonths: 3 }), 12, "2026-08");
    const income = flows.filter((f) => f.direction === "income");
    const expense = flows.filter((f) => f.direction === "expense");

    expect(income).toHaveLength(1);
    expect(income[0]).toMatchObject({ monthOffset: 1, amount: 100_000, currency: "TRY" });

    expect(expense).toHaveLength(3);
    expect(expense.map((f) => f.monthOffset)).toEqual([2, 3, 4]);
    expect(new Set(expense.map((f) => f.amount)).size).toBe(1);
  });

  it("routes both sides to the account you named", () => {
    const flows = planLoanFlows(loan({ accountId: "garanti", termMonths: 2 }), 12, "2026-08");
    expect(flows.every((f) => f.accountId === "garanti")).toBe(true);
  });

  it("drops the payout but keeps the payments for a loan you already carry", () => {
    // drawn down last year; the horizon starts mid-term
    const flows = planLoanFlows(
      loan({ receivedMonth: "2025-01", firstPaymentMonth: "2025-02", termMonths: 24 }),
      12,
      "2026-08"
    );
    expect(flows.some((f) => f.direction === "income")).toBe(false);
    // Feb 2025 + 24 runs to Jan 2027, so six installments fall inside the year
    expect(flows).toHaveLength(6);
    expect(flows[0].monthOffset).toBe(0);
    expect(flows.at(-1)!.monthOffset).toBe(5);
  });

  it("stops at the end of the horizon rather than running past it", () => {
    const flows = planLoanFlows(loan({ termMonths: 120 }), 6, "2026-08");
    expect(flows.every((f) => f.monthOffset < 6)).toBe(true);
  });

  it("says nothing when it's switched off, empty or has no term", () => {
    expect(planLoanFlows(loan({ enabled: false }), 12, "2026-08")).toEqual([]);
    expect(planLoanFlows(loan({ principal: 0 }), 12, "2026-08")).toEqual([]);
    expect(planLoanFlows(loan({ termMonths: 0 }), 12, "2026-08")).toEqual([]);
  });

  it("keeps the installment flat, because a fixed-rate loan is a fixed number", () => {
    // the point of borrowing in a weakening currency: the payment doesn't
    // re-price even though everything you earn does
    const flows = planLoanFlows(loan({ termMonths: 12 }), 24, "2026-09")
      .filter((f) => f.direction === "expense")
      .map((f) => f.amount);
    expect(Math.max(...flows) - Math.min(...flows)).toBeCloseTo(0, 9);
  });
});
