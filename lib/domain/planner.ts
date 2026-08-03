import { TxDirection } from "@/lib/data/types";
import { Currency } from "./currencies";
import { UsdPerMap } from "./fx";
import { ExtraFlow, ProjectionResult } from "./projector";

/**
 * The planner layers hypothetical decisions on top of a real projection:
 * income or debt you're considering taking on, honest monthly budgets for the
 * everyday spending that never appears as a planned transaction, and a view of
 * what a steadily weakening lira does to all of it.
 *
 * Everything here is pure and produces inputs for the projector, so the plan
 * and the base line are computed by exactly the same money engine.
 */

export type PlanFrequency = "monthly" | "yearly" | "once";

export interface PlanItem {
  id: string;
  label: string;
  direction: TxDirection;
  /** nominal amount today, in `currency` */
  amount: number;
  currency: Currency;
  frequency: PlanFrequency;
  /** absolute start month, "yyyy-MM" — stored as a real date so a plan still
   * means the same thing when you open it again next month */
  startMonth: string;
  /** how many months it runs; null = until the end of the horizon.
   * Ignored for "once". A 120-month mortgage is durationMonths: 120. */
  durationMonths: number | null;
  /**
   * Whether the nominal amount keeps pace with the currency's own inflation.
   * A salary or a grocery bill does (it stays worth the same in real terms);
   * a fixed-rate loan installment does not — which is exactly why inflation
   * quietly erodes Turkish mortgages.
   */
  inflates: boolean;
  enabled: boolean;
}

/**
 * "Assume I spend this much per month on X." Replaces whatever the ledger
 * projects for that category — so a Rent template and a Rent budget can't
 * double-count — and covers categories (groceries, bills) that have no
 * planned items at all and would otherwise be projected as zero. Budgets
 * always track inflation: living costs re-price.
 */
export interface CategoryBudget {
  categoryId: string;
  /** the category's name, carried so the timeline can label the line */
  label: string;
  monthlyAmount: number;
  currency: Currency;
  enabled: boolean;
}

/** A steadily weakening lira, expressed the way people talk about it. */
export interface Devaluation {
  enabled: boolean;
  /** e.g. 30 = the lira loses 30% of its USD value each year, compounding */
  pctPerYear: number;
}

/**
 * Which assets you're willing to sell to get through a month that doesn't pay
 * for itself, and in what order. Bills don't wait for the average to work out:
 * a bad January has to be paid for in January, out of something you hold.
 */
export interface Funding {
  enabled: boolean;
  /** account ids you'd draw on, highest priority first */
  order: string[];
  /** the subset that's actually allowed — untick the emergency fund */
  disabled: string[];
  /** month ("yyyy-MM") → account to raid first, just for that month */
  overrides: Record<string, string>;
}

export interface Plan {
  items: PlanItem[];
  budgets: CategoryBudget[];
  devaluation: Devaluation;
  /** income category ids to model as lost — "what if the VICTVS work dried up" */
  lostIncome: string[];
  funding: Funding;
}

export const NO_DEVALUATION: Devaluation = { enabled: false, pctPerYear: 25 };
export const NO_FUNDING: Funding = { enabled: true, order: [], disabled: [], overrides: {} };
export const EMPTY_PLAN: Plan = {
  items: [],
  budgets: [],
  devaluation: NO_DEVALUATION,
  lostIncome: [],
  funding: NO_FUNDING,
};

/** The currency that devalues. Everything else is treated as stable. */
const SOFT_CURRENCY: Currency = "TRY";

function activeRate(deval: Devaluation): number {
  if (!deval.enabled) return 0;
  const pct = deval.pctPerYear;
  return Number.isFinite(pct) && pct > 0 && pct < 100 ? pct : 0;
}

/**
 * How much of its value the soft currency retains after `months`.
 * 30%/yr for 24 months → 0.7² = 0.49.
 */
