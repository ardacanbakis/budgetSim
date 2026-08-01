import { TxDirection } from "@/lib/data/types";
import { ProjectionMonth, ProjectionResult } from "./projector";

/**
 * The planner layers hypothetical decisions on top of a real projection:
 * income or debt you're considering taking on, plus honest monthly budgets
 * for the everyday spending that never appears as a planned transaction.
 *
 * Nothing here touches stored data — it's a pure transform of an already
 * computed ProjectionResult, so the plan line and the base line differ only
 * by the assumptions themselves.
 */

export type PlanFrequency = "monthly" | "yearly" | "once";

export interface PlanItem {
  id: string;
  label: string;
  direction: TxDirection;
  /** in the display currency the projection was computed in */
  amount: number;
  frequency: PlanFrequency;
  /** months from the projection start; 0 = the first projected month */
  startMonth: number;
  /** how many months it runs; null = until the end of the horizon.
   * Ignored for "once". A 120-month mortgage is durationMonths: 120. */
  durationMonths: number | null;
  enabled: boolean;
}

/**
 * "Assume I spend this much per month on X." Replaces whatever the ledger
 * projects for that category — so a Rent template and a Rent budget can't
 * double-count — and covers categories (groceries, bills) that have no
 * planned items at all and would otherwise be projected as zero.
 */
export interface CategoryBudget {
  categoryId: string;
  monthlyAmount: number;
  enabled: boolean;
}

export interface Plan {
  items: PlanItem[];
  budgets: CategoryBudget[];
}

export const EMPTY_PLAN: Plan = { items: [], budgets: [] };

/** Does a repeating item land in the month at `offset` from the start? */
export function itemHitsMonth(item: PlanItem, offset: number): boolean {
  if (offset < item.startMonth) return false;
  const elapsed = offset - item.startMonth;
  if (item.frequency === "once") return elapsed === 0;
  if (item.durationMonths != null && elapsed >= item.durationMonths) return false;
  if (item.frequency === "yearly") return elapsed % 12 === 0;
  return true;
}

/** Total a plan item contributes across the whole horizon. */
export function itemHorizonTotal(item: PlanItem, months: number): number {
  let total = 0;
  for (let i = 0; i < months; i++) if (itemHitsMonth(item, i)) total += item.amount;
  return total;
}

/**
 * Apply a plan to a base projection. Budgets are swapped in per category
 * first, then plan items are added; net worth is re-accumulated from the
 * projection's own starting point so the line stays consistent.
 */
export function applyPlan(base: ProjectionResult, plan: Plan): ProjectionResult {
  const budgets = plan.budgets.filter((b) => b.enabled && b.monthlyAmount >= 0);
  const items = plan.items.filter((i) => i.enabled && i.amount > 0);
  if (budgets.length === 0 && items.length === 0) return base;

  let running = base.startNetWorth;
  const months: ProjectionMonth[] = base.months.map((m, offset) => {
    let income = m.income;
    let expense = m.expense;
    const expenseByCategory = { ...m.expenseByCategory };

    for (const budget of budgets) {
      const projected = expenseByCategory[budget.categoryId] ?? 0;
      expense += budget.monthlyAmount - projected;
      expenseByCategory[budget.categoryId] = budget.monthlyAmount;
    }

    for (const item of items) {
      if (!itemHitsMonth(item, offset)) continue;
      if (item.direction === "income") income += item.amount;
      else expense += item.amount;
    }

    const net = income - expense;
    running += net;
    return { month: m.month, income, expense, net, endNetWorth: running, expenseByCategory };
  });

  return { ...base, months };
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

/** Average monthly surplus (or shortfall) across the horizon. */
export function averageMonthlyNet(result: ProjectionResult): number {
  if (result.months.length === 0) return 0;
  return result.months.reduce((s, m) => s + m.net, 0) / result.months.length;
}
