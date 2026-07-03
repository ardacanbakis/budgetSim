import { describe, expect, it } from "vitest";
import { parseVictvsPaste } from "../victvsParser";
import { amortizationSchedule, monthlyInstallment } from "../loan";
import { projectCashflow } from "../projector";
import { Account, RecurringTemplate, Transaction } from "@/lib/data/types";
import { UsdPerMap } from "../fx";

describe("parseVictvsPaste", () => {
  it("parses email confirmation lines (CIPS OR/CR + V3 with location noise and start time)", () => {
    const text = [
      "CIPS OR Exam 37324 - Wed 15 Jul 26",
      "CIPS CR Exam 36951 - Tue 21 Jul 26",
      "V3 - ONLINE - 83849, PTS, 788, Jakarta, Indonesia - 08 Jul 26 - 1500",
    ].join("\n");
    const { sessions, errors } = parseVictvsPaste(text);
    expect(errors).toEqual([]);
    expect(sessions).toEqual([
      expect.objectContaining({ date: "2026-07-15", sessionType: "CIPS OR", sessionNo: "37324", amount: null }),
      expect.objectContaining({ date: "2026-07-21", sessionType: "CIPS CR", sessionNo: "36951", amount: null }),
      expect.objectContaining({ date: "2026-07-08", sessionType: "IWCF", sessionNo: "83849", amount: null }),
    ]);
  });

  it("parses tab-separated rows (date, type, session no, amount) with 2- and 4-digit years", () => {
    const text = [
      "21 Jan 26\tCIPS OR Exam \t32138\t37.5",
      "22 Jan 26\tV3 - ONLINE Al Muntazah\t79668\t60",
      "21 Jul 2026\tCIPS CR Exam \t36951\t60",
      "05 Mar 26\tFIFA Session\t41002\t30",
    ].join("\n");
    const { sessions, errors } = parseVictvsPaste(text);
    expect(errors).toEqual([]);
    expect(sessions).toEqual([
      expect.objectContaining({ date: "2026-01-21", sessionType: "CIPS OR", sessionNo: "32138", amount: 37.5 }),
      expect.objectContaining({ date: "2026-01-22", sessionType: "IWCF", sessionNo: "79668", amount: 60 }),
      expect.objectContaining({ date: "2026-07-21", sessionType: "CIPS CR", sessionNo: "36951", amount: 60 }),
      expect.objectContaining({ date: "2026-03-05", sessionType: "FIFA", sessionNo: "41002", amount: 30 }),
    ]);
  });

  it("flags unknown types and broken dates instead of dropping them, ignores headers/empty", () => {
    const text = [
      "",
      "Upcoming sessions:",
      "Pearson VUE thing 12345 - 15 Jul 26",
      "CIPS OR Exam 37324 - 99 Jul 26",
      "CIPS CR Exam 36951",
    ].join("\n");
    const { sessions, errors } = parseVictvsPaste(text);
    expect(sessions).toEqual([]);
    expect(errors).toEqual([
      { line: 3, raw: "Pearson VUE thing 12345 - 15 Jul 26", reason: "no-type" },
      { line: 4, raw: "CIPS OR Exam 37324 - 99 Jul 26", reason: "bad-date" },
      { line: 5, raw: "CIPS CR Exam 36951", reason: "no-date" },
    ]);
  });
});

describe("loan math", () => {
  it("computes annuity installment (known value)", () => {
    // 1,000,000 at 3%/mo for 120 months → r*(1+r)^n/((1+r)^n -1)
    const installment = monthlyInstallment(1_000_000, 3, 120);
    const r = 0.03;
    const f = Math.pow(1.03, 120);
    expect(installment).toBeCloseTo((1_000_000 * r * f) / (f - 1), 6);
    // zero-rate degenerates to straight division
    expect(monthlyInstallment(1200, 0, 12)).toBe(100);
  });

  it("amortizes to exactly zero with rounded payments", () => {
    const result = amortizationSchedule(500_000, 2.5, 24, "2026-07-01", "TRY");
    expect(result.rows).toHaveLength(24);
    expect(result.rows[23].remaining).toBe(0);
    expect(result.rows[0].date).toBe("2026-08-01");
    const paidPrincipal = result.rows.reduce((s, r) => s + r.principalPart, 0);
    expect(paidPrincipal).toBeCloseTo(500_000, 2);
    expect(result.totalPaid).toBeCloseTo(500_000 + result.totalInterest, 2);
    // interest decreases over time
    expect(result.rows[0].interest).toBeGreaterThan(result.rows[23].interest);
  });
});

describe("projectCashflow", () => {
  const accounts: Account[] = [
    {
      id: "usd",
      name: "USD",
      currency: "USD",
      kind: "fiat",
      openingBalance: 1000,
      archived: false,
      paymentAccountId: null,
      createdAt: "2026-01-01",
    },
  ];
  const rates: UsdPerMap = { USD: 1, TRY: 0.025, EUR: 1.1, BTC: 100000, XAU_G: 75 };

  it("projects planned + recurring without double counting materialized items", () => {
    const template: RecurringTemplate = {
      id: "tpl1",
      name: "Salary",
      accountId: "usd",
      direction: "income",
      categoryId: null,
      amount: 2000,
      frequency: "monthly",
      startDate: "2026-07-05",
      endDate: null,
      autoComplete: false,
      loanId: null,
      createdAt: "2026-06-01",
    };
    // July's occurrence is already materialized as a planned tx (amount edited to 2100)
    const txs: Transaction[] = [
      {
        id: "t1",
        accountId: "usd",
        direction: "income",
        categoryId: null,
        amount: 2100,
        status: "planned",
        dueDate: "2026-07-05",
        completedAt: null,
        description: "Salary (adjusted)",
        fxSnapshot: null,
        transferGroupId: null,
        transferMarketRate: null,
        recurringTemplateId: "tpl1",
        loanId: null,
        victvsPayoutId: null,
        purchaseId: null,
        createdAt: "2026-06-20",
      },
    ];
    const result = projectCashflow({
      accounts,
      transactions: txs,
      templates: [template],
      usdPer: rates,
      display: "USD",
      fromDate: "2026-07-01",
      months: 3,
    });
    expect(result.startNetWorth).toBe(1000);
    expect(result.months.map((m) => m.month)).toEqual(["2026-07", "2026-08", "2026-09"]);
    // July uses the materialized 2100, not 2000+2100
    expect(result.months[0].income).toBe(2100);
    expect(result.months[1].income).toBe(2000);
    expect(result.months[2].endNetWorth).toBe(1000 + 2100 + 2000 + 2000);
  });

  it("excludes transfer legs from cashflow", () => {
    const txs: Transaction[] = [
      {
        id: "t2",
        accountId: "usd",
        direction: "expense",
        categoryId: null,
        amount: 500,
        status: "planned",
        dueDate: "2026-07-10",
        completedAt: null,
        description: "move to TRY",
        fxSnapshot: null,
        transferGroupId: "g1",
        transferMarketRate: null,
        recurringTemplateId: null,
        loanId: null,
        victvsPayoutId: null,
        purchaseId: null,
        createdAt: "2026-06-20",
      },
    ];
    const result = projectCashflow({
      accounts,
      transactions: txs,
      templates: [],
      usdPer: rates,
      display: "USD",
      fromDate: "2026-07-01",
      months: 1,
    });
    expect(result.months[0].expense).toBe(0);
  });
});