export function retentionFactor(deval: Devaluation, months: number): number {
  const pct = activeRate(deval);
  if (pct === 0) return 1;
  return Math.pow(1 - pct / 100, months / 12);
}

/**
 * Rates for a given month under the devaluation assumption, or undefined when
 * it's off (so the projector keeps its constant-rate fast path).
 */
export function buildRatePath(
  usdPer: UsdPerMap,
  deval: Devaluation
): ((offset: number) => UsdPerMap) | undefined {
  const base = usdPer[SOFT_CURRENCY];
  if (activeRate(deval) === 0 || base == null) return undefined;
  return (offset) => ({ ...usdPer, [SOFT_CURRENCY]: base * retentionFactor(deval, offset) });
}

/**
 * Nominal amount in month `offset`. Amounts in the soft currency that track
 * inflation grow by exactly what the currency loses, so their real value —
 * and their price in USD — stays put.
 */
export function nominalAmountAt(
  amount: number,
  currency: Currency,
  inflates: boolean,
  deval: Devaluation,
  offset: number
): number {
  if (!inflates || currency !== SOFT_CURRENCY) return amount;
  const retained = retentionFactor(deval, offset);
  return retained > 0 ? amount / retained : amount;
}

/** Whole months from `from` to `to`, both "yyyy-MM". Negative when `to` is earlier. */
export function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

