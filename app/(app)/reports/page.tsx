"use client";

import {
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button, Card, CardHeader, EmptyState, Spinner } from "@/components/ui";
import { useApp, useRepo } from "@/lib/data/provider";
import {
  KEYS,
  useAccounts,
  useAppMutation,
  useCategories,
  useRates,
  useSnapshots,
  useTransactions,
} from "@/lib/data/queries";
import { computeBalances, computeNetWorth } from "@/lib/domain/balances";
import { CURRENCIES, Currency, formatAmount } from "@/lib/domain/currencies";
import { convert } from "@/lib/domain/fx";
import { computeFxInsights } from "@/lib/domain/fxInsights";
import { addMonthsClamped, todayISO } from "@/lib/domain/recurrence";
import { useI18n } from "@/lib/i18n";

const tooltipStyle = {
  backgroundColor: "var(--viz-tooltip-bg)",
  border: "1px solid var(--viz-grid)",
  borderRadius: 8,
  fontSize: 12,
};

/** fixed categorical slot per currency — order never changes (CVD-safe assignment) */
const CURRENCY_SLOT: Record<Currency, string> = {
  TRY: "var(--viz-series-1)",
  USD: "var(--viz-series-2)",
  EUR: "var(--viz-series-3)",
  BTC: "var(--viz-series-4)",
  XAU_G: "var(--viz-series-5)",
};
const TREND_SLOTS = [
  "var(--viz-series-1)",
  "var(--viz-series-2)",
  "var(--viz-series-3)",
  "var(--viz-series-4)",
  "var(--viz-series-5)",
];

