import { Account, Category, Transaction } from "@/lib/data/types";
import { Currency } from "./currencies";
import { convert, UsdPerMap } from "./fx";
import { addMonthsClamped } from "./recurrence";

export interface CategoryAverage {
  categoryId: string | null;
  name: string;
  color: string;
  monthlyAverage: number;
}

export interface SpendStats {
  /** per-category average monthly spend, sorted descending */
  categories: CategoryAverage[];
  /** overall average monthly spend */
  totalMonthlyAverage: number;
  /** per-account (card) average monthly spend */
  byAccount: Map<string, number>;
  windowMonths: number;
}

/**
 * Average monthly spending over the last N months (including the current
 * month), from completed expense transactions, transfers excluded. Each
 * transaction converts to the display currency via its own fx snapshot
 * (falling back to current rates) — the same no-drift rule as the charts.
 */
export function averageMonthlySpend(params: {
  transactions: Transaction[];
  accounts: Account[];
  categories: Category[];
  usdPer: UsdPerMap;
  display: Currency;
  windowMonths: number;
  today: string;
}): SpendStats {
  const { transactions, accounts, categories, usdPer, display, windowMonths, today } = params;
  const firstMonth = addMonthsClamped(today, -(windowMonths - 1)).slice(0, 7);
  const currentMonth = today.slice(0, 7);
  const currencyOf = new Map(accounts.map((a) => [a.id, a.currency] as const));
  const categoryById = new Map(categories.map((c) => [c.id, c]));

  const byCategory = new Map<string | null, number>();
  const byAccount = new Map<string, number>();
  let total = 0;

  for (const t of transactions) {
    if (t.status !== "completed" || t.direction !== "expense" || t.transferGroupId != null) continue;
    const month = t.dueDate.slice(0, 7);
    if (month < firstMonth || month > currentMonth) continue;
    const currency = currencyOf.get(t.accountId);
    if (!currency) continue;
    const rates = t.fxSnapshot?.usdPer ?? usdPer;
    const converted = convert(t.amount, currency, display, rates);
    if (converted == null) continue;
    total += converted;
    byCategory.set(t.categoryId, (byCategory.get(t.categoryId) ?? 0) + converted);
    byAccount.set(t.accountId, (byAccount.get(t.accountId) ?? 0) + converted);
  }

  const categoryAverages: CategoryAverage[] = [...byCategory.entries()]
    .map(([categoryId, sum]) => {
      const category = categoryId ? categoryById.get(categoryId) : undefined;
      return {
        categoryId,
        name: category?.name ?? "—",
        color: category?.color ?? "#898781",
        monthlyAverage: sum / windowMonths,
      };
    })
    .sort((a, b) => b.monthlyAverage - a.monthlyAverage);

  const accountAverages = new Map<string, number>();
  for (const [id, sum] of byAccount) accountAverages.set(id, sum / windowMonths);

  return {
    categories: categoryAverages,
    totalMonthlyAverage: total / windowMonths,
    byAccount: accountAverages,
    windowMonths,
  };
}
