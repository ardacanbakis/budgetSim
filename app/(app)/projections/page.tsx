"use client";

import { useState } from "react";
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
import { Button, Card, CardHeader, Field, Input, Select, Spinner } from "@/components/ui";
import { useApp } from "@/lib/data/provider";
import { useAccounts, useCategories, useRates, useTemplates, useTransactions } from "@/lib/data/queries";
import { formatAmount } from "@/lib/domain/currencies";
import { projectCashflow } from "@/lib/domain/projector";
import { projectWithScenario, ProjectionInputs } from "@/lib/domain/scenarios";
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
  const categories = useCategories();
  const [months, setMonths] = useState<12 | 24>(12);

  // scenario controls (session-only; no persistence needed)
  const [loseIncomeOn, setLoseIncomeOn] = useState(false);
  const [loseIncomeCategory, setLoseIncomeCategory] = useState("");
  const [devalOn, setDevalOn] = useState(false);
  const [devalPct, setDevalPct] = useState("25");
  const [oneOffOn, setOneOffOn] = useState(false);
  const [oneOffAmount, setOneOffAmount] = useState("");
  const [oneOffMonth, setOneOffMonth] = useState("2");

  const inputs: ProjectionInputs | null =
    accounts.data && transactions.data && templates.data && rates.data
      ? {
          accounts: accounts.data,
          transactions: transactions.data,
          templates: templates.data,
          usdPer: rates.data.usdPer,
          display: displayCurrency,
          fromDate: todayISO(),
          months,
        }
      : null;

  // recomputed per render (React compiler memoizes); pure + fast at this scale
  const projection = inputs ? projectCashflow(inputs) : null;

  if (!projection || !inputs) return <Spinner />;

  const incomeCategories = (categories.data ?? []).filter((c) => c.direction === "income");
  const effectiveLoseCategory = loseIncomeCategory || incomeCategories[0]?.id || "";

  const overlays: { key: string; name: string; color: string; months: typeof projection.months }[] = [];
  if (loseIncomeOn && effectiveLoseCategory) {
    overlays.push({
      key: "loseIncome",
      name: `${t("scenarios.loseIncome")}: ${incomeCategories.find((c) => c.id === effectiveLoseCategory)?.name ?? ""}`,
      color: "var(--viz-series-3)",
      months: projectWithScenario(inputs, { type: "loseIncome", categoryId: effectiveLoseCategory }).months,
    });
  }
  if (devalOn && Number(devalPct) > 0) {
    overlays.push({
      key: "deval",
      name: `TRY −${devalPct}%`,
      color: "var(--viz-series-5)",
      months: projectWithScenario(inputs, { type: "tryDevaluation", pct: Number(devalPct) }).months,
    });
  }
  if (oneOffOn && Number(oneOffAmount) > 0) {
    overlays.push({
      key: "oneOff",
      name: `${t("scenarios.oneOff")} ${formatAmount(Number(oneOffAmount), displayCurrency, locale)}`,
      color: "var(--viz-series-2)",
      months: projectWithScenario(inputs, {
        type: "oneOffExpense",
        amount: Number(oneOffAmount),
        monthOffset: Math.max(0, Math.min(months - 1, Math.floor(Number(oneOffMonth) || 0))),
      }).months,
    });
  }

  const fmt = (v: number) => formatAmount(v, displayCurrency, locale);
  const chartData = projection.months.map((m, i) => {
    const row: Record<string, number | string> = {
      month: m.month,
      [t("dashboard.income")]: Math.round(m.income * 100) / 100,
      [t("dashboard.expense")]: Math.round(m.expense * 100) / 100,
      endNetWorth: Math.round(m.endNetWorth * 100) / 100,
    };
    for (const overlay of overlays) row[overlay.key] = Math.round(overlay.months[i].endNetWorth * 100) / 100;
    return row;
  });
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

      {/* what-if scenarios */}
      <Card>
        <CardHeader title={t("scenarios.title")} />
        <div className="grid gap-3 p-4 sm:grid-cols-3">
          <label className="flex cursor-pointer flex-col gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
            <span className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" className="h-4 w-4 accent-teal-600" checked={loseIncomeOn} onChange={(e) => setLoseIncomeOn(e.target.checked)} />
              {t("scenarios.loseIncome")}
            </span>
            {loseIncomeOn ? (
              <Select value={effectiveLoseCategory} onChange={(e) => setLoseIncomeCategory(e.target.value)}>
                {incomeCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            ) : (
              <span className="text-xs text-zinc-400">{t("scenarios.loseIncomeHint")}</span>
            )}
          </label>
          <label className="flex cursor-pointer flex-col gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
            <span className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" className="h-4 w-4 accent-teal-600" checked={devalOn} onChange={(e) => setDevalOn(e.target.checked)} />
              {t("scenarios.deval")}
            </span>
            {devalOn ? (
              <div className="flex items-center gap-2">
                <input type="range" min="5" max="60" step="5" value={devalPct} onChange={(e) => setDevalPct(e.target.value)} className="flex-1 accent-teal-600" />
                <span className="w-12 text-right text-sm font-semibold tabular-nums">−{devalPct}%</span>
              </div>
            ) : (
              <span className="text-xs text-zinc-400">{t("scenarios.devalHint")}</span>
            )}
          </label>
          <label className="flex cursor-pointer flex-col gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
            <span className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" className="h-4 w-4 accent-teal-600" checked={oneOffOn} onChange={(e) => setOneOffOn(e.target.checked)} />
              {t("scenarios.oneOff")}
            </span>
            {oneOffOn ? (
              <div className="grid grid-cols-2 gap-2">
                <Field label={`${t("common.amount")} (${displayCurrency})`}>
                  <Input type="number" step="any" min="0" value={oneOffAmount} onChange={(e) => setOneOffAmount(e.target.value)} />
                </Field>
                <Field label={t("scenarios.inMonths")}>
                  <Input type="number" step="1" min="0" max={months - 1} value={oneOffMonth} onChange={(e) => setOneOffMonth(e.target.value)} />
                </Field>
              </div>
            ) : (
              <span className="text-xs text-zinc-400">{t("scenarios.oneOffHint")}</span>
            )}
          </label>
        </div>
      </Card>

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
                {overlays.length > 0 ? <Legend wrapperStyle={{ fontSize: 12 }} /> : null}
                <Line type="monotone" dataKey="endNetWorth" name={t("dashboard.netWorth")} stroke="var(--viz-series-1)" strokeWidth={2} dot={false} isAnimationActive={false} activeDot={{ r: 4 }} />
                {overlays.map((overlay) => (
                  <Line
                    key={overlay.key}
                    type="monotone"
                    dataKey={overlay.key}
                    name={overlay.name}
                    stroke={overlay.color}
                    strokeWidth={2}
                    strokeDasharray="6 4"
                    dot={false}
                    isAnimationActive={false}
                    activeDot={{ r: 4 }}
                  />
                ))}
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
