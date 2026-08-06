import { describe, expect, it } from "vitest";
import { projectCashflow } from "../projector";
import {
  NO_FUNDING,
  planFundingOrder,
  firstUncoveredMonth,
  isShort,
  shortThreshold,
  soldFromReserve,
  totalDrawn,
  Plan,
  EMPTY_PLAN,
} from "../planner";
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
  funding?: {
    order: string[];
    overrides?: Record<string, string>;
    routine?: string[];
    payCards?: boolean;
  }
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

describe("paying for a month that overdraws an account", () => {
  const lira = account("lira", "TRY", 40_000); // $1,000
  const gold = account("gold", "XAU_G", 50); // $5,000
  // ₺40k/mo rent out of the lira account, no income at all
  const templates = [rent("lira", 40_000)];

  it("sells nothing while the account paying the bills still has money in it", () => {
    const r = run([lira, gold], templates, 2, { order: ["gold", "lira"] });
    // the first month's rent comes straight out of the ₺40k that was there
    expect(r.months[0].shortfall).toBeCloseTo(1000, 6);
    expect(r.months[0].draws).toEqual([]);
    expect(r.months[0].uncovered).toBe(0);
    expect(r.months[0].sourceBalances.lira).toBeCloseTo(0, 6);
    expect(r.months[0].sourceBalances.gold).toBeCloseTo(50, 6);
  });

  it("draws on the first source that has something in it", () => {
    const r = run([lira, gold], templates, 3, { order: ["gold", "lira"] });
    // by the second month the lira account is empty, so gold has to go
    const second = r.months[1];
    expect(second.uncovered).toBe(0);
    expect(second.draws).toHaveLength(1);
    expect(second.draws[0].accountId).toBe("gold");
    // $1,000 of rent at $100/g = 10 grams, leaving 40
    expect(second.draws[0].amount).toBeCloseTo(10, 6);
    expect(second.draws[0].value).toBeCloseTo(1000, 6);
    expect(second.sourceBalances.gold).toBeCloseTo(40, 6);
  });

  it("leaves the account overdrawn when nothing may be sold", () => {
    const r = run([lira, gold], templates, 3);
    expect(r.months[1].draws).toEqual([]);
    expect(r.months[1].uncovered).toBeCloseTo(1000, 6);
  });

  it("selling an asset doesn't change what you're worth", () => {
    const without = run([lira, gold], templates, 3);
    const withGold = run([lira, gold], templates, 3, { order: ["gold"] });
    expect(withGold.months[2].endNetWorth).toBeCloseTo(without.months[2].endNetWorth, 6);
  });

  it("net worth is always the sum of what's left, even once you run out", () => {
    // $6,000 of assets against $1,000/mo of rent: six months of runway
    const r = run([lira, gold], templates, 9, { order: ["gold", "lira"] });
    for (const [i, m] of r.months.entries()) {
      expect(m.endNetWorth, `month ${i}`).toBeCloseTo(6000 - 1000 * (i + 1), 6);
    }
    // and once everything is gone the shortfall shows up as unpaid, not as
    // net worth quietly climbing back
    expect(r.months[5].endNetWorth).toBeCloseTo(0, 6);
    expect(r.months[6].uncovered).toBeCloseTo(1000, 6);
    expect(r.months[8].endNetWorth).toBeCloseTo(-3000, 6);
  });

  it("falls through to the next source once one runs dry, then gives up", () => {
    const r = run([lira, gold], templates, 8, { order: ["gold", "lira"] });
    expect(r.months[5].draws[0].accountId).toBe("gold");
    expect(r.months[5].sourceBalances.gold).toBeCloseTo(0, 6);
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
    // the gold is sold — all of it — and the rest is reported as unpaid
    expect(m.draws.map((d) => d.accountId)).toEqual(["gold"]);
    expect(m.sourceBalances.gold).toBeCloseTo(0, 6);
    expect(m.uncovered).toBeCloseTo(14_000, 6);
    // what's uncovered is exactly how far under water the month leaves you
    expect(m.endNetWorth).toBeCloseTo(-14_000, 6);
  });

  it("lets a single month be paid from something else", () => {
    const usd = account("usd", "USD", 10_000);
    const r = run([lira, gold, usd], templates, 4, {
      order: ["usd", "gold"],
      overrides: { "2026-03": "gold" },
    });
    expect(r.months[0].draws).toEqual([]); // still paying out of the lira account
    expect(r.months[1].draws[0].accountId).toBe("usd");
    expect(r.months[2].draws[0].accountId).toBe("gold");
    expect(r.months[3].draws[0].accountId).toBe("usd");
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
    // +$3,000 salary against $1,000 of rent, and the rent's own account covers it
    const r = run([usd, lira, gold], [salary, templates[0]], 2, { order: ["usd", "gold"] });
    expect(r.months[0].shortfall).toBe(0);
    expect(r.months[0].draws).toEqual([]);
    expect(r.months[0].sourceBalances.usd).toBeCloseTo(3000, 6);
  });

  it("income landing in dollars is still there to be spent later", () => {
    // the bug: dollars earned during good months vanished from what could be
    // sold, while still propping up net worth
    const salary: RecurringTemplate = {
      ...rent("usd", 3_000),
      id: "salary",
      name: "Salary",
      direction: "income",
      categoryId: "salary",
      endDate: "2026-02-28",
    };
    const usd = account("usd", "USD", 0);
    const r = run([usd, lira, gold], [salary, templates[0]], 6, { order: ["usd", "gold"] });
    // two months of salary = $6,000, minus the five months of rent it went on
    expect(r.months[5].sourceBalances.usd).toBeCloseTo(1000, 6);
    // gold is untouched because the dollars were available first
    expect(r.months[5].sourceBalances.gold).toBeCloseTo(50, 6);
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
    const r = run([account("lira", "TRY", 40_000), account("gold", "XAU_G", 50)], [rent("lira", 40_000)], 4, {
      order: ["gold"],
    });
    // month one came out of the lira account; the next three came out of gold
    expect(totalDrawn(r)).toBeCloseTo(3000, 6);
  });
});

