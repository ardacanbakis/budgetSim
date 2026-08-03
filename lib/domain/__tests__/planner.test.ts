import { describe, expect, it } from "vitest";
import {
  addMonthKey,
  averageMonthlyNet,
  buildRatePath,
  Devaluation,
  itemHitsMonth,
  itemHorizonTotal,
  nominalAmountAt,
  PlanItem,
  planExtraFlows,
  planIsEmpty,
  planMilestones,
  monthsBetween,
  planReplacedCategories,
  retentionFactor,
  NO_FUNDING,
} from "../planner";
import { projectCashflow, ProjectionResult } from "../projector";
import { Account, RecurringTemplate, Transaction } from "@/lib/data/types";
import { UsdPerMap } from "../fx";

const rates: UsdPerMap = { USD: 1, TRY: 0.025, EUR: 1.1, BTC: 100000, XAU_G: 75 };
const off: Devaluation = { enabled: false, pctPerYear: 30 };
const deval30: Devaluation = { enabled: true, pctPerYear: 30 };
const FIRST = "2026-01";

const item = (over: Partial<PlanItem> = {}): PlanItem => ({
  id: "i1",
  label: "test",
  direction: "income",
  amount: 500,
  currency: "USD",
  frequency: "monthly",
  startMonth: "2026-01",
  durationMonths: null,
  inflates: true,
  enabled: true,
  ...over,
});

function account(id: string, currency: Account["currency"], opening: number): Account {
  return {
    id,
    name: id,
    currency,
    kind: currency === "TRY" || currency === "USD" ? "fiat" : "fiat",
    openingBalance: opening,
    archived: false,
    paymentAccountId: null,
    paymentDay: null,
    createdAt: "2026-01-01",
  };
}

const noTx: Transaction[] = [];
const noTpl: RecurringTemplate[] = [];

describe("itemHitsMonth / horizon totals", () => {
  it("respects start, duration and frequency", () => {
    const monthly = item({ durationMonths: 3 });
    expect([0, 1, 2, 3, 4, 5].map((i) => itemHitsMonth(monthly, i, 2))).toEqual([
      false, false, true, true, true, false,
    ]);
    expect([0, 1, 2].map((i) => itemHitsMonth(item({ frequency: "once" }), i, 1))).toEqual([
      false, true, false,
    ]);
    expect([0, 11, 12, 24].map((i) => itemHitsMonth(item({ frequency: "yearly" }), i, 0))).toEqual([
      true, false, true, true,
    ]);
  });

  it("totals over the horizon, capped by duration", () => {
    expect(itemHorizonTotal(item({ amount: 100 }), 120, off, FIRST)).toBe(12_000);
    expect(itemHorizonTotal(item({ amount: 100, durationMonths: 120 }), 60, off, FIRST)).toBe(6_000);
  });

  it("month keys convert to and from offsets", () => {
    expect(monthsBetween("2026-01", "2026-01")).toBe(0);
    expect(monthsBetween("2026-01", "2026-07")).toBe(6);
    expect(monthsBetween("2026-01", "2027-03")).toBe(14);
    expect(monthsBetween("2026-07", "2026-01")).toBe(-6);
    expect(addMonthKey("2026-01", 0)).toBe("2026-01");
    expect(addMonthKey("2026-11", 3)).toBe("2027-02");
    expect(addMonthKey("2026-01", 120)).toBe("2036-01");
  });
});

