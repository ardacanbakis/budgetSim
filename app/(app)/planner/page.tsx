"use client";

import { Fragment, useEffect, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { HorizonSlider, horizonLabel } from "@/components/horizonSlider";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Modal, Select, Spinner } from "@/components/ui";
import { useApp } from "@/lib/data/provider";
import { useAccounts, useCategories, useRates, useTemplates, useTransactions } from "@/lib/data/queries";
import { TxDirection } from "@/lib/data/types";
import { CURRENCIES, Currency, formatAmount } from "@/lib/domain/currencies";
import {
  addMonthKey,
  averageMonthlyNet,
  buildRatePath,
  CategoryBudget,
  EMPTY_PLAN,
  itemHorizonTotal,
  Plan,
  PlanFrequency,
  PlanItem,
  planExtraFlows,
  planIsEmpty,
  planMilestones,
  monthsBetween,
  planDroppedIncome,
  planReplacedCategories,
  retentionFactor,
} from "@/lib/domain/planner";
import { projectCashflow } from "@/lib/domain/projector";
import { todayISO } from "@/lib/domain/recurrence";
import { averageMonthlySpend } from "@/lib/domain/stats";
import { useI18n } from "@/lib/i18n";

const tooltipStyle = {
  backgroundColor: "var(--viz-tooltip-bg)",
  border: "1px solid var(--viz-grid)",
  borderRadius: 8,
  fontSize: 12,
};

// device-local: a plan is a scratchpad, not shared data
const PLAN_KEY = "renovator-plan-v1";
const HORIZON_KEY = "renovator-plan-horizon";
const LAYOUT_KEY = "renovator-plan-layout";

const uid = () => Math.random().toString(36).slice(2, 10);

/** "2028-03" → "Mar 2028" */
function monthLabelOf(month: string, locale: string): string {
  return new Date(`${month}-01T00:00:00`).toLocaleDateString(locale === "tr" ? "tr-TR" : "en-US", {
    month: "short",
    year: "numeric",
  });
}

