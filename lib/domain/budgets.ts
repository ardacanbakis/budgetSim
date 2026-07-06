import { Account, Budget, Goal, Transaction } from "@/lib/data/types";
import { Currency } from "./currencies";
import { convert, UsdPerMap } from "./fx";

export interface BudgetStatus {
  budget: Budget;
  /** completed spend this month in the budget's currency */
  spent: number;
  pct: number;
  level: "ok" | "warn" | "over";
}

/**
 * Spend vs limit per budgeted category for a given month (yyyy-mm).
 * Each transaction converts to the budget's currency via its own fx
 * snapshot (fallback: current rates). warn ≥ 80%, over ≥ 100%.
 */
export function budgetStatuses(params: {
  budgets: Budget[];
  transactions: Transaction[];
  accounts: Account[];
  usdPer: UsdPerMap;
  month: string;
}): BudgetStatus[] {
  const { budgets, transactions, accounts, usdPer, month } = params;
  const currencyOf = new Map(accounts.map((a) => [a.id, a.currency] as const));
  const spentByCategory = new Map<string, number>();
  for (const t of transactions) {
    if (t.status !== "completed" || t.direction !== "expense" || t.transferGroupId != null || t.legacy) continue;
    if (t.categoryId == null || t.dueDate.slice(0, 7) !== month) continue;
    const currency = currencyOf.get(t.accountId);
    if (!currency) continue;
    const budget = budgets.find((b) => b.categoryId === t.categoryId);
    if (!budget) continue;
    const converted = convert(t.amount, currency, budget.currency, t.fxSnapshot?.usdPer ?? usdPer);
    if (converted == null) continue;
    spentByCategory.set(t.categoryId, (spentByCategory.get(t.categoryId) ?? 0) + converted);
  }
  return budgets.map((budget) => {
    const spent = spentByCategory.get(budget.categoryId) ?? 0;
    const pct = (spent / budget.monthlyLimit) * 100;
    return { budget, spent, pct, level: pct >= 100 ? "over" : pct >= 80 ? "warn" : "ok" };
  });
}

/** Warning level for a hypothetical new expense (used at entry time). */
export function budgetWarningFor(params: {
  budgets: Budget[];
  statuses: BudgetStatus[];
  categoryId: string | null;
  amount: number;
  currency: Currency;
  usdPer: UsdPerMap;
}): { level: "warn" | "over"; spent: number; limit: number; currency: Currency } | null {
  const { budgets, statuses, categoryId, amount, currency, usdPer } = params;
  if (!categoryId || !(amount > 0)) return null;
  const budget = budgets.find((b) => b.categoryId === categoryId);
  if (!budget) return null;
  const status = statuses.find((s) => s.budget.id === budget.id);
  const converted = convert(amount, currency, budget.currency, usdPer);
  if (converted == null) return null;
  const projected = (status?.spent ?? 0) + converted;
  const pct = (projected / budget.monthlyLimit) * 100;
  if (pct < 80) return null;
  return {
    level: pct >= 100 ? "over" : "warn",
    spent: projected,
    limit: budget.monthlyLimit,
    currency: budget.currency,
  };
}

/**
 * Discretionary money this month: liquid fiat balances (cards excluded)
 * + planned income still due this month − planned expenses still due this
 * month (installments included, transfers excluded), in the display currency.
 */
export function safeToSpend(params: {
  accounts: Account[];
  balances: Map<string, number>;
  transactions: Transaction[];
  usdPer: UsdPerMap;
  display: Currency;
  today: string;
}): { total: number; liquid: number; plannedIncome: number; plannedExpense: number } {
  const { accounts, balances, transactions, usdPer, display, today } = params;
  const month = today.slice(0, 7);
  const currencyOf = new Map(accounts.map((a) => [a.id, a.currency] as const));

  let liquid = 0;
  for (const a of accounts) {
    if (a.archived || a.kind !== "fiat") continue;
    const converted = convert(balances.get(a.id) ?? 0, a.currency, display, usdPer);
    if (converted != null) liquid += converted;
  }

  let plannedIncome = 0;
  let plannedExpense = 0;
  for (const t of transactions) {
    if (t.status !== "planned" || t.transferGroupId != null) continue;
    if (t.dueDate < today || t.dueDate.slice(0, 7) !== month) continue;
    const currency = currencyOf.get(t.accountId);
    if (!currency) continue;
    const converted = convert(t.amount, currency, display, usdPer);
    if (converted == null) continue;
    if (t.direction === "income") plannedIncome += converted;
    else plannedExpense += converted;
  }

  return { total: liquid + plannedIncome - plannedExpense, liquid, plannedIncome, plannedExpense };
}

export interface GoalProgress {
  goal: Goal;
  current: number;
  pct: number;
  /** amount still missing, in the goal account's currency */
  remaining: number;
  /** needed saving per month to hit target_date; null without a date or if already reached */
  requiredMonthly: number | null;
}

export function goalProgress(goal: Goal, balance: number, today: string): GoalProgress {
  const current = Math.max(0, balance);
  const pct = Math.min(100, (current / goal.targetAmount) * 100);
  const remaining = Math.max(0, goal.targetAmount - current);
  let requiredMonthly: number | null = null;
  if (goal.targetDate && remaining > 0 && goal.targetDate > today) {
    const [ty, tm] = goal.targetDate.split("-").map(Number);
    const [ny, nm] = today.split("-").map(Number);
    const monthsLeft = Math.max(1, (ty - ny) * 12 + (tm - nm));
    requiredMonthly = remaining / monthsLeft;
  }
  return { goal, current, pct, remaining, requiredMonthly };
}