describe("devaluation maths", () => {
  it("retention compounds annually", () => {
    expect(retentionFactor(deval30, 0)).toBe(1);
    expect(retentionFactor(deval30, 12)).toBeCloseTo(0.7, 10);
    expect(retentionFactor(deval30, 24)).toBeCloseTo(0.49, 10);
    expect(retentionFactor(off, 24)).toBe(1);
  });

  it("builds a rate path that only weakens the lira", () => {
    const path = buildRatePath(rates, deval30)!;
    expect(path(0).TRY).toBeCloseTo(0.025, 10);
    expect(path(12).TRY).toBeCloseTo(0.025 * 0.7, 10);
    expect(path(12).USD).toBe(1);
    expect(path(12).EUR).toBe(1.1);
    expect(buildRatePath(rates, off)).toBeUndefined();
  });

  it("inflating TRY amounts hold their USD value; fixed ones don't", () => {
    // a ₺10,000 grocery bill that re-prices is still worth the same in USD
    const inflated = nominalAmountAt(10_000, "TRY", true, deval30, 12);
    expect(inflated).toBeCloseTo(10_000 / 0.7, 6);
    expect(inflated * 0.025 * 0.7).toBeCloseTo(10_000 * 0.025, 6);

    // a fixed mortgage installment stays ₺10,000 — and gets cheaper in USD
    expect(nominalAmountAt(10_000, "TRY", false, deval30, 12)).toBe(10_000);

    // USD amounts are never inflated
    expect(nominalAmountAt(500, "USD", true, deval30, 24)).toBe(500);
  });
});

describe("planExtraFlows", () => {
  it("emits one flow per hit month, in the item's own currency", () => {
    const flows = planExtraFlows(
      { items: [item({ amount: 900, currency: "TRY", inflates: false, durationMonths: 2 })], budgets: [], devaluation: off, lostIncome: [], funding: NO_FUNDING },
      6,
      FIRST
    );
    expect(flows).toHaveLength(2);
    expect(flows[0]).toMatchObject({ monthOffset: 0, amount: 900, currency: "TRY", direction: "income" });
  });

  it("budgets emit every month and always re-price", () => {
    const flows = planExtraFlows(
      {
        items: [],
        budgets: [{ categoryId: "groceries", label: "Groceries", monthlyAmount: 10_000, currency: "TRY", enabled: true }],
        devaluation: deval30, lostIncome: [], funding: NO_FUNDING,
      },
      13,
      FIRST
    );
    expect(flows).toHaveLength(13);
    expect(flows[0].amount).toBe(10_000);
    expect(flows[12].amount).toBeCloseTo(10_000 / 0.7, 6);
    expect(flows[12].categoryId).toBe("groceries");
  });

  it("skips disabled and zero entries, and reports replaced categories", () => {
    const plan = {
      items: [item({ enabled: false }), item({ id: "z", amount: 0 })],
      budgets: [
        { categoryId: "a", label: "A", monthlyAmount: 100, currency: "TRY" as const, enabled: true },
        { categoryId: "b", label: "B", monthlyAmount: 0, currency: "TRY" as const, enabled: true },
      ],
      devaluation: off, lostIncome: [], funding: NO_FUNDING,
    };
    expect(planExtraFlows(plan, 3, FIRST)).toHaveLength(3); // only budget "a"
    expect([...planReplacedCategories(plan)]).toEqual(["a"]);
    expect(planIsEmpty({ items: [], budgets: [], devaluation: off, lostIncome: [], funding: NO_FUNDING })).toBe(true);
    expect(planIsEmpty({ items: [], budgets: [], devaluation: deval30, lostIncome: [], funding: NO_FUNDING })).toBe(false);
  });
});