export default function PlannerPage() {
  const { t, locale } = useI18n();
  const { displayCurrency } = useApp();
  const accounts = useAccounts();
  const transactions = useTransactions();
  const templates = useTemplates();
  const categories = useCategories();
  const rates = useRates();

  const [months, setMonths] = useState(60);
  const [plan, setPlan] = useState<Plan>(EMPTY_PLAN);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<PlanItem | null>(null);
  const [adding, setAdding] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // two columns by default: inputs beside the picture they change
  const [twoColumn, setTwoColumn] = useState(true);

  const toggleMonth = (month: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(month)) next.delete(month);
      else next.add(month);
      return next;
    });

  // deferred: restore the saved plan after hydration
  useEffect(() => {
    queueMicrotask(() => {
      try {
        const raw = window.localStorage.getItem(PLAN_KEY);
        if (raw) {
          const saved = JSON.parse(raw) as Plan;
          if (Array.isArray(saved.items) && Array.isArray(saved.budgets)) {
            // older saved plans predate per-entry currency and devaluation
            setPlan({
              devaluation: saved.devaluation ?? EMPTY_PLAN.devaluation,
              lostIncome: saved.lostIncome ?? [],
              items: saved.items.map((i) => ({
                ...i,
                currency: i.currency ?? "USD",
                inflates: i.inflates ?? true,
                // plans saved before start months were real dates stored an offset
                startMonth:
                  typeof i.startMonth === "number"
                    ? addMonthKey(todayISO().slice(0, 7), i.startMonth)
                    : i.startMonth,
              })),
              budgets: saved.budgets.map((b) => ({ ...b, currency: b.currency ?? "USD", label: b.label ?? "" })),
            });
          }
        }
        const savedHorizon = Number(window.localStorage.getItem(HORIZON_KEY));
        if (savedHorizon >= 1 && savedHorizon <= 120) setMonths(savedHorizon);
        if (window.localStorage.getItem(LAYOUT_KEY) === "single") setTwoColumn(false);
      } catch {
        // corrupted → start empty
      }
      setLoaded(true);
    });
  }, []);

  const persist = (next: Plan) => {
    setPlan(next);
    window.localStorage.setItem(PLAN_KEY, JSON.stringify(next));
  };
  const setHorizon = (m: number) => {
    setMonths(m);
    window.localStorage.setItem(HORIZON_KEY, String(m));
  };
  const setLayout = (two: boolean) => {
    setTwoColumn(two);
    window.localStorage.setItem(LAYOUT_KEY, two ? "two" : "single");
  };

  if (!accounts.data || !transactions.data || !templates.data || !categories.data || !rates.data || !loaded) {
    return <Spinner />;
  }

  const firstMonth = todayISO().slice(0, 7);

  const base = projectCashflow({
    accounts: accounts.data,
    transactions: transactions.data,
    templates: templates.data,
    usdPer: rates.data.usdPer,
    display: displayCurrency,
    fromDate: todayISO(),
    months,
  });
  // the plan re-runs the same engine with its own rate path and flows, so the
  // two lines differ only by the assumptions themselves
  const planned = projectCashflow({
    accounts: accounts.data,
    transactions: transactions.data,
    templates: templates.data,
    usdPer: rates.data.usdPer,
    display: displayCurrency,
    fromDate: todayISO(),
    months,
    ratePath: buildRatePath(rates.data.usdPer, plan.devaluation),
    extraFlows: planExtraFlows(plan, months, firstMonth),
    replaceCategories: planReplacedCategories(plan),
    dropIncomeCategories: planDroppedIncome(plan),
  });

  // pre-fill suggestions from what the user actually spends
  const spend = averageMonthlySpend({
    transactions: transactions.data,
    accounts: accounts.data,
    categories: categories.data,
    usdPer: rates.data.usdPer,
    display: displayCurrency,
    windowMonths: 3,
    today: todayISO(),
  });
  const averageByCategory = new Map(spend.categories.map((c) => [c.categoryId ?? "", c.monthlyAverage]));

  const fmt = (v: number) => formatAmount(v, displayCurrency, locale);
  const categoryName = (id: string) => categories.data?.find((c) => c.id === id)?.name ?? "";
  const expenseCategories = categories.data.filter((c) => c.direction === "expense");
  const incomeCategories = categories.data.filter((c) => c.direction === "income");
  const budgetByCategory = new Map(plan.budgets.map((b) => [b.categoryId, b]));

  const baseEnd = base.months[base.months.length - 1]?.endNetWorth ?? base.startNetWorth;
  const planEnd = planned.months[planned.months.length - 1]?.endNetWorth ?? planned.startNetWorth;
  const delta = planEnd - baseEnd;
  const hasPlan = !planIsEmpty(plan);

  const chartData = planned.months.map((m, i) => ({
    month: m.month,
    plan: Math.round(m.endNetWorth * 100) / 100,
    base: Math.round(base.months[i].endNetWorth * 100) / 100,
  }));

  const milestones = planMilestones(planned);
  const baseMilestones = new Map(planMilestones(base).map((m) => [m.months, m.netWorth]));

  const setBudget = (categoryId: string, patch: Partial<CategoryBudget>) => {
    const existing = budgetByCategory.get(categoryId);
    const name = categories.data?.find((c) => c.id === categoryId)?.name ?? "";
    const next = existing
      ? plan.budgets.map((b) => (b.categoryId === categoryId ? { ...b, ...patch } : b))
      : [...plan.budgets, { categoryId, label: name, monthlyAmount: 0, currency: displayCurrency, enabled: true, ...patch }];
    persist({ ...plan, budgets: next });
  };

  const saveItem = (item: PlanItem) => {
    const exists = plan.items.some((i) => i.id === item.id);
    persist({
      ...plan,
      items: exists ? plan.items.map((i) => (i.id === item.id ? item : i)) : [...plan.items, item],
    });
    setEditing(null);
    setAdding(false);
  };

  return (
    <div className="mx-auto max-w-6xl space-y-4 3xl:max-w-[1600px]">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">{t("planner.title")}</h1>
          <p className="text-sm text-zinc-500">{t("planner.hint")}</p>
        </div>
        <div className="no-print hidden gap-1 rounded-lg bg-[var(--edge-soft)] p-1 xl:flex">
          {([true, false] as const).map((two) => (
            <button
              key={String(two)}
              onClick={() => setLayout(two)}
              className={`rounded-md px-3 py-1 text-xs font-medium ${
                twoColumn === two ? "bg-[var(--surface)] shadow-sm" : "text-zinc-500"
              }`}
            >
              {two ? t("planner.layoutTwo") : t("planner.layoutSingle")}
            </button>
          ))}
        </div>
      </div>

      {/* headline: where you land, with and without the plan */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="p-4">
          <div className="text-xs text-zinc-500">{t("projections.startNetWorth")}</div>
          <div className="mt-1 text-2xl font-bold">{fmt(base.startNetWorth)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-zinc-500">
            {t("planner.endWithPlan")} · {horizonLabel(months, t)}
          </div>
          <div className={`mt-1 text-2xl font-bold ${planEnd >= base.startNetWorth ? "text-emerald-600" : "text-red-600"}`}>
            {fmt(planEnd)}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-zinc-500">{t("planner.vsToday")}</div>
          <div className={`mt-1 text-2xl font-bold ${delta >= 0 ? "text-emerald-600" : "text-red-600"}`}>
            {hasPlan ? `${delta >= 0 ? "+" : "−"}${fmt(Math.abs(delta))}` : "—"}
          </div>
          <div className="mt-0.5 text-xs text-zinc-400">{t("planner.vsBaseHint")}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-zinc-500">{t("planner.avgMonthly")}</div>
          <div className={`mt-1 text-2xl font-bold ${averageMonthlyNet(planned) >= 0 ? "text-emerald-600" : "text-red-600"}`}>
            {fmt(averageMonthlyNet(planned))}
          </div>
        </Card>
      </div>


      {/* inputs on the left, the picture on the right — editing an
          assumption redraws the chart beside it without scrolling */}
      <div className={twoColumn ? "grid items-start gap-4 xl:grid-cols-2" : "space-y-4"}>
        <div className="space-y-4">
        {/* the assumption that dominates a 10-year view from Turkey */}
        <Card>
          <CardHeader title={t("planner.devalTitle")} />
          <div className="space-y-3 p-4">
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-teal-600"
                checked={plan.devaluation.enabled}
                onChange={(e) => persist({ ...plan, devaluation: { ...plan.devaluation, enabled: e.target.checked } })}
              />
              <span>
                <span className="block text-sm font-medium">{t("planner.devalEnable")}</span>
                <span className="block text-xs text-zinc-500">{t("planner.devalHint")}</span>
              </span>
            </label>
            {plan.devaluation.enabled ? (
              <>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min="1"
                    max="60"
                    step="1"
                    value={plan.devaluation.pctPerYear}
                    onChange={(e) =>
                      persist({ ...plan, devaluation: { ...plan.devaluation, pctPerYear: Number(e.target.value) } })
                    }
                    className="flex-1 accent-teal-600"
                    aria-label={t("planner.devalRate")}
                  />
                  <span className="w-28 text-right text-sm font-semibold tabular-nums">
                    −{plan.devaluation.pctPerYear}% {t("planner.perYear")}
                  </span>
                </div>
                <p className="text-xs text-zinc-500">
                  {t("planner.devalExplain", {
                    years: Math.max(1, Math.round(months / 12)),
                    pct: Math.round((1 - retentionFactor(plan.devaluation, months)) * 100),
                  })}
                </p>
              </>
            ) : null}
          </div>
        </Card>

        {/* what if an income source stops */}
        <Card>
          <CardHeader title={t("planner.lostIncomeTitle")} />
          <div className="space-y-2 p-4">
            <p className="text-xs text-zinc-500">{t("planner.lostIncomeHint")}</p>
            <div className="flex flex-wrap gap-1.5">
              {incomeCategories.map((c) => {
                const lost = plan.lostIncome.includes(c.id);
                return (
                  <button
                    key={c.id}
                    onClick={() =>
                      persist({
                        ...plan,
                        lostIncome: lost
                          ? plan.lostIncome.filter((id) => id !== c.id)
                          : [...plan.lostIncome, c.id],
                      })
                    }
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition-all ${
                      lost ? "border-red-500 bg-red-500 text-white line-through" : "text-zinc-500 hover:opacity-80"
                    }`}
                    style={lost ? undefined : { borderColor: c.color }}
                  >
                    {c.name}
                  </button>
                );
              })}
            </div>
          </div>
        </Card>

        {/* what-if items */}
        <Card>
          <CardHeader
            title={t("planner.itemsTitle")}
            action={
              <Button variant="primary" onClick={() => setAdding(true)}>
                + {t("planner.addItem")}
              </Button>
            }
          />
          {plan.items.length === 0 ? (
            <div className="p-4">
              <EmptyState>{t("planner.itemsEmpty")}</EmptyState>
            </div>
          ) : (
            <ul className="divide-y divide-[var(--edge-soft)]">
              {plan.items.map((item) => (
                <li key={item.id} className={`flex items-center gap-3 px-4 py-3 ${item.enabled ? "" : "opacity-50"}`}>
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-teal-600"
                    checked={item.enabled}
                    onChange={(e) => persist({ ...plan, items: plan.items.map((i) => (i.id === item.id ? { ...i, enabled: e.target.checked } : i)) })}
                    aria-label={item.label}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium">{item.label}</span>
                      <Badge tone={item.direction === "income" ? "green" : "red"}>
                        {t(`tx.${item.direction}`)}
                      </Badge>
                      <Badge tone="zinc">{t(`planner.freq_${item.frequency}`)}</Badge>
                    </div>
                    <div className="mt-0.5 text-xs text-zinc-500">
                      {t("planner.startsOn", { month: monthLabelOf(item.startMonth, locale) })}
                      {item.frequency !== "once"
                        ? ` · ${
                            item.durationMonths != null
                              ? t("planner.untilMonth", {
                                  month: monthLabelOf(addMonthKey(item.startMonth, item.durationMonths - 1), locale),
                                })
                              : t("planner.ongoing")
                          }`
                        : ""}
                      {" · "}
                      {t("planner.horizonTotal", { amount: formatAmount(itemHorizonTotal(item, months, plan.devaluation, firstMonth), item.currency, locale) })}
                    </div>
                  </div>
                  <span className={`text-sm font-semibold tabular-nums ${item.direction === "income" ? "text-green-600" : "text-red-600"}`}>
                    {item.direction === "income" ? "+" : "−"}
                    {formatAmount(item.amount, item.currency, locale)}
                  </span>
                  <Button variant="ghost" aria-label={t("common.edit")} onClick={() => setEditing(item)}>
                    ✎
                  </Button>
                  <Button
                    variant="ghost"
                    aria-label={t("common.delete")}
                    onClick={() => persist({ ...plan, items: plan.items.filter((i) => i.id !== item.id) })}
                  >
                    ✕
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* monthly budgets for everyday spending */}
        <Card>
          <CardHeader title={t("planner.budgetsTitle")} />
          <div className="space-y-3 p-4">
            <p className="text-xs text-zinc-500">{t("planner.budgetsHint")}</p>
            <div className="space-y-2">
              {expenseCategories.map((c) => {
                const budget = budgetByCategory.get(c.id);
                const average = averageByCategory.get(c.id) ?? 0;
                return (
                  <div key={c.id} className="flex flex-wrap items-center gap-2">
                    <label className="flex min-w-40 flex-1 items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-teal-600"
                        checked={budget?.enabled ?? false}
                        onChange={(e) =>
                          setBudget(c.id, {
                            enabled: e.target.checked,
                            // first tick seeds from the real 3-month average
                            monthlyAmount: budget?.monthlyAmount || Math.round(average),
                          })
                        }
                      />
                      <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: c.color }} />
                      <span className="truncate">{c.name}</span>
                    </label>
                    {average > 0 ? (
                      <button
                        onClick={() =>
                          // the average is computed in the display currency, so
                          // adopt that currency along with the number
                          setBudget(c.id, {
                            enabled: true,
                            monthlyAmount: Math.round(average),
                            currency: displayCurrency,
                          })
                        }
                        className="text-[11px] text-teal-600 hover:underline"
                        title={t("planner.useAverageHint")}
                      >
                        {t("planner.useAverage", { amount: fmt(average) })}
                      </button>
                    ) : null}
                    <Input
                      type="number"
                      step="any"
                      min="0"
                      inputMode="decimal"
                      className="!w-32 text-right"
                      placeholder="0"
                      value={budget ? String(budget.monthlyAmount) : ""}
                      onChange={(e) => setBudget(c.id, { monthlyAmount: Number(e.target.value) || 0, enabled: true })}
                    />
                    <Select
                      className="!w-24"
                      aria-label={`${c.name} ${t("common.currency")}`}
                      value={budget?.currency ?? displayCurrency}
                      onChange={(e) => setBudget(c.id, { currency: e.target.value as Currency })}
                    >
                      {CURRENCIES.map((cur) => (
                        <option key={cur} value={cur}>
                          {cur === "XAU_G" ? "GOLD" : cur}
                        </option>
                      ))}
                    </Select>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>

        </div>

        <div className={twoColumn ? "space-y-4 xl:sticky xl:top-20" : "space-y-4"}>
          {/* the horizon lives with the chart it controls */}
          <Card className="p-4">
            <HorizonSlider months={months} onChange={setHorizon} />
          </Card>
        {/* the picture */}
        <Card>
          <CardHeader title={`${t("planner.chartTitle")} (${displayCurrency})`} />
          <div className="h-80 p-3">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: 8 }}>
                <CartesianGrid stroke="var(--viz-grid)" strokeWidth={1} vertical={false} />
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 11, fill: "var(--viz-muted)" }}
                  tickLine={false}
                  axisLine={{ stroke: "var(--viz-axis)" }}
                  interval="preserveStartEnd"
                  minTickGap={28}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "var(--viz-muted)" }}
                  tickLine={false}
                  axisLine={false}
                  width={70}
                  tickFormatter={(v: number) => Intl.NumberFormat(locale, { notation: "compact" }).format(v)}
                />
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => fmt(Number(v))} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line
                  type="monotone"
                  dataKey="base"
                  name={t("planner.baseLine")}
                  stroke="var(--viz-series-2)"
                  strokeWidth={2}
                  strokeDasharray="6 4"
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="plan"
                  name={t("planner.planLine")}
                  stroke="var(--viz-series-1)"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                  activeDot={{ r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {milestones.length > 0 ? (
          <Card>
            <CardHeader title={t("planner.milestones")} />
            <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-5">
              {milestones.map((m) => {
                const baseline = baseMilestones.get(m.months);
                const diff = baseline != null ? m.netWorth - baseline : null;
                return (
                  <div key={m.months} className="rounded-lg bg-[var(--edge-soft)] p-3">
                    <div className="text-xs font-medium text-zinc-500">{m.label}</div>
                    <div className="mt-0.5 font-bold tabular-nums">{fmt(m.netWorth)}</div>
                    {diff != null && hasPlan && Math.abs(diff) > 0.5 ? (
                      <div className={`text-[11px] tabular-nums ${diff >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                        {diff >= 0 ? "+" : "−"}
                        {fmt(Math.abs(diff))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </Card>
        ) : null}

        {/* the same numbers, readable */}
        <Card>
          <CardHeader title={t("projections.title")} />
          <div className="max-h-[28rem] overflow-auto p-2">
            <table className="w-full text-sm tabular-nums">
              <thead className="sticky top-0 bg-[var(--surface)]">
                <tr className="text-left text-xs text-zinc-400">
                  <th className="px-2 py-1 font-medium">{t("projections.month")}</th>
                  <th className="px-2 py-1 text-right font-medium">{t("dashboard.income")}</th>
                  <th className="px-2 py-1 text-right font-medium">{t("dashboard.expense")}</th>
                  <th className="px-2 py-1 text-right font-medium">{t("dashboard.net")}</th>
                  <th className="px-2 py-1 text-right font-medium">{t("projections.endOfMonth")}</th>
                </tr>
              </thead>
              <tbody>
                {planned.months.map((m) => {
                  const open = expanded.has(m.month);
                  return (
                    <Fragment key={m.month}>
                      <tr
                        className="cursor-pointer border-t border-zinc-100 hover:bg-[var(--edge-soft)] dark:border-zinc-800"
                        onClick={() => toggleMonth(m.month)}
                      >
                        <td className="px-2 py-1.5">
                          <button
                            className="flex items-center gap-1.5 text-left"
                            aria-expanded={open}
                            aria-label={monthLabelOf(m.month, locale)}
                          >
                            <span className="w-2 text-zinc-400">{open ? "▾" : "▸"}</span>
                            {monthLabelOf(m.month, locale)}
                          </button>
                        </td>
                        <td className="px-2 py-1.5 text-right text-emerald-600">{fmt(m.income)}</td>
                        <td className="px-2 py-1.5 text-right">{fmt(m.expense)}</td>
                        <td className={`px-2 py-1.5 text-right font-medium ${m.net >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                          {m.net >= 0 ? "+" : ""}
                          {fmt(m.net)}
                        </td>
                        <td className="px-2 py-1.5 text-right font-semibold">{fmt(m.endNetWorth)}</td>
                      </tr>
                      {open ? (
                        <tr className="border-t border-zinc-100 bg-[var(--edge-soft)]/60 dark:border-zinc-800">
                          <td colSpan={5} className="px-2 py-2">
                            {m.lines.length === 0 ? (
                              <p className="px-4 text-xs text-zinc-400">{t("planner.monthEmpty")}</p>
                            ) : (
                              <ul className="space-y-0.5">
                                {m.lines.map((line, i) => (
                                  <li key={i} className="flex items-center gap-2 px-4 text-xs">
                                    <span className="flex-1 truncate text-zinc-600 dark:text-zinc-300">
                                      {line.label || categoryName(line.categoryId) || t("common.none")}
                                    </span>
                                    {line.categoryId && categoryName(line.categoryId) && line.label ? (
                                      <span className="text-[10px] text-zinc-400">{categoryName(line.categoryId)}</span>
                                    ) : null}
                                    <span
                                      className={`w-28 text-right tabular-nums ${
                                        line.direction === "income" ? "text-emerald-600" : "text-red-600"
                                      }`}
                                    >
                                      {line.direction === "income" ? "+" : "−"}
                                      {fmt(line.amount)}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        </div>
      </div>

      <PlanItemModal
        open={adding || editing != null}
        initial={editing}
        currency={displayCurrency}
        firstMonth={firstMonth}
        onClose={() => {
          setAdding(false);
          setEditing(null);
        }}
        onSave={saveItem}
      />
    </div>
  );
}

function PlanItemModal({
  open,
  initial,
  currency,
  firstMonth,
  onClose,
  onSave,
}: {
  open: boolean;
  initial: PlanItem | null;
  currency: Currency;
  firstMonth: string;
  onClose: () => void;
  onSave: (item: PlanItem) => void;
}) {
  const { t, locale } = useI18n();
  const [label, setLabel] = useState("");
  const [direction, setDirection] = useState<TxDirection>("income");
  const [amount, setAmount] = useState("");
  const [itemCurrency, setItemCurrency] = useState<Currency>(currency);
  const [inflates, setInflates] = useState(true);
  const [frequency, setFrequency] = useState<PlanFrequency>("monthly");
  const [startMonth, setStartMonth] = useState(firstMonth);
  const [endMode, setEndMode] = useState<"ongoing" | "for" | "until">("ongoing");
  const [duration, setDuration] = useState("");
  const [endMonth, setEndMonth] = useState("");
  const [key, setKey] = useState<string | null>(null);

  // Re-keys on close too ("closed"), so the next "Add item" starts blank
  // instead of inheriting the item that was just created.
  const target = initial?.id ?? (open ? "new" : "closed");
  if (key !== target) {
    setKey(target);
    setLabel(initial?.label ?? "");
    setDirection(initial?.direction ?? "income");
    setAmount(initial ? String(initial.amount) : "");
    setItemCurrency(initial?.currency ?? currency);
    setInflates(initial?.inflates ?? true);
    setFrequency(initial?.frequency ?? "monthly");
    const start = initial?.startMonth ?? firstMonth;
    setStartMonth(start);
    setEndMode(initial?.durationMonths != null ? "for" : "ongoing");
    setDuration(initial?.durationMonths != null ? String(initial.durationMonths) : "");
    setEndMonth(
      initial?.durationMonths != null ? addMonthKey(start, initial.durationMonths - 1) : ""
    );
  }

  // the three ways of saying "when does it stop" all reduce to a month count
  const resolvedDuration = (): number | null => {
    if (frequency === "once" || endMode === "ongoing") return null;
    if (endMode === "for") return duration.trim() === "" ? null : Math.max(1, Math.floor(Number(duration)));
    if (!endMonth) return null;
    return Math.max(1, monthsBetween(startMonth, endMonth) + 1);
  };
  const derivedEnd = (() => {
    const d = resolvedDuration();
    return d != null ? addMonthKey(startMonth, d - 1) : null;
  })();

  return (
    <Modal open={open} onClose={onClose} title={initial ? t("common.edit") : t("planner.addItem")}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          const value = Number(amount);
          if (!(value > 0)) return;
          onSave({
            id: initial?.id ?? uid(),
            label: label.trim() || t("planner.untitled"),
            direction,
            amount: value,
            currency: itemCurrency,
            inflates,
            frequency,
            startMonth,
            durationMonths: resolvedDuration(),
            enabled: initial?.enabled ?? true,
          });
        }}
      >
        <Field label={t("common.name")}>
          <Input required value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("planner.namePlaceholder")} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant={direction === "income" ? "primary" : "secondary"} onClick={() => setDirection("income")}>
            {t("tx.income")}
          </Button>
          <Button type="button" variant={direction === "expense" ? "primary" : "secondary"} onClick={() => setDirection("expense")}>
            {t("tx.expense")}
          </Button>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label={t("common.amount")}>
            <Input type="number" step="any" min="0" required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label={t("common.currency")}>
            <Select value={itemCurrency} onChange={(e) => setItemCurrency(e.target.value as Currency)}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c === "XAU_G" ? "GOLD g" : c}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("recurring.frequency")}>
            <Select value={frequency} onChange={(e) => setFrequency(e.target.value as PlanFrequency)}>
              <option value="monthly">{t("planner.freq_monthly")}</option>
              <option value="yearly">{t("planner.freq_yearly")}</option>
              <option value="once">{t("planner.freq_once")}</option>
            </Select>
          </Field>
        </div>
        {itemCurrency === "TRY" ? (
          <label className="flex items-start gap-2 rounded-lg bg-[var(--edge-soft)] p-3">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-teal-600"
              checked={inflates}
              onChange={(e) => setInflates(e.target.checked)}
            />
            <span>
              <span className="block text-sm font-medium">{t("planner.inflates")}</span>
              <span className="block text-xs text-zinc-500">{t("planner.inflatesHint")}</span>
            </span>
          </label>
        ) : null}
        <div className="grid grid-cols-2 gap-3">
          {/* a real month, not a count of months from today — and not capped
              to the horizon, since something starting in 2030 is a valid plan
              even while you're looking at one year */}
          <Field label={t("planner.startMonth")} hint={t("planner.startMonthHint")}>
            <Input type="month" required value={startMonth} onChange={(e) => setStartMonth(e.target.value)} />
          </Field>
          {frequency !== "once" ? (
            <Field label={t("planner.ends")}>
              <Select value={endMode} onChange={(e) => setEndMode(e.target.value as typeof endMode)}>
                <option value="ongoing">{t("planner.endOngoing")}</option>
                <option value="for">{t("planner.endAfter")}</option>
                <option value="until">{t("planner.endOn")}</option>
              </Select>
            </Field>
          ) : null}
        </div>
        {frequency !== "once" && endMode !== "ongoing" ? (
          <div className="grid grid-cols-2 gap-3">
            {endMode === "for" ? (
              <Field label={t("planner.duration")} hint={t("planner.durationMonthsHint")}>
                <Input
                  type="number"
                  step="1"
                  min="1"
                  max="600"
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  placeholder="120"
                />
              </Field>
            ) : (
              <Field label={t("planner.endMonth")}>
                <Input type="month" min={startMonth} value={endMonth} onChange={(e) => setEndMonth(e.target.value)} />
              </Field>
            )}
            {derivedEnd ? (
              <div className="self-end pb-2 text-xs text-zinc-500">
                {endMode === "for"
                  ? t("planner.endsOn", { month: monthLabelOf(derivedEnd, locale) })
                  : t("planner.lastsMonths", { count: resolvedDuration() ?? 0 })}
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary">
            {t("common.save")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
