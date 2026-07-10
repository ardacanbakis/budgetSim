import { describe, expect, it } from "vitest";
import { projectWithScenario, ProjectionInputs } from "../scenarios";
import { projectCashflow } from "../projector";
import { deflateTryToLatest, TUIK_CPI_INDEX, latestCpiMonth } from "@/lib/data/inflation";
import { Account, RecurringTemplate } from "@/lib/data/types";
import { UsdPerMap } from "../fx";

const rates: UsdPerMap = { USD: 1, TRY: 0.025, EUR: 1.1, BTC: 100000, XAU_G: 75 };

const usdAccount: Account = {
  id: "usd",
  name: "USD",
  currency: "USD",
  kind: "fiat",
  openingBalance: 1000,
  archived: false,
  paymentAccountId: null, paymentDay: null,
  createdAt: "2026-01-01",
};
const tryAccount: Account = { ...usdAccount, id: "try", name: "TRY", currency: "TRY", openingBalance: 40000 };

const salaryTemplate: RecurringTemplate = {
  id: "tpl-salary",
  name: "Salary",
  accountId: "usd",
  direction: "income",
  categoryId: "cat-victvs",
  amount: 1000,
  frequency: "monthly",
  startDate: "2026-07-05",
  endDate: null,
  autoComplete: false,
  loanId: null,
  createdAt: "2026-01-01",
};

const baseInputs: ProjectionInputs = {
  accounts: [usdAccount, tryAccount],
  transactions: [],
  templates: [salaryTemplate],
  usdPer: rates,
  display: "USD",
  fromDate: "2026-07-01",
  months: 3,
};

describe("projectWithScenario", () => {
  it("loseIncome removes that category's income from the projection", () => {
    const base = projectCashflow(baseInputs);
    const scenario = projectWithScenario(baseInputs, { type: "loseIncome", categoryId: "cat-victvs" });
    expect(base.months[0].income).toBe(1000);
    expect(scenario.months[0].income).toBe(0);
    expect(scenario.months[2].endNetWorth).toBe(base.months[2].endNetWorth - 3000);
  });

  it("tryDevaluation shrinks TRY balances in the display currency", () => {
    const base = projectCashflow(baseInputs);
    const scenario = projectWithScenario(baseInputs, { type: "tryDevaluation", pct: 20 });
    // 40,000 TRY worth $1000 at base; -20% → $800
    expect(base.startNetWorth).toBe(2000);
    expect(scenario.startNetWorth).toBe(1800);
  });

  it("oneOffExpense dents the chosen month and everything after", () => {
    const base = projectCashflow(baseInputs);
    const scenario = projectWithScenario(baseInputs, { type: "oneOffExpense", amount: 500, monthOffset: 1 });
    expect(scenario.months[0].endNetWorth).toBe(base.months[0].endNetWorth);
    expect(scenario.months[1].expense).toBe(base.months[1].expense + 500);
    expect(scenario.months[1].endNetWorth).toBe(base.months[1].endNetWorth - 500);
    expect(scenario.months[2].endNetWorth).toBe(base.months[2].endNetWorth - 500);
  });
});

describe("inflation deflator", () => {
  it("deflates older lira into latest-month lira", () => {
    const latest = latestCpiMonth();
    expect(deflateTryToLatest(1000, latest)).toBe(1000);
    const older = deflateTryToLatest(1000, "2024-06");
    expect(older).toBeCloseTo(1000 * (TUIK_CPI_INDEX[latest] / TUIK_CPI_INDEX["2024-06"]), 6);
    expect(older).toBeGreaterThan(1500); // that much inflation happened
  });

  it("clamps months outside the series", () => {
    expect(deflateTryToLatest(100, "2020-01")).toBe(deflateTryToLatest(100, "2024-01"));
    expect(deflateTryToLatest(100, "2030-01")).toBe(100);
  });
});