export default function ReportsPage() {
  const { t, locale } = useI18n();
  const repo = useRepo();
  const { displayCurrency } = useApp();
  const accounts = useAccounts();
  const transactions = useTransactions();
  const categories = useCategories();
  const snapshots = useSnapshots();
  const rates = useRates();

  const takeSnapshot = useAppMutation(async () => {
    if (!accounts.data || !transactions.data || !rates.data) return;
    const balances = computeBalances(accounts.data, transactions.data);
    const { total } = computeNetWorth(accounts.data, balances, rates.data.usdPer, "USD");
    await repo.takeSnapshot({
      snapshotDate: todayISO(),
      balances: Object.fromEntries(balances),
      usdPer: rates.data.usdPer,
      totalUsd: total,
    });
  }, [KEYS.snapshots]);

  if (!accounts.data || !transactions.data || !categories.data || !rates.data || snapshots.isLoading) {
    return <Spinner />;
  }

  const usdPer = rates.data.usdPer;
  const today = todayISO();
  const fmt = (v: number) => formatAmount(v, displayCurrency, locale);
  const currencyOf = new Map(accounts.data.map((a) => [a.id, a.currency] as const));
  const categoryById = new Map(categories.data.map((c) => [c.id, c]));

  // ---- net-worth history (snapshots are stored in USD; shown in display currency at current rates)
  const historyData = (snapshots.data ?? []).map((s) => ({
    date: s.snapshotDate,
    total: convert(s.totalUsd, "USD", displayCurrency, usdPer) ?? s.totalUsd,
  }));

  // ---- allocation by currency (current balances)
  const balances = computeBalances(accounts.data, transactions.data);
  const allocation = CURRENCIES.map((currency) => {
    let sum = 0;
    for (const a of accounts.data!) {
      if (a.archived || a.currency !== currency) continue;
      const converted = convert(balances.get(a.id) ?? 0, a.currency, displayCurrency, usdPer);
      if (converted != null && converted > 0) sum += converted;
    }
    return { currency, value: Math.round(sum * 100) / 100 };
  }).filter((s) => s.value > 0);
  const allocationTotal = allocation.reduce((s, a) => s + a.value, 0);

  // ---- 12-month series: total income/expense + per-category expense
  const months: string[] = [];
  for (let i = 11; i >= 0; i--) months.push(addMonthsClamped(today, -i).slice(0, 7));
  const monthIndex = new Map(months.map((m, i) => [m, i]));
  const totals = months.map((month) => ({ month, income: 0, expense: 0 }));
  const byCategory = new Map<string, number[]>();
  const incomeByCategory = new Map<string | null, number>();
  const thisYear = today.slice(0, 4);
  let yearIncome = 0;
  let yearExpense = 0;

  for (const tx of transactions.data) {
    if (tx.status !== "completed" || tx.transferGroupId) continue;
    const idx = monthIndex.get(tx.dueDate.slice(0, 7));
    const currency = currencyOf.get(tx.accountId);
    if (!currency) continue;
    const converted = convert(tx.amount, currency, displayCurrency, tx.fxSnapshot?.usdPer ?? usdPer);
    if (converted == null) continue;
    if (idx != null) {
      if (tx.direction === "income") totals[idx].income += converted;
      else {
        totals[idx].expense += converted;
        if (tx.categoryId) {
          const series = byCategory.get(tx.categoryId) ?? new Array(12).fill(0);
          series[idx] += converted;
          byCategory.set(tx.categoryId, series);
        }
      }
    }
    if (tx.dueDate.slice(0, 4) === thisYear) {
      if (tx.direction === "income") {
        yearIncome += converted;
        incomeByCategory.set(tx.categoryId, (incomeByCategory.get(tx.categoryId) ?? 0) + converted);
      } else yearExpense += converted;
    }
  }

  const topCategories = [...byCategory.entries()]
    .map(([id, series]) => ({ id, total: series.reduce((s, v) => s + v, 0), series }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);
  const trendData = months.map((month, i) => {
    const row: Record<string, number | string> = { month };
    for (const c of topCategories) row[c.id] = Math.round(c.series[i] * 100) / 100;
    return row;
  });

  const incomeSplit = [...incomeByCategory.entries()]
    .map(([id, total]) => ({
      name: id ? (categoryById.get(id)?.name ?? "—") : "—",
      color: id ? (categoryById.get(id)?.color ?? "#898781") : "#898781",
      total,
    }))
    .sort((a, b) => b.total - a.total);
  const incomeMax = Math.max(...incomeSplit.map((s) => s.total), 1);

  const fx = computeFxInsights({ transactions: transactions.data, accounts: accounts.data, usdPer, display: displayCurrency });

  return (
    <div className="mx-auto max-w-6xl space-y-4 3xl:max-w-[1700px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">{t("reports.title")}</h1>
        <div className="flex items-center gap-3 text-sm text-zinc-500">
          <span>
            {t("reports.thisYear")}: <span className="font-semibold text-emerald-600">{fmt(yearIncome)}</span> /{" "}
            <span className="font-semibold">{fmt(yearExpense)}</span> ·{" "}
            <span className={`font-semibold ${yearIncome - yearExpense >= 0 ? "text-emerald-600" : "text-red-600"}`}>
              {fmt(yearIncome - yearExpense)}
            </span>
          </span>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {/* net worth history */}
        <Card>
          <CardHeader
            title={`${t("reports.netWorthHistory")} (${displayCurrency})`}
            action={
              <Button variant="ghost" onClick={() => takeSnapshot.mutate(undefined as never)} title={t("reports.snapshotHint")}>
                ⊙ {t("reports.snapshotNow")}
              </Button>
            }
          />
          <div className="h-64 p-3">
            {historyData.length === 0 ? (
              <EmptyState>{t("reports.noSnapshots")}</EmptyState>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={historyData} margin={{ top: 8, right: 12, bottom: 0, left: 8 }}>
                  <CartesianGrid stroke="var(--viz-grid)" strokeWidth={1} vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--viz-muted)" }} tickLine={false} axisLine={{ stroke: "var(--viz-axis)" }} />
                  <YAxis tick={{ fontSize: 11, fill: "var(--viz-muted)" }} tickLine={false} axisLine={false} width={70}
                    tickFormatter={(v: number) => Intl.NumberFormat(locale, { notation: "compact" }).format(v)} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v) => fmt(Number(v))} />
                  <Line type="monotone" dataKey="total" name={t("dashboard.netWorth")} stroke="var(--viz-series-1)" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        {/* allocation donut */}
        <Card>
          <CardHeader title={`${t("reports.allocation")} (${displayCurrency})`} />
          <div className="flex h-64 flex-wrap items-center justify-center gap-4 p-3">
            <div className="h-52 w-52">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={allocation}
                    dataKey="value"
                    nameKey="currency"
                    cx="50%"
                    cy="50%"
                    innerRadius={58}
                    outerRadius={92}
                    paddingAngle={2}
                    stroke="var(--viz-tooltip-bg)"
                    strokeWidth={2}
                    isAnimationActive={false}
                  >
                    {allocation.map((entry) => (
                      <Cell key={entry.currency} fill={CURRENCY_SLOT[entry.currency]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} formatter={(v) => fmt(Number(v))} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="w-44 space-y-1.5">
              {allocation.map((entry) => (
                <div key={entry.currency} className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: CURRENCY_SLOT[entry.currency] }} />
                    {entry.currency === "XAU_G" ? "GOLD" : entry.currency}
                  </span>
                  <span className="tabular-nums text-zinc-500">
                    {allocationTotal > 0 ? Math.round((entry.value / allocationTotal) * 100) : 0}% · {fmt(entry.value)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Card>

        {/* category trends */}
        <Card>
          <CardHeader title={`${t("reports.categoryTrends")} (${displayCurrency})`} />
          <div className="h-64 p-3">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData} margin={{ top: 8, right: 12, bottom: 0, left: 8 }}>
                <CartesianGrid stroke="var(--viz-grid)" strokeWidth={1} vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--viz-muted)" }} tickLine={false} axisLine={{ stroke: "var(--viz-axis)" }} />
                <YAxis tick={{ fontSize: 11, fill: "var(--viz-muted)" }} tickLine={false} axisLine={false} width={70}
                  tickFormatter={(v: number) => Intl.NumberFormat(locale, { notation: "compact" }).format(v)} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => fmt(Number(v))} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {topCategories.map((c, i) => (
                  <Line
                    key={c.id}
                    type="monotone"
                    dataKey={c.id}
                    name={categoryById.get(c.id)?.name ?? "—"}
                    stroke={TREND_SLOTS[i]}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* income split */}
        <Card>
          <CardHeader title={`${t("reports.incomeSplit")} — ${thisYear} (${displayCurrency})`} />
          <div className="space-y-2 p-4">
            {incomeSplit.length === 0 ? (
              <p className="text-sm text-zinc-400">—</p>
            ) : (
              incomeSplit.map((s) => (
                <div key={s.name}>
                  <div className="mb-0.5 flex justify-between text-xs">
                    <span className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-300">
                      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                      {s.name}
                    </span>
                    <span className="font-medium tabular-nums">{fmt(s.total)}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                    <div className="h-full rounded-full" style={{ width: `${(s.total / incomeMax) * 100}%`, backgroundColor: s.color }} />
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      {/* FX insights */}
      <Card>
        <CardHeader title={`${t("reports.fxInsights")} (${displayCurrency})`} />
        {fx.conversions.length === 0 ? (
          <div className="p-4">
            <EmptyState>{t("reports.noConversions")}</EmptyState>
          </div>
        ) : (
          <div className="space-y-3 p-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800/60">
                <div className="text-xs text-zinc-500">{t("reports.avgSpread")}</div>
                <div className={`text-lg font-bold tabular-nums ${(fx.avgSpreadPct ?? 0) < 0 ? "text-red-600" : "text-emerald-600"}`}>
                  {fx.avgSpreadPct != null ? `${fx.avgSpreadPct.toFixed(2)}%` : "—"}
                </div>
              </div>
              <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800/60">
                <div className="text-xs text-zinc-500">{t("reports.totalSpreadCost")}</div>
                <div className="text-lg font-bold tabular-nums text-red-600">{fmt(fx.totalSpreadCost)}</div>
              </div>
              <div className="rounded-lg bg-zinc-50 p-3 text-xs dark:bg-zinc-800/60">
                <div className="text-zinc-500">
                  {t("reports.bestConversion")}:{" "}
                  <span className="font-medium text-emerald-600">{fx.best?.spread != null ? `${fx.best.spread.toFixed(2)}%` : "—"}</span>
                </div>
                <div className="mt-1 text-zinc-500">
                  {t("reports.worstConversion")}:{" "}
                  <span className="font-medium text-red-600">{fx.worst?.spread != null ? `${fx.worst.spread.toFixed(2)}%` : "—"}</span>
                </div>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm tabular-nums">
                <thead>
                  <tr className="text-left text-xs text-zinc-400">
                    <th className="px-2 py-1 font-medium">{t("common.date")}</th>
                    <th className="px-2 py-1 font-medium">{t("reports.conversions")}</th>
                    <th className="px-2 py-1 text-right font-medium">{t("reports.yourRate")}</th>
                    <th className="px-2 py-1 text-right font-medium">{t("reports.marketRate")}</th>
                    <th className="px-2 py-1 text-right font-medium">{t("transfer.spread")}</th>
                  </tr>
                </thead>
                <tbody>
                  {fx.conversions.slice(0, 20).map((c, i) => (
                    <tr key={i} className="border-t border-zinc-100 dark:border-zinc-800">
                      <td className="px-2 py-1.5">{c.date}</td>
                      <td className="px-2 py-1.5">
                        {formatAmount(c.fromAmount, c.fromCurrency, locale)} → {formatAmount(c.toAmount, c.toCurrency, locale)}
                      </td>
                      <td className="px-2 py-1.5 text-right">{c.effective.toLocaleString(locale, { maximumFractionDigits: 4 })}</td>
                      <td className="px-2 py-1.5 text-right">{c.market != null ? c.market.toLocaleString(locale, { maximumFractionDigits: 4 }) : "—"}</td>
                      <td className={`px-2 py-1.5 text-right font-medium ${c.spread != null && c.spread < -0.05 ? "text-red-600" : "text-zinc-500"}`}>
                        {c.spread != null ? `${c.spread.toFixed(2)}%` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Card>

      {/* month by month table */}
      <Card>
        <CardHeader title={`${t("reports.monthlyTable")} (${displayCurrency})`} />
        <div className="overflow-x-auto p-2">
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="text-left text-xs text-zinc-400">
                <th className="px-2 py-1 font-medium">{t("projections.month")}</th>
                <th className="px-2 py-1 text-right font-medium">{t("reports.income")}</th>
                <th className="px-2 py-1 text-right font-medium">{t("reports.expenses")}</th>
                <th className="px-2 py-1 text-right font-medium">{t("reports.net")}</th>
              </tr>
            </thead>
            <tbody>
              {[...totals].reverse().map((row) => (
                <tr key={row.month} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="px-2 py-1.5">{row.month}</td>
                  <td className="px-2 py-1.5 text-right text-emerald-600">{fmt(row.income)}</td>
                  <td className="px-2 py-1.5 text-right">{fmt(row.expense)}</td>
                  <td className={`px-2 py-1.5 text-right font-medium ${row.income - row.expense >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                    {fmt(row.income - row.expense)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
