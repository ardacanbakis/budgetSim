import { describe, expect, it } from "vitest";
import {
  applyPlan,
  averageMonthlyNet,
  itemHitsMonth,
  itemHorizonTotal,
  PlanItem,
  planMilestones,
} from "../planner";
import { ProjectionMonth, ProjectionResult } from "../projector";

function month(i: number, over: Partial<ProjectionMonth> = {}): ProjectionMonth {
  return {
    month: `2026-${String(i + 1).padStart(2, "0")}`,
    income: 1000,
    expense: 400,
    net: 600,
    endNetWorth: 0,
    expenseByCategory: { groceries: 400 },
    ...over,
  };
}

/** base: 6 months, +600/mo, starting from 10,000 */
function base(months = 6): ProjectionResult {
  let running = 10_000;
  return {
    startNetWorth: 10_000,
    skippedAccountIds: [],
    months: Array.from({ length: months }, (_, i) => {
      running += 600;
      return month(i, { endNetWorth: running });
    }),
  };
}

const item = (over: Partial<PlanItem> = {}): PlanItem => ({
  id: "i1",
  label: "test",
  direction: "income",
  amount: 500,
  frequency: "monthly",
  startMonth: 0,
  durationMonths: null,
  enabled: true,
  ...over,
});

describe("itemHitsMonth", () => {
  it("respects start, duration and frequency", () => {
    const monthly = item({ startMonth: 2, durationMonths: 3 });
    expect([0, 1, 2, 3, 4, 5].map((i) => itemHitsMonth(monthly, i))).toEqual([
      false, false, true, true, true, false,
    ]);

    const once = item({ frequency: "once", startMonth: 1 });
    expect([0, 1, 2].map((i) => itemHitsMonth(once, i))).toEqual([false, true, false]);

    const yearly = item({ frequency: "yearly", startMonth: 0 });
    expect([0, 11, 12, 24].map((i) => itemHitsMonth(yearly, i))).toEqual([true, false, true, true]);
  });

  it("runs to the horizon when duration is null", () => {
    expect(itemHorizonTotal(item({ amount: 100 }), 120)).toBe(12_000);
    // a 120-month mortgage inside a 60-month view only charges 60 times
    expect(itemHorizonTotal(item({ amount: 100, durationMonths: 120 }), 60)).toBe(6_000);
  });
});

describe("applyPlan", () => {
  it("returns the base untouched when nothing is enabled", () => {
    const b = base();
    expect(applyPlan(b, { items: [], budgets: [] })).toBe(b);
    expect(applyPlan(b, { items: [item({ enabled: false })], budgets: [] })).toBe(b);
  });

  it("adds a second salary and compounds it into net worth", () => {
    const result = applyPlan(base(3), { items: [item({ amount: 500 })], budgets: [] });
    expect(result.months.map((m) => m.income)).toEqual([1500, 1500, 1500]);
    expect(result.months.map((m) => m.net)).toEqual([1100, 1100, 1100]);
    expect(result.months.map((m) => m.endNetWorth)).toEqual([11_100, 12_200, 13_300]);
  });

  it("charges a mortgage only while it runs", () => {
    const mortgage = item({ direction: "expense", amount: 300, startMonth: 1, durationMonths: 2 });
    const result = applyPlan(base(4), { items: [mortgage], budgets: [] });
    expect(result.months.map((m) => m.expense)).toEqual([400, 700, 700, 400]);
  });

  it("a budget replaces that category's projected spend instead of stacking on it", () => {
    // base projects 400/mo of groceries; assuming 1000 should move expense by +600, not +1000
    const result = applyPlan(base(2), {
      items: [],
      budgets: [{ categoryId: "groceries", monthlyAmount: 1000, enabled: true }],
    });
    expect(result.months.map((m) => m.expense)).toEqual([1000, 1000]);
    expect(result.months[0].expenseByCategory.groceries).toBe(1000);
    expect(result.months.map((m) => m.net)).toEqual([0, 0]);
  });

  it("a budget for a category with no projected spend adds it", () => {
    const result = applyPlan(base(1), {
      items: [],
      budgets: [{ categoryId: "bills", monthlyAmount: 250, enabled: true }],
    });
    expect(result.months[0].expense).toBe(650);
  });

  it("combines budgets and items", () => {
    const result = applyPlan(base(1), {
      items: [item({ amount: 500 })],
      budgets: [{ categoryId: "groceries", monthlyAmount: 900, enabled: true }],
    });
    expect(result.months[0].income).toBe(1500);
    expect(result.months[0].expense).toBe(900);
    expect(result.months[0].net).toBe(600);
  });
});

describe("summaries", () => {
  it("reports year milestones inside the horizon only", () => {
    const result = applyPlan(base(30), { items: [], budgets: [] });
    expect(planMilestones(result).map((m) => m.label)).toEqual(["1y", "2y"]);
    expect(planMilestones(result)[0].netWorth).toBe(10_000 + 600 * 12);
  });

  it("averages the monthly net", () => {
    expect(averageMonthlyNet(base(6))).toBe(600);
    expect(averageMonthlyNet({ startNetWorth: 0, months: [], skippedAccountIds: [] })).toBe(0);
  });
});
