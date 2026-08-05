import { describe, expect, it } from "vitest";
import { projectCashflow } from "../projector";
import { NO_FUNDING, planFundingOrder, firstUncoveredMonth, totalDrawn, Plan, EMPTY_PLAN } from "../planner";
import { Account, RecurringTemplate, Transaction } from "@/lib/data/types";
import { UsdPerMap } from "../fx";

// 1 USD = 40 TRY, gold at $100/g — round numbers so the arithmetic is checkable
const RATES: UsdPerMap = { USD: 1, TRY: 0.025, EUR: 1.1, BTC: 60_000, XAU_G: 100 };
const FROM = "2026-01-01";

const account = (id: string, currency: Account["currency"], opening: number): Account => ({
  id,
  name: id,
  currency,
  kind: currency === "XAU_G" ? "gold" : "fiat",
  openingBalance: opening,
  archived: false,
  paymentAccountId: null,
  paymentDay: null,
  createdAt: "2025-01-01T00:00:00Z",
});

const rent = (accountId: string, amount: number): RecurringTemplate => ({
  id: `rent-${accountId}`,
  name: "Rent",
  accountId,
  direction: "expense",
  categoryId: "housing",
  amount,
  frequency: "monthly",
  startDate: "2026-01-05",
  endDate: null,
  autoComplete: false,
  loanId: null,
  createdAt: "2025-01-01T00:00:00Z",
});

const run = (
  accounts: Account[],
  templates: RecurringTemplate[],
  months: number,
  funding?: { order: string[]; overrides?: Record<string, string> }
) =>
  projectCashflow({
    accounts,
    transactions: [] as Transaction[],
    templates,
    usdPer: RATES,
    display: "USD",
    fromDate: FROM,
    months,
    funding,
  });

describe("paying for a month that doesn't pay for itself", () => {
  const lira = account("lira", "TRY", 40_000); // $1,000
  const gold = account("gold", "XAU_G", 50); // $5,000
  // ₺40k/mo rent, no income at all — every month is short $1,000
  const templates = [rent("lira", 40_000)];

  it("reports the shortfall and leaves it uncovered when nothing may be sold", () => {
    const r = run([lira, gold], templates, 3);
    expect(r.months[0].shortfall).toBeCloseTo(1000, 6);
    expect(r.months[0].draws).toEqual([]);
    expect(r.months[0].uncovered).toBeCloseTo(1000, 6);
  });

  it("draws on the first source that has something in it", () => {
    const r = run([lira, gold], templates, 3, { order: ["gold", "lira"] });
    const first = r.months[0];
    expect(first.uncovered).toBe(0);
    expect(first.draws).toHaveLength(1);
    expect(first.draws[0].accountId).toBe("gold");
    // $1,000 of rent at $100/g = 10 grams, leaving 40
    expect(first.draws[0].amount).toBeCloseTo(10, 6);
    expect(first.draws[0].value).toBeCloseTo(1000, 6);
    expect(first.sourceBalances.gold).toBeCloseTo(40, 6);
  });

  it("selling an asset doesn't change what you're worth", () => {
    const without = run([lira, gold], templates, 3);
    const withGold = run([lira, gold], templates, 3, { order: ["gold"] });
    expect(withGold.months[2].endNetWorth).toBeCloseTo(without.months[2].endNetWorth, 6);
  });

  it("falls through to the next source once one runs dry, then gives up", () => {
    // $5,000 of gold covers five months, the lira account a sixth, then
    // there is genuinely nothing left to sell
    const r = run([lira, gold], templates, 8, { order: ["gold", "lira"] });
    expect(r.months[4].draws[0].accountId).toBe("gold");
    expect(r.months[4].uncovered).toBe(0);
    expect(r.months[4].sourceBalances.gold).toBeCloseTo(0, 6);
    expect(r.months[5].draws[0].accountId).toBe("lira");
    expect(r.months[5].uncovered).toBe(0);
    expect(r.months[6].draws).toEqual([]);
    expect(r.months[6].uncovered).toBeCloseTo(1000, 6);
    expect(firstUncoveredMonth(r)).toBe(r.months[6].month);
  });

  it("never covers a gap out of money that isn't there", () => {
    // everything you own is $6,000; one month asks for $20,000 of it
    const big: RecurringTemplate = { ...rent("lira", 800_000), id: "big" };
    const r = run([lira, gold], [big], 1, { order: ["lira", "gold"] });
    const m = r.months[0];
    expect(m.shortfall).toBeCloseTo(20_000, 6);
    // both sources are emptied, and the rest is honestly reported as unpaid
    expect(m.draws.map((d) => d.accountId).sort()).toEqual(["gold", "lira"]);
    expect(m.sourceBalances.lira).toBeCloseTo(0, 6);
    expect(m.sourceBalances.gold).toBeCloseTo(0, 6);
    expect(m.uncovered).toBeCloseTo(14_000, 6);
    // and what's uncovered is exactly how far under water the month leaves you
    expect(m.endNetWorth).toBeCloseTo(-14_000, 6);
  });

  it("lets a single month be paid from something else", () => {
    const usd = account("usd", "USD", 10_000);
    const r = run([lira, gold, usd], templates, 3, {
      order: ["usd", "gold"],
      overrides: { "2026-02": "gold" },
    });
    expect(r.months[0].draws[0].accountId).toBe("usd");
    expect(r.months[1].draws[0].accountId).toBe("gold");
    expect(r.months[2].draws[0].accountId).toBe("usd");
  });

  it("a month that pays for itself sells nothing", () => {
    const salary: RecurringTemplate = {
      ...rent("usd", 3_000),
      id: "salary",
      name: "Salary",
      direction: "income",
      categoryId: "salary",
    };
    const usd = account("usd", "USD", 0);
    // +$3,000 salary against $1,000 of rent: the lira side is short, but the
    // month as a whole is up $2,000, so nothing has to be sold
    const r = run([usd, lira, gold], [salary, templates[0]], 2, { order: ["usd", "gold"] });
    expect(r.months[0].shortfall).toBe(0);
    expect(r.months[0].draws).toEqual([]);
    // the $2,000 the month cleared builds up at the top of the list
    expect(r.months[0].sourceBalances.usd).toBeCloseTo(2000, 6);
  });
});

describe("planFundingOrder", () => {
  const plan = (funding: Plan["funding"]): Plan => ({ ...EMPTY_PLAN, funding });

  it("is empty when funding is switched off", () => {
    expect(planFundingOrder(plan({ ...NO_FUNDING, enabled: false }), ["a", "b"])).toEqual([]);
  });

  it("keeps your order and appends accounts you haven't ranked", () => {
    const p = plan({ ...NO_FUNDING, order: ["c", "a"] });
    expect(planFundingOrder(p, ["a", "b", "c"])).toEqual(["c", "a", "b"]);
  });

  it("drops the ones you've marked off-limits and any that no longer exist", () => {
    const p = plan({ ...NO_FUNDING, order: ["gone", "a", "b"], disabled: ["b"] });
    expect(planFundingOrder(p, ["a", "b", "c"])).toEqual(["a", "c"]);
  });
});

describe("totalDrawn", () => {
  it("adds up everything sold across the horizon", () => {
    const r = run([account("lira", "TRY", 40_000), account("gold", "XAU_G", 50)], [rent("lira", 40_000)], 3, {
      order: ["gold"],
    });
    expect(totalDrawn(r)).toBeCloseTo(3000, 6);
  });
});