describe("projection under devaluation", () => {
  const accounts = [account("try", "TRY", 400_000), account("usd", "USD", 10_000)];

  const project = (over: Partial<Parameters<typeof projectCashflow>[0]> = {}): ProjectionResult =>
    projectCashflow({
      accounts,
      transactions: noTx,
      templates: noTpl,
      usdPer: rates,
      display: "USD",
      fromDate: "2026-01-01",
      months: 13,
      ...over,
    });

  it("revalues what you already hold, not just what flows in", () => {
    // ₺400k = $10,000 today, plus $10,000 → $20,000
    const flat = project();
    expect(flat.startNetWorth).toBe(20_000);
    expect(flat.months[12].endNetWorth).toBe(20_000);

    // after a year at −30%, the lira half is worth $7,000
    const falling = project({ ratePath: buildRatePath(rates, deval30) });
    expect(falling.startNetWorth).toBe(20_000);
    expect(falling.months[12].endNetWorth).toBeCloseTo(10_000 * 0.7 + 10_000, 6);
  });

  it("an inflating TRY budget costs a steady amount in USD", () => {
    const plan = {
      items: [],
      budgets: [{ categoryId: "groceries", label: "Groceries", monthlyAmount: 10_000, currency: "TRY" as const, enabled: true }],
      devaluation: deval30, lostIncome: [], funding: NO_FUNDING,
    };
    const result = project({
      ratePath: buildRatePath(rates, deval30),
      extraFlows: planExtraFlows(plan, 13, FIRST),
      replaceCategories: planReplacedCategories(plan),
    });
    // ₺10,000 ≈ $250/mo, and it stays $250 a year later
    expect(result.months[0].expense).toBeCloseTo(250, 6);
    expect(result.months[12].expense).toBeCloseTo(250, 6);
  });

  it("a fixed TRY mortgage gets cheaper in USD as the lira falls", () => {
    const plan = {
      items: [
        item({ direction: "expense" as const, amount: 20_000, currency: "TRY" as const, inflates: false }),
      ],
      budgets: [],
      devaluation: deval30, lostIncome: [], funding: NO_FUNDING,
    };
    const result = project({
      ratePath: buildRatePath(rates, deval30),
      extraFlows: planExtraFlows(plan, 13, FIRST),
    });
    expect(result.months[0].expense).toBeCloseTo(500, 6); // ₺20k at 0.025
    expect(result.months[12].expense).toBeCloseTo(500 * 0.7, 6); // same lira, fewer dollars
  });

  it("a budget replaces the ledger's own projection for that category", () => {
    const rent: RecurringTemplate = {
      id: "tpl",
      name: "Rent",
      accountId: "try",
      direction: "expense",
      categoryId: "rent",
      amount: 40_000,
      frequency: "monthly",
      startDate: "2026-01-10",
      endDate: null,
      autoComplete: false,
      loanId: null,
      createdAt: "2025-12-01",
    };
    const withTemplate = project({ templates: [rent] });
    expect(withTemplate.months[0].expense).toBeCloseTo(1000, 6); // ₺40k

    const plan = {
      items: [],
      budgets: [{ categoryId: "rent", label: "Rent", monthlyAmount: 10_000, currency: "TRY" as const, enabled: true }],
      devaluation: off, lostIncome: [], funding: NO_FUNDING,
    };
    const replaced = project({
      templates: [rent],
      extraFlows: planExtraFlows(plan, 13, FIRST),
      replaceCategories: planReplacedCategories(plan),
    });
    // ₺10k budget instead of the ₺40k template — not on top of it
    expect(replaced.months[0].expense).toBeCloseTo(250, 6);
  });
});

describe("summaries", () => {
  const flat: ProjectionResult = {
    startNetWorth: 10_000,
    skippedAccountIds: [],
    months: Array.from({ length: 30 }, (_, i) => ({
      month: `m${i}`,
      income: 1000,
      expense: 400,
      net: 600,
      endNetWorth: 10_000 + 600 * (i + 1),
      shortfall: 0,
      draws: [],
      uncovered: 0,
      sourceBalances: {},
      expenseByCategory: {},
      lines: [],
    })),
  };

  it("reports year milestones inside the horizon only", () => {
    expect(planMilestones(flat).map((m) => m.label)).toEqual(["1y", "2y"]);
    expect(planMilestones(flat)[0].netWorth).toBe(10_000 + 600 * 12);
  });

  it("averages the monthly net", () => {
    expect(averageMonthlyNet(flat)).toBe(600);
    expect(averageMonthlyNet({ startNetWorth: 0, months: [], skippedAccountIds: [] })).toBe(0);
  });
});