/** Add months to a "yyyy-MM" key. */
export function addMonthKey(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

/**
 * Does a repeating item land in the month at `offset` from the projection
 * start? `startOffset` is where the item's own start month falls on that axis.
 */
export function itemHitsMonth(item: PlanItem, offset: number, startOffset: number): boolean {
  if (offset < startOffset) return false;
  const elapsed = offset - startOffset;
  if (item.frequency === "once") return elapsed === 0;
  if (item.durationMonths != null && elapsed >= item.durationMonths) return false;
  if (item.frequency === "yearly") return elapsed % 12 === 0;
  return true;
}

/** Total a plan item contributes across the horizon, in its own currency. */
export function itemHorizonTotal(
  item: PlanItem,
  months: number,
  deval: Devaluation,
  firstMonth: string
): number {
  const startOffset = monthsBetween(firstMonth, item.startMonth);
  let total = 0;
  for (let i = 0; i < months; i++) {
    if (itemHitsMonth(item, i, startOffset)) {
      total += nominalAmountAt(item.amount, item.currency, item.inflates, deval, i);
    }
  }
  return total;
}

/** Every hypothetical flow the plan implies, ready for the projector. */
export function planExtraFlows(plan: Plan, months: number, firstMonth: string): ExtraFlow[] {
  const flows: ExtraFlow[] = [];
  const deval = plan.devaluation;

  for (const item of plan.items) {
    if (!item.enabled || !(item.amount > 0)) continue;
    const startOffset = monthsBetween(firstMonth, item.startMonth);
    for (let offset = 0; offset < months; offset++) {
      if (!itemHitsMonth(item, offset, startOffset)) continue;
      flows.push({
        monthOffset: offset,
        direction: item.direction,
        amount: nominalAmountAt(item.amount, item.currency, item.inflates, deval, offset),
        currency: item.currency,
        categoryId: "",
        label: item.label,
      });
    }
  }

  for (const budget of plan.budgets) {
    if (!budget.enabled || !(budget.monthlyAmount > 0)) continue;
    for (let offset = 0; offset < months; offset++) {
      flows.push({
        monthOffset: offset,
        direction: "expense",
        // living costs re-price with the currency they're paid in
        amount: nominalAmountAt(budget.monthlyAmount, budget.currency, true, deval, offset),
        currency: budget.currency,
        categoryId: budget.categoryId,
        label: budget.label,
      });
    }
  }

  return flows;
}

/** Income categories the plan assumes stop arriving. */
export function planDroppedIncome(plan: Plan): Set<string> {
  return new Set(plan.lostIncome ?? []);
}

/** Categories whose ledger projection a budget takes over. */
export function planReplacedCategories(plan: Plan): Set<string> {
  return new Set(
    plan.budgets.filter((b) => b.enabled && b.monthlyAmount > 0).map((b) => b.categoryId)
  );
}

export function planIsEmpty(plan: Plan): boolean {
  return (
    !plan.items.some((i) => i.enabled && i.amount > 0) &&
    !plan.budgets.some((b) => b.enabled && b.monthlyAmount > 0) &&
    (plan.lostIncome ?? []).length === 0 &&
    activeRate(plan.devaluation) === 0
  );
}

export interface PlanMilestone {
  /** 12, 24, 60 … */
  months: number;
  label: string;
  netWorth: number;
}

/** Net worth at the year marks that fit inside the horizon, for the summary row. */
export function planMilestones(result: ProjectionResult): PlanMilestone[] {
  const marks = [12, 24, 36, 60, 120];
  const out: PlanMilestone[] = [];
  for (const months of marks) {
    const row = result.months[months - 1];
    if (!row) continue;
    out.push({ months, label: `${months / 12}y`, netWorth: row.endNetWorth });
  }
  return out;
}

/**
 * Read a plan out of whatever was stored — an old localStorage scratchpad, a
 * row saved by a previous version, or nothing at all. Plans are a scratchpad
 * whose shape keeps growing, so every field is defaulted rather than trusted.
 */
export function normalizePlan(raw: unknown, thisMonth: string): Plan {
  const saved = raw as Partial<Plan> | null;
  if (!saved || !Array.isArray(saved.items) || !Array.isArray(saved.budgets)) return EMPTY_PLAN;
  return {
    devaluation: saved.devaluation ?? EMPTY_PLAN.devaluation,
    lostIncome: saved.lostIncome ?? [],
    funding: {
      enabled: saved.funding?.enabled ?? true,
      order: saved.funding?.order ?? [],
      disabled: saved.funding?.disabled ?? [],
      overrides: saved.funding?.overrides ?? {},
    },
    items: saved.items.map((i) => ({
      ...i,
      currency: i.currency ?? "USD",
      inflates: i.inflates ?? true,
      // plans saved before start months were real dates stored an offset
      startMonth:
        typeof i.startMonth === "number" ? addMonthKey(thisMonth, i.startMonth) : i.startMonth,
    })),
    budgets: saved.budgets.map((b) => ({ ...b, currency: b.currency ?? "USD", label: b.label ?? "" })),
  };
}

/**
 * The drain order handed to the projector: enabled sources in your order,
 * then any account you own that isn't in the list yet. A newly opened account
 * is available without you having to go and add it.
 */
export function planFundingOrder(plan: Plan, drawableIds: string[]): string[] {
  const funding = plan.funding ?? NO_FUNDING;
  if (!funding.enabled) return [];
  const off = new Set(funding.disabled ?? []);
  const drawable = new Set(drawableIds);
  const ordered = (funding.order ?? []).filter((id) => drawable.has(id));
  const rest = drawableIds.filter((id) => !ordered.includes(id));
  return [...ordered, ...rest].filter((id) => !off.has(id));
}

/** The first month the plan can't pay for itself, or null if it always can. */
export function firstUncoveredMonth(result: ProjectionResult): string | null {
  return result.months.find((m) => m.uncovered > 0.005)?.month ?? null;
}

/** Total sold out of assets across the horizon, in the display currency. */
export function totalDrawn(result: ProjectionResult): number {
  return result.months.reduce((s, m) => s + m.draws.reduce((d, x) => d + x.value, 0), 0);
}

/** Average monthly surplus (or shortfall) across the horizon. */
export function averageMonthlyNet(result: ProjectionResult): number {
  if (result.months.length === 0) return 0;
  return result.months.reduce((s, m) => s + m.net, 0) / result.months.length;
}