describe("routine accounts", () => {
  const lira = account("lira", "TRY", 0);
  const usd = account("usd", "USD", 10_000);
  const gold = account("gold", "XAU_G", 50);
  const templates = [rent("lira", 40_000)];

  it("marks a draw routine when it's just money passing through", () => {
    const r = run([lira, usd, gold], templates, 2, { order: ["usd", "gold"], routine: ["usd"] });
    const m = r.months[0];
    expect(m.draws[0].accountId).toBe("usd");
    expect(m.draws[0].routine).toBe(true);
    // turning dollars into lira to pay a lira bill isn't a raid on savings
    expect(soldFromReserve(m)).toBe(false);
  });

  it("still flags the month once it has to reach past them", () => {
    // $10,000 of dollars covers ten months; the eleventh has to sell gold
    const r = run([lira, usd, gold], templates, 12, { order: ["usd", "gold"], routine: ["usd"] });
    expect(soldFromReserve(r.months[9])).toBe(false);
    const first = r.months.findIndex((m) => soldFromReserve(m));
    expect(first).toBe(10);
    expect(r.months[first].draws.some((d) => d.accountId === "gold" && !d.routine)).toBe(true);
  });

  it("leaves routine conversions out of what you've had to sell", () => {
    const r = run([lira, usd, gold], templates, 4, { order: ["usd"], routine: ["usd"] });
    expect(totalDrawn(r)).toBe(0);
    expect(totalDrawn(r, true)).toBeCloseTo(4000, 6);
  });
});

describe("when a month counts as short", () => {
  it("prices the threshold into whatever you're reading in", () => {
    // ₺1,000 at 40 to the dollar
    expect(shortThreshold("TRY", RATES)).toBeCloseTo(1000, 6);
    expect(shortThreshold("USD", RATES)).toBeCloseTo(25, 6);
    expect(shortThreshold("XAU_G", RATES)).toBeCloseTo(0.25, 6);
  });

  it("ignores a gap left by rounding", () => {
    const floor = shortThreshold("USD", RATES);
    expect(isShort({ uncovered: 0.23 }, floor)).toBe(false);
    expect(isShort({ uncovered: 24.99 }, floor)).toBe(false);
    expect(isShort({ uncovered: 25.01 }, floor)).toBe(true);
  });

  it("doesn't call the runway over for a few lira", () => {
    const months = [
      { month: "2026-01", uncovered: 0 },
      { month: "2026-02", uncovered: 0.4 }, // ₺16 — rounding, not ruin
      { month: "2026-03", uncovered: 800 },
    ];
    const result = { startNetWorth: 0, skippedAccountIds: [], months } as unknown as Parameters<
      typeof firstUncoveredMonth
    >[0];
    expect(firstUncoveredMonth(result, shortThreshold("USD", RATES))).toBe("2026-03");
    // without a threshold even the dust counts
    expect(firstUncoveredMonth(result)).toBe("2026-02");
  });
});

describe("credit card bills", () => {
  const bank = account("bank", "TRY", 200_000); // $5,000
  const card: Account = { ...account("card", "TRY", 0), kind: "credit_card" };
  // ₺40k a month charged to the card, nothing else happening
  const spend = [{ ...rent("card", 40_000), id: "card-spend" }];

  it("settles the card from your accounts, so the cash really goes", () => {
    const r = run([bank, card], spend, 3, { order: ["bank"] });
    expect(r.months[0].draws[0].accountId).toBe("bank");
    // ₺40k off the bank, and the card back to zero
    expect(r.months[0].sourceBalances.bank).toBeCloseTo(160_000, 6);
    expect(r.months[2].sourceBalances.bank).toBeCloseTo(80_000, 6);
  });

  it("lets the balance ride when you say so", () => {
    const r = run([bank, card], spend, 3, { order: ["bank"], payCards: false });
    expect(r.months[0].draws).toEqual([]);
    expect(r.months[2].sourceBalances.bank).toBeCloseTo(200_000, 6);
  });

  it("either way the debt counts against what you're worth", () => {
    const paid = run([bank, card], spend, 3, { order: ["bank"] });
    const carried = run([bank, card], spend, 3, { order: ["bank"], payCards: false });
    expect(paid.months[2].endNetWorth).toBeCloseTo(carried.months[2].endNetWorth, 6);
    expect(paid.months[2].endNetWorth).toBeCloseTo(5000 - 3000, 6);
  });

  it("sells an asset when the card bill outruns the bank", () => {
    const small = account("bank", "TRY", 40_000); // one month's worth
    const gold = account("gold", "XAU_G", 50);
    const r = run([small, gold, card], spend, 3, { order: ["bank", "gold"] });
    expect(r.months[1].draws.map((d) => d.accountId)).toEqual(["gold"]);
    expect(r.months[1].uncovered).toBe(0);
  });
});
