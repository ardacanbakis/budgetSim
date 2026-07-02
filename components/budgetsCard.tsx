"use client";

import Link from "next/link";
import { Card, CardHeader } from "@/components/ui";
import { useAccounts, useBudgets, useCategories, useRates, useTransactions } from "@/lib/data/queries";
import { budgetStatuses } from "@/lib/domain/budgets";
import { formatAmount } from "@/lib/domain/currencies";
import { todayISO } from "@/lib/domain/recurrence";
import { useI18n } from "@/lib/i18n";

/** This month's spend vs limit per budgeted category. */
export function BudgetsCard({ className }: { className?: string }) {
  const { t, locale } = useI18n();
  const budgets = useBudgets();
  const categories = useCategories();
  const transactions = useTransactions();
  const accounts = useAccounts();
  const rates = useRates();

  const statuses =
    budgets.data && transactions.data && accounts.data && rates.data
      ? budgetStatuses({
          budgets: budgets.data,
          transactions: transactions.data,
          accounts: accounts.data,
          usdPer: rates.data.usdPer,
          month: todayISO().slice(0, 7),
        })
      : [];
  const categoryById = new Map((categories.data ?? []).map((c) => [c.id, c]));

  return (
    <Card className={className}>
      <CardHeader
        title={t("budgets.title")}
        action={
          <Link href="/settings" className="text-xs text-teal-600 hover:underline">
            {t("budgets.editIn")} →
          </Link>
        }
      />
      <div className="space-y-3 p-4">
        {statuses.length === 0 ? (
          <p className="text-sm text-zinc-400">{t("budgets.none")}</p>
        ) : (
          statuses.map((status) => {
            const category = categoryById.get(status.budget.categoryId);
            const barColor =
              status.level === "over" ? "bg-red-500" : status.level === "warn" ? "bg-amber-500" : "bg-teal-600";
            return (
              <div key={status.budget.id}>
                <div className="mb-0.5 flex justify-between text-xs">
                  <span className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-300">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: category?.color ?? "#898781" }}
                    />
                    {category?.name ?? "—"}
                    {status.level !== "ok" ? (
                      <span className={status.level === "over" ? "font-medium text-red-500" : "font-medium text-amber-500"}>
                        · {t(`budgets.${status.level}`)}
                      </span>
                    ) : null}
                  </span>
                  <span className="tabular-nums text-zinc-500">
                    {formatAmount(status.spent, status.budget.currency, locale)} /{" "}
                    {formatAmount(status.budget.monthlyLimit, status.budget.currency, locale)}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                  <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.min(100, status.pct)}%` }} />
                </div>
              </div>
            );
          })
        )}
      </div>
    </Card>
  );
}
