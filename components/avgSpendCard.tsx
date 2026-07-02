"use client";

import { useMemo, useState } from "react";
import { Card, CardHeader } from "@/components/ui";
import { useApp } from "@/lib/data/provider";
import { useAccounts, useCategories, useRates, useTransactions } from "@/lib/data/queries";
import { formatAmount } from "@/lib/domain/currencies";
import { averageMonthlySpend } from "@/lib/domain/stats";
import { todayISO } from "@/lib/domain/recurrence";
import { useI18n } from "@/lib/i18n";

const WINDOWS = [3, 6, 12] as const;

/** Average monthly spending per category over a selectable window (bar list). */
export function AvgSpendCard({ className }: { className?: string }) {
  const { t, locale } = useI18n();
  const { displayCurrency } = useApp();
  const accounts = useAccounts();
  const transactions = useTransactions();
  const categories = useCategories();
  const rates = useRates();
  const [window, setWindow] = useState<(typeof WINDOWS)[number]>(3);

  const stats = useMemo(() => {
    if (!accounts.data || !transactions.data || !categories.data || !rates.data) return null;
    return averageMonthlySpend({
      transactions: transactions.data,
      accounts: accounts.data,
      categories: categories.data,
      usdPer: rates.data.usdPer,
      display: displayCurrency,
      windowMonths: window,
      today: todayISO(),
    });
  }, [accounts.data, transactions.data, categories.data, rates.data, displayCurrency, window]);

  if (!stats) return null;

  const top = stats.categories.slice(0, 6);
  const other = stats.categories.slice(6).reduce((s, c) => s + c.monthlyAverage, 0);
  const max = Math.max(...top.map((c) => c.monthlyAverage), other, 1);

  return (
    <Card className={className}>
      <CardHeader
        title={`${t("purchases.avgSpendTitle")} (${displayCurrency})`}
        action={
          <div className="flex gap-1 rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-800">
            {WINDOWS.map((w) => (
              <button
                key={w}
                onClick={() => setWindow(w)}
                className={`rounded-md px-2 py-0.5 text-xs font-medium ${
                  window === w ? "bg-white shadow-sm dark:bg-zinc-700" : "text-zinc-500"
                }`}
              >
                {t(`purchases.statsWindow${w}`)}
              </button>
            ))}
          </div>
        }
      />
      <div className="space-y-2 p-4">
        {top.map((c) => (
          <div key={c.categoryId ?? "none"}>
            <div className="mb-0.5 flex justify-between text-xs">
              <span className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-300">
                <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: c.color }} />
                {c.name}
              </span>
              <span className="font-medium tabular-nums">{formatAmount(c.monthlyAverage, displayCurrency, locale)}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
              <div
                className="h-full rounded-full"
                style={{ width: `${(c.monthlyAverage / max) * 100}%`, backgroundColor: c.color }}
              />
            </div>
          </div>
        ))}
        {other > 0 ? (
          <div className="flex justify-between text-xs text-zinc-400">
            <span>…</span>
            <span className="tabular-nums">{formatAmount(other, displayCurrency, locale)}</span>
          </div>
        ) : null}
        <div className="flex justify-between border-t border-zinc-100 pt-2 text-sm font-semibold dark:border-zinc-800">
          <span>{t("purchases.avgTotal")}</span>
          <span className="tabular-nums">{formatAmount(stats.totalMonthlyAverage, displayCurrency, locale)}</span>
        </div>
      </div>
    </Card>
  );
}
