"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button, Card, CardHeader, Spinner } from "@/components/ui";
import { useApp } from "@/lib/data/provider";
import { useAccounts, useRates, useTemplates, useTransactions } from "@/lib/data/queries";
import { formatAmount } from "@/lib/domain/currencies";
import { projectCashflow } from "@/lib/domain/projector";
import { todayISO } from "@/lib/domain/recurrence";
import { useI18n } from "@/lib/i18n";

const tooltipStyle = {
  backgroundColor: "var(--viz-tooltip-bg)",
  border: "1px solid var(--viz-grid)",
  borderRadius: 8,
  fontSize: 12,
};

export default function ProjectionsPage() {
  const { t, locale } = useI18n();
  const { displayCurrency } = useApp();
  const accounts = useAccounts();
  const transactions = useTransactions();
  const templates = useTemplates();
  const rates = useRates();
  const [months, setMonths] = useState<12 | 24>(12);

  const projection = useMemo(() => {
    if (!accounts.data || !transactions.data || !templates.data || !rates.data) return null;
    return projectCashflow({
      accounts: accounts.data,
      transactions: transactions.data,
      templates: templates.data,
      usdPer: rates.data.usdPer,
      display: displayCurrency,
      fromDate: todayISO(),
      months,
    });
  }, [accounts.data, transactions.data, templates.data, rates.data, displayCurrency, months]);

  if (!projection) return <Spinner />;

  const fmt = (v: number) => formatAmount(v, displayCurrency, locale);
  const chartData = projection.months.map((m) => ({
    month: m.month,
    [t("dashboard.income")]: Math.round(m.income * 100) / 100,
    [t("dashboard.expense")]: Math.round(m.expense * 100) / 100,
    endNetWorth: Math.round(m.endNetWorth * 100) / 100,
  }));
  const end = projection.months[projection.months.length - 1];

  return (
    <div className="mx-auto max-w-6xl space-y-4 3xl:max-w-[1600px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">{t("projections.title")}</h1>
          <p className="text-sm text-zinc-500">{t("projections.hint")}</p>
        </div>
        <div className="flex gap-2">
          <Button variant={months === 12 ? "primary" : "secondary"} onClick={() => setMonths(12)}>
            {t("projections.months12")}
          </Button>
          <Button variant={months === 24 ? "primary" : "secondary"} onClick={() => setMonths(24)}>
            {t("projections.months24")}
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Card className="p-4">
          <div className="text-xs text-zinc-500">{t("projections.startNetWorth")}</div>
          <div className="mt-1 text-2xl font-bold">{fmt(projection.startNetWorth)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-zinc-500">{t("projections.endNetWorth")}</div>
          <div className={`mt-1 text-2xl font-bold ${end && end.endNetWorth >= projection.startNetWorth ? "text-emerald-600" : "text-red-600"}`}>
            {end ? fmt(end.endNetWorth) : "—"}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title={`${t("projections.endOfMonth")} (${displayCurrency})`} />
          <div className="h-72 p-3">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: 8 }}>
                <CartesianGrid stroke="var(--viz-grid)" strokeWidth={1} vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--viz-muted)" }} tickLine={false} axisLine={{ stroke: "var(--viz-axis)" }} />
                <YAxis tick={{ fontSize: 11, fill: "var(--viz-muted)" }} tickLine={false} axisLine={false} width={70}
                  tickFormatter={(v: number) => Intl.NumberFormat(locale, { notation: "compact" }).format(v)} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => fmt(Number(v))} />
                <Line type="monotone" dataKey="endNetWorth" name={t("dashboard.netWorth")} stroke="var(--viz-series-1)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <CardHeader title={`${t("dashboard.monthlyFlow")} (${displayCurrency})`} />
          <div className="h-72 p-3">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: 8 }} barGap={2}>
                <CartesianGrid stroke="var(--viz-grid)" strokeWidth={1} vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--viz-muted)" }} tickLine={false} axisLine={{ stroke: "var(--viz-axis)" }} />
                <YAxis tick={{ fontSize: 11, fill: "var(--viz-muted)" }} tickLine={false} axisLine={false} width={70}
                  tickFormatter={(v: number) => Intl.NumberFormat(locale, { notation: "compact" }).format(v)} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => fmt(Number(v))} cursor={{ fill: "var(--viz-grid)", opacity: 0.4 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey={t("dashboard.income")} fill="var(--viz-series-1)" radius={[4, 4, 0, 0]} maxBarSize={18} />
                <Bar dataKey={t("dashboard.expense")} fill="var(--viz-series-2)" radius={[4, 4, 0, 0]} maxBarSize={18} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {projection.skippedAccountIds.length > 0 ? (
        <p className="text-xs text-amber-600">{t("dashboard.skippedAccounts")}</p>
      ) : null}

      {/* table view — the accessible reading of the same numbers */}
      <Card>
        <CardHeader title={t("projections.title")} />
        <div className="overflow-x-auto p-2">
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="text-left text-xs text-zinc-400">
                <th className="px-2 py-1 font-medium">{t("projections.month")}</th>
                <th className="px-2 py-1 text-right font-medium">{t("dashboard.income")}</th>
                <th className="px-2 py-1 text-right font-medium">{t("dashboard.expense")}</th>
                <th className="px-2 py-1 text-right font-medium">{t("dashboard.net")}</th>
                <th className="px-2 py-1 text-right font-medium">{t("projections.endOfMonth")}</th>
              </tr>
            </thead>
            <tbody>
              {projection.months.map((m) => (
                <tr key={m.month} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="px-2 py-1.5">{m.month}</td>
                  <td className="px-2 py-1.5 text-right text-emerald-600">{fmt(m.income)}</td>
                  <td className="px-2 py-1.5 text-right">{fmt(m.expense)}</td>
                  <td className={`px-2 py-1.5 text-right font-medium ${m.net >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                    {m.net >= 0 ? "+" : ""}
                    {fmt(m.net)}
                  </td>
                  <td className="px-2 py-1.5 text-right font-semibold">{fmt(m.endNetWorth)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
