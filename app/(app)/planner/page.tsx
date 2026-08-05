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
  itemHorizonTotal,
  PlanFrequency,
  PlanItem,
  planExtraFlows,
  planIsEmpty,
  planMilestones,
  monthsBetween,
  planDroppedIncome,
  planReplacedCategories,
  planFundingOrder,
  normalizePlan,
  firstUncoveredMonth,
  soldFromReserve,
  totalDrawn,
  retentionFactor,
} from "@/lib/domain/planner";
import { usePlanScenarios } from "@/lib/usePlanScenarios";
import { ScenarioBar } from "@/components/scenarioBar";
import { FundingList } from "@/components/fundingList";
import { GridBlock, PlannerGrid, usePlannerGrid } from "@/components/plannerGrid";
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

// device-local: how this screen is set up. The plan itself lives server-side.
const HORIZON_KEY = "renovator-plan-horizon";
const COMPARE_KEY = "renovator-plan-compare";
const VIEW_KEY = "renovator-plan-view";

type PlannerView = "single" | "two" | "custom";
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

  const scenarios = usePlanScenarios();
  const plan = scenarios.plan;
  const [months, setMonths] = useState(60);
  const [compareId, setCompareId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<PlanItem | null>(null);
  const [adding, setAdding] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // two columns by default: inputs beside the picture they change. Once a
  // custom arrangement exists it becomes the default instead.
  const [view, setView] = useState<PlannerView>("two");
  const [editingLayout, setEditingLayout] = useState(false);
  const grid = usePlannerGrid();

  const toggleMonth = (month: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(month)) next.delete(month);
      else next.add(month);
      return next;
    });

  // deferred: restore how this screen was left
  useEffect(() => {
    queueMicrotask(() => {
      const savedHorizon = Number(window.localStorage.getItem(HORIZON_KEY));
      if (savedHorizon >= 1 && savedHorizon <= 120) setMonths(savedHorizon);
      const savedView = window.localStorage.getItem(VIEW_KEY);
      if (savedView === "single" || savedView === "two" || savedView === "custom") setView(savedView);
      else if (window.localStorage.getItem(LAYOUT_KEY) === "single") setView("single");
      setCompareId(window.localStorage.getItem(COMPARE_KEY));
      setLoaded(true);
    });
  }, []);

  const persist = scenarios.update;
  const setCompare = (id: string | null) => {
    setCompareId(id);
    if (id) window.localStorage.setItem(COMPARE_KEY, id);
    else window.localStorage.removeItem(COMPARE_KEY);
  };
  const setHorizon = (m: number) => {
    setMonths(m);
    window.localStorage.setItem(HORIZON_KEY, String(m));
  };
  const chooseView = (next: PlannerView) => {
    setView(next);
    if (next !== "custom") setEditingLayout(false);
    window.localStorage.setItem(VIEW_KEY, next);
  };

  if (
    !accounts.data ||
    !transactions.data ||
    !templates.data ||
    !categories.data ||
    !rates.data ||
    !loaded ||
    !scenarios.ready
  ) {
    return <Spinner />;
  }

  const firstMonth = todayISO().slice(0, 7);
  // anything that isn't a credit card can be sold to get through a bad month
  const drawable = accounts.data.filter((a) => !a.archived && a.kind !== "credit_card");
  const fundingOrder = planFundingOrder(plan, drawable.map((a) => a.id));
  const fundingArg = {
    order: fundingOrder,
    overrides: plan.funding?.overrides ?? {},
    routine: plan.funding?.routine ?? [],
  };

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
    funding: fundingArg,
  });

  // an optional second scenario, drawn alongside so two futures can be read
  // against each other rather than remembered
  const comparePlan =
    compareId && compareId !== scenarios.selectedId
      ? scenarios.scenarios.find((p) => p.id === compareId)
      : undefined;
  const compareNormalized = comparePlan
    ? normalizePlan(comparePlan.body, firstMonth)
    : null;
  const compared = compareNormalized
    ? projectCashflow({
        accounts: accounts.data,
        transactions: transactions.data,
        templates: templates.data,
        usdPer: rates.data.usdPer,
        display: displayCurrency,
        fromDate: todayISO(),
        months,
        ratePath: buildRatePath(rates.data.usdPer, compareNormalized.devaluation),
        extraFlows: planExtraFlows(compareNormalized, months, firstMonth),
        replaceCategories: planReplacedCategories(compareNormalized),
        dropIncomeCategories: planDroppedIncome(compareNormalized),
        funding: {
          order: planFundingOrder(compareNormalized, drawable.map((a) => a.id)),
          overrides: compareNormalized.funding?.overrides ?? {},
          routine: compareNormalized.funding?.routine ?? [],
        },
      })
    : null;

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
    ...(compared ? { compare: Math.round((compared.months[i]?.endNetWorth ?? 0) * 100) / 100 } : {}),
  }));

  // your ranking first, then anything you haven't ranked — including accounts
  // you've switched off, which stay listed so you can switch them back on
  const rankedIds = [
    ...(plan.funding?.order ?? []).filter((id) => drawable.some((a) => a.id === id)),
    ...drawable.map((a) => a.id).filter((id) => !(plan.funding?.order ?? []).includes(id)),
  ];
  const fundingRows = rankedIds.map((id) => drawable.find((a) => a.id === id)!);

  const accountName = (id: string) => accounts.data?.find((a) => a.id === id)?.name ?? id;
  const accountCurrency = (id: string) => accounts.data?.find((a) => a.id === id)?.currency ?? "USD";
  const brokeMonth = firstUncoveredMonth(planned);
  // everything sold across the horizon: once per asset, and month by month
  const salesByMonth = planned.months
    .filter((m) => m.draws.length > 0 || m.uncovered > 0.005)
    .map((m) => ({ month: m.month, draws: m.draws, uncovered: m.uncovered, shortfall: m.shortfall }));
  const salesByAsset = (() => {
    const acc = new Map<string, { amount: number; value: number; months: number; lastMonth: string }>();
    for (const m of planned.months) {
      for (const d of m.draws) {
        const row = acc.get(d.accountId) ?? { amount: 0, value: 0, months: 0, lastMonth: m.month };
        row.amount += d.amount;
        row.value += d.value;
        row.months += 1;
        row.lastMonth = m.month;
        acc.set(d.accountId, row);
      }
    }
    return acc;
  })();
  const drawnTotal = totalDrawn(planned);

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

  // every placeable card, so the classic columns and the custom grid
  // render exactly the same content
  const blocks: GridBlock[] = [
    {
      id: "tiles",
      title: t("planner.blockHeadline"),
      defaultSize: { w: 4, h: 1 },
      node: (
        <>
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
          {drawnTotal > 0 || brokeMonth ? (
            <>
              <div className="text-xs text-zinc-500">{t("planner.soldToGetBy")}</div>
              <div className={`mt-1 text-2xl font-bold ${brokeMonth ? "text-red-600" : "text-amber-600"}`}>
                {fmt(drawnTotal)}
              </div>
              <div className="mt-0.5 text-xs text-zinc-400">
                {brokeMonth
                  ? t("planner.runsOutIn", { month: monthLabelOf(brokeMonth, locale) })
                  : t("planner.coveredThroughout")}
              </div>
            </>
          ) : (
            <>
              <div className="text-xs text-zinc-500">{t("planner.avgMonthly")}</div>
              <div className={`mt-1 text-2xl font-bold ${averageMonthlyNet(planned) >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                {fmt(averageMonthlyNet(planned))}
              </div>
              <div className="mt-0.5 text-xs text-zinc-400">{t("planner.everyMonthPays")}</div>
            </>
          )}
        </Card>
      </div>
        </>
      ),
    },
    {
      id: "chart",
      title: t("planner.chartTitle"),
      defaultSize: { w: 2, h: 4 },
      node: (
        <>
        {/* the picture */}
        <Card className="flex flex-col">
          <CardHeader title={`${t("planner.chartTitle")} (${displayCurrency})`} />
          <div className="fill-in-grid h-80 p-3">
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
                {compared ? (
                  <Line
                    type="monotone"
                    dataKey="compare"
                    name={comparePlan?.name ?? t("planner.compareLine")}
                    stroke="var(--viz-series-3)"
                    strokeWidth={2}
                    strokeDasharray="2 3"
                    dot={false}
                    isAnimationActive={false}
                  />
                ) : null}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
        </>
      ),
    },
    {
      id: "projections",
      title: t("projections.title"),
      defaultSize: { w: 2, h: 5 },
      node: (
        <>
        {/* the same numbers, readable — with the control that shapes them */}
        <Card className="flex flex-col">
          <CardHeader title={t("projections.title")} />
          <div className="border-b border-[var(--edge-soft)] p-3">
            <HorizonSlider months={months} onChange={setHorizon} />
          </div>
          <div className="fill-in-grid max-h-[28rem] overflow-auto p-2">
            <table className="stack-sm w-full text-sm tabular-nums">
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
                        <td className="px-2 py-1.5 text-right text-emerald-600" data-label={t("dashboard.income")}>{fmt(m.income)}</td>
                        <td className="px-2 py-1.5 text-right" data-label={t("dashboard.expense")}>{fmt(m.expense)}</td>
                        <td className={`px-2 py-1.5 text-right font-medium ${m.net >= 0 ? "text-emerald-600" : "text-red-600"}`} data-label={t("dashboard.net")}>
                          {m.net >= 0 ? "+" : ""}
                          {fmt(m.net)}
                        </td>
                        <td className="px-2 py-1.5 text-right font-semibold" data-label={t("projections.endOfMonth")}>
                          <span className="inline-flex items-center gap-1.5">
                            {m.uncovered > 0.005 ? (
                              <span title={t("planner.shortTip")}>
                                <Badge tone="red">{t("planner.short")}</Badge>
                              </span>
                            ) : soldFromReserve(m) ? (
                              <span title={t("planner.soldTip")}>
                                <Badge tone="amber">{t("planner.sold")}</Badge>
                              </span>
                            ) : null}
                            {fmt(m.endNetWorth)}
                          </span>
                        </td>
                      </tr>
                      {open ? (
                        <tr className="stack-attach border-t border-zinc-100 bg-[var(--edge-soft)]/60 dark:border-zinc-800">
                          <td colSpan={5} className="px-2 py-2">
                            {m.shortfall > 0.005 ? (
                              <div className="mb-2 space-y-1 rounded-lg border border-[var(--edge)] px-4 py-2">
                                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                                  <span className="font-medium">
                                    {t("planner.monthShort", { amount: fmt(m.shortfall) })}
                                  </span>
                                  <label
                                    className="flex items-center gap-1.5 text-zinc-500"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    {t("planner.payFrom")}
                                    <Select
                                      aria-label={t("planner.payFrom")}
                                      className="!w-auto"
                                      value={plan.funding?.overrides?.[m.month] ?? ""}
                                      onChange={(e) => {
                                        const overrides = { ...(plan.funding?.overrides ?? {}) };
                                        if (e.target.value) overrides[m.month] = e.target.value;
                                        else delete overrides[m.month];
                                        persist({ ...plan, funding: { ...plan.funding, overrides } });
                                      }}
                                    >
                                      <option value="">{t("planner.inOrder")}</option>
                                      {fundingRows
                                        .filter((a) => !(plan.funding?.disabled ?? []).includes(a.id))
                                        .map((a) => (
                                          <option key={a.id} value={a.id}>
                                            {a.name}
                                          </option>
                                        ))}
                                    </Select>
                                  </label>
                                </div>
                                {m.draws.map((d, i) => (
                                  <div key={i} className="mx-auto flex w-full max-w-md items-center gap-2 text-xs">
                                    <span className="min-w-0 flex-1 truncate text-right text-zinc-600 dark:text-zinc-300">
                                      {accountName(d.accountId)}
                                      <span className="ml-1.5 text-[10px] text-zinc-400">
                                        −{formatAmount(d.amount, accountCurrency(d.accountId), locale)}
                                      </span>
                                    </span>
                                    <span aria-hidden className="h-3.5 w-px shrink-0 bg-[var(--edge)]" />
                                    <span className="w-28 shrink-0 tabular-nums text-amber-600">−{fmt(d.value)}</span>
                                  </div>
                                ))}
                                {m.uncovered > 0.005 ? (
                                  <p className="text-xs font-medium text-red-600">
                                    {t("planner.uncovered", { amount: fmt(m.uncovered) })}
                                  </p>
                                ) : null}
                              </div>
                            ) : null}
                            {m.lines.length === 0 ? (
                              <p className="px-4 text-xs text-zinc-400">{t("planner.monthEmpty")}</p>
                            ) : (
                              <ul className="space-y-0.5">
                                {m.lines.map((line, i) => (
                                  <li key={i} className="mx-auto flex w-full max-w-md items-center gap-2 text-xs">
                                    <span className="min-w-0 flex-1 truncate text-right text-zinc-600 dark:text-zinc-300">
                                      {line.label || categoryName(line.categoryId) || t("common.none")}
                                      {line.categoryId && categoryName(line.categoryId) && line.label ? (
                                        <span className="ml-1.5 text-[10px] text-zinc-400">
                                          {categoryName(line.categoryId)}
                                        </span>
                                      ) : null}
                                    </span>
                                    <span aria-hidden className="h-3.5 w-px shrink-0 bg-[var(--edge)]" />
                                    <span
                                      className={`w-28 shrink-0 tabular-nums ${
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
        </>
      ),
    },
    {
      id: "sales",
      title: t("planner.salesTitle"),
      defaultSize: { w: 2, h: 7 },
      node: (
        <>
        {/* everything sold, month by month — its own card so it can be given
            the room it needs, or hidden entirely */}
        <Card className="flex flex-col">
          <CardHeader title={t("planner.salesTitle")} />
          <div className="fill-in-grid p-3">
            {salesByMonth.length === 0 ? (
              <EmptyState>{t("planner.salesEmpty")}</EmptyState>
            ) : (
              <div>
                {salesByMonth.map((m) => (
                  <div key={m.month} className="border-t border-[var(--edge-soft)] py-2 first:border-t-0">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-medium">{monthLabelOf(m.month, locale)}</span>
                      <span className="text-zinc-400">{t("planner.monthShort", { amount: fmt(m.shortfall) })}</span>
                    </div>
                    {m.draws.map((d, i) => (
                      <div key={i} className="mx-auto flex w-full max-w-md items-center gap-2 text-xs">
                        <span className="min-w-0 flex-1 truncate text-right text-zinc-600 dark:text-zinc-300">
                          {accountName(d.accountId)}
                          <span className="ml-1.5 text-[10px] text-zinc-400">
                            −{formatAmount(d.amount, accountCurrency(d.accountId), locale)}
                          </span>
                        </span>
                        <span aria-hidden className="h-3.5 w-px shrink-0 bg-[var(--edge)]" />
                        <span className={`w-28 shrink-0 tabular-nums ${d.routine ? "text-zinc-500" : "text-amber-600"}`}>
                          −{fmt(d.value)}
                        </span>
                      </div>
                    ))}
                    {m.uncovered > 0.005 ? (
                      <p className="text-xs font-medium text-red-600">
                        {t("planner.uncovered", { amount: fmt(m.uncovered) })}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
        </>
      ),
    },
    {
      id: "dev",
      title: t("planner.devaluationTitle"),
      defaultSize: { w: 1, h: 2 },
      node: (
        <>
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
        </>
      ),
    },
    {
      id: "lost",
      title: t("planner.lostIncomeTitle"),
      defaultSize: { w: 1, h: 2 },
      node: (
        <>
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
        </>
      ),
    },
    {
      id: "funding",
      title: t("planner.fundingTitle"),
      defaultSize: { w: 2, h: 4 },
      node: (
        <>
        {/* which assets pay for a month that doesn't pay for itself */}
        <Card className="flex flex-col">
          <CardHeader
            title={t("planner.fundingTitle")}
            action={
              <label className="flex items-center gap-1.5 text-xs text-zinc-500">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-teal-600"
                  checked={plan.funding?.enabled ?? true}
                  onChange={(e) =>
                    persist({ ...plan, funding: { ...plan.funding, enabled: e.target.checked } })
                  }
                />
                {t("planner.fundingEnabled")}
              </label>
            }
          />
          <div className="fill-in-grid space-y-2 p-4">
            <p className="text-xs text-zinc-500">{t("planner.fundingHint")}</p>
            {drawable.length === 0 ? (
              <EmptyState>{t("planner.fundingEmpty")}</EmptyState>
            ) : (
              <FundingList
                accounts={fundingRows}
                disabled={plan.funding?.disabled ?? []}
                routine={plan.funding?.routine ?? []}
                soldByAccount={salesByAsset}
                leftByAccount={planned.months[planned.months.length - 1]?.sourceBalances ?? {}}
                locale={locale}
                onReorder={(ids) => persist({ ...plan, funding: { ...plan.funding, order: ids } })}
                onToggle={(id, key) => {
                  const list = (plan.funding?.[key] ?? []) as string[];
                  persist({
                    ...plan,
                    funding: {
                      ...plan.funding,
                      [key]: list.includes(id) ? list.filter((x) => x !== id) : [...list, id],
                    },
                  });
                }}
              />
            )}

          </div>
        </Card>
        </>
      ),
    },
    {
      id: "items",
      title: t("planner.itemsTitle"),
      defaultSize: { w: 2, h: 3 },
      node: (
        <>

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
        </>
      ),
    },
    {
      id: "budgets",
      title: t("planner.budgetsTitle"),
      defaultSize: { w: 2, h: 4 },
      node: (
        <>
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
        </>
      ),
    },
    {
      id: "milestones",
      title: t("planner.milestones"),
      defaultSize: { w: 2, h: 2 },
      node: (
        <>

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
        </>
      ),
    },
  ];
  const blockById = new Map(blocks.map((b) => [b.id, b.node] as const));
  const block = (id: string) => blockById.get(id);


  return (
    // the custom canvas earns the whole screen; the reading layouts don't
    <div
      className={
        view === "custom"
          ? "mx-[5%] w-[90%] space-y-4"
          : "mx-auto max-w-6xl space-y-4 3xl:max-w-[1600px]"
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">{t("planner.title")}</h1>
          <p className="text-sm text-zinc-500">{t("planner.hint")}</p>
        </div>
        <div className="no-print hidden items-center gap-2 xl:flex">
          {view === "custom" ? (
            <>
              <Button onClick={() => setEditingLayout((v) => !v)}>
                {editingLayout ? t("layout.done") : t("layout.edit")}
              </Button>
              {editingLayout ? (
                <Button
                  variant="ghost"
                  onClick={() => {
                    if (window.confirm(t("plannerGrid.resetConfirm"))) {
                      grid.reset();
                      chooseView("two");
                    }
                  }}
                >
                  {t("plannerGrid.reset")}
                </Button>
              ) : null}
            </>
          ) : null}
          <div className="flex gap-1 rounded-lg bg-[var(--edge-soft)] p-1">
            {(["two", "single", "custom"] as const).map((v) => (
              <button
                key={v}
                onClick={() => {
                  if (v === "custom" && !grid.layout) grid.start(blocks);
                  chooseView(v);
                }}
                className={`rounded-md px-3 py-1 text-xs font-medium ${
                  view === v ? "bg-[var(--surface)] shadow-sm" : "text-zinc-500"
                }`}
              >
                {v === "two"
                  ? t("planner.layoutTwo")
                  : v === "single"
                    ? t("planner.layoutSingle")
                    : t("planner.layoutCustom")}
              </button>
            ))}
          </div>
        </div>
      </div>

      <ScenarioBar
        scenarios={scenarios.scenarios}
        selectedId={scenarios.selectedId}
        compareId={compareId}
        saving={scenarios.saving}
        onSelect={scenarios.select}
        onCompare={setCompare}
        onCreate={(name) => scenarios.create(name)}
        onDuplicate={(name) => scenarios.create(name, plan)}
        onRename={scenarios.rename}
        onDelete={scenarios.remove}
      />

      {view === "custom" && grid.layout ? (
        <PlannerGrid
          blocks={blocks}
          layout={grid.layout}
          editing={editingLayout}
          onChange={grid.save}
        />
      ) : (
        <>
          {block("tiles")}

          {/* inputs on the left, the picture on the right — editing an
              assumption redraws the chart beside it without scrolling */}
          <div className={view === "two" ? "grid items-start gap-4 xl:grid-cols-2" : "space-y-4"}>
            <div className="space-y-4">
              {block("dev")}
              {block("lost")}
              {block("funding")}
              {block("sales")}
              {block("items")}
              {block("budgets")}
            </div>
            <div className={view === "two" ? "space-y-4 xl:sticky xl:top-20" : "space-y-4"}>
              {block("chart")}
              {milestones.length > 0 ? block("milestones") : null}
              {block("projections")}
            </div>
          </div>
        </>
      )}

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
