"use client";

import { useEffect, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { HorizonSlider, horizonLabel } from "@/components/horizonSlider";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Modal, Select, Spinner } from "@/components/ui";
import { useApp } from "@/lib/data/provider";
import { useAccounts, useCategories, useRates, useTemplates, useTransactions } from "@/lib/data/queries";
import { TxDirection } from "@/lib/data/types";
import { formatAmount } from "@/lib/domain/currencies";
import {
  applyPlan,
  averageMonthlyNet,
  CategoryBudget,
  itemHorizonTotal,
  Plan,
  PlanFrequency,
  PlanItem,
  planMilestones,
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

const uid = () => Math.random().toString(36).slice(2, 10);

export default function PlannerPage() {
  const { t, locale } = useI18n();
  const { displayCurrency } = useApp();
  const accounts = useAccounts();
  const transactions = useTransactions();
  const templates = useTemplates();
  const categories = useCategories();
  const rates = useRates();

  const [months, setMonths] = useState(60);
  const [plan, setPlan] = useState<Plan>({ items: [], budgets: [] });
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<PlanItem | null>(null);
  const [adding, setAdding] = useState(false);

  // deferred: restore the saved plan after hydration
  useEffect(() => {
    queueMicrotask(() => {
      try {
        const raw = window.localStorage.getItem(PLAN_KEY);
        if (raw) {
          const saved = JSON.parse(raw) as Plan;
          if (Array.isArray(saved.items) && Array.isArray(saved.budgets)) setPlan(saved);
        }
        const savedHorizon = Number(window.localStorage.getItem(HORIZON_KEY));
        if (savedHorizon >= 1 && savedHorizon <= 120) setMonths(savedHorizon);
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

  if (!accounts.data || !transactions.data || !templates.data || !categories.data || !rates.data || !loaded) {
    return <Spinner />;
  }

  const base = projectCashflow({
    accounts: accounts.data,
    transactions: transactions.data,
    templates: templates.data,
    usdPer: rates.data.usdPer,
    display: displayCurrency,
    fromDate: todayISO(),
    months,
  });
  const planned = applyPlan(base, plan);

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
  const expenseCategories = categories.data.filter((c) => c.direction === "expense");
  const budgetByCategory = new Map(plan.budgets.map((b) => [b.categoryId, b]));

  const baseEnd = base.months[base.months.length - 1]?.endNetWorth ?? base.startNetWorth;
  const planEnd = planned.months[planned.months.length - 1]?.endNetWorth ?? planned.startNetWorth;
  const delta = planEnd - baseEnd;
  const hasPlan = plan.items.some((i) => i.enabled) || plan.budgets.some((b) => b.enabled);

  const chartData = planned.months.map((m, i) => ({
    month: m.month,
    plan: Math.round(m.endNetWorth * 100) / 100,
    base: Math.round(base.months[i].endNetWorth * 100) / 100,
  }));

  const milestones = planMilestones(planned);
  const baseMilestones = new Map(planMilestones(base).map((m) => [m.months, m.netWorth]));

  const setBudget = (categoryId: string, patch: Partial<CategoryBudget>) => {
    const existing = budgetByCategory.get(categoryId);
    const next = existing
      ? plan.budgets.map((b) => (b.categoryId === categoryId ? { ...b, ...patch } : b))
      : [...plan.budgets, { categoryId, monthlyAmount: 0, enabled: true, ...patch }];
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
      <div>
        <h1 className="text-xl font-bold">{t("planner.title")}</h1>
        <p className="text-sm text-zinc-500">{t("planner.hint")}</p>
      </div>

      <Card className="p-4">
        <HorizonSlider months={months} onChange={setHorizon} />
      </Card>

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
                    {t("planner.startsIn", { count: item.startMonth })}
                    {item.frequency !== "once"
                      ? ` · ${item.durationMonths != null ? t("planner.forMonths", { count: item.durationMonths }) : t("planner.ongoing")}`
                      : ""}
                    {" · "}
                    {t("planner.horizonTotal", { amount: fmt(itemHorizonTotal(item, months)) })}
                  </div>
                </div>
                <span className={`text-sm font-semibold tabular-nums ${item.direction === "income" ? "text-green-600" : "text-red-600"}`}>
                  {item.direction === "income" ? "+" : "−"}
                  {fmt(item.amount)}
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
                      onClick={() => setBudget(c.id, { enabled: true, monthlyAmount: Math.round(average) })}
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
                  <span className="w-10 text-xs text-zinc-400">{displayCurrency}</span>
                </div>
              );
            })}
          </div>
        </div>
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
              {planned.months.map((m) => (
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

      <PlanItemModal
        open={adding || editing != null}
        initial={editing}
        currency={displayCurrency}
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
  onClose,
  onSave,
}: {
  open: boolean;
  initial: PlanItem | null;
  currency: string;
  onClose: () => void;
  onSave: (item: PlanItem) => void;
}) {
  const { t } = useI18n();
  const [label, setLabel] = useState("");
  const [direction, setDirection] = useState<TxDirection>("income");
  const [amount, setAmount] = useState("");
  const [frequency, setFrequency] = useState<PlanFrequency>("monthly");
  const [startMonth, setStartMonth] = useState("0");
  const [duration, setDuration] = useState("");
  const [key, setKey] = useState<string | null>(null);

  // Re-keys on close too ("closed"), so the next "Add item" starts blank
  // instead of inheriting the item that was just created.
  const target = initial?.id ?? (open ? "new" : "closed");
  if (key !== target) {
    setKey(target);
    setLabel(initial?.label ?? "");
    setDirection(initial?.direction ?? "income");
    setAmount(initial ? String(initial.amount) : "");
    setFrequency(initial?.frequency ?? "monthly");
    setStartMonth(String(initial?.startMonth ?? 0));
    setDuration(initial?.durationMonths != null ? String(initial.durationMonths) : "");
  }

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
            frequency,
            startMonth: Math.max(0, Math.floor(Number(startMonth) || 0)),
            durationMonths: duration.trim() === "" ? null : Math.max(1, Math.floor(Number(duration))),
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
        <div className="grid grid-cols-2 gap-3">
          <Field label={`${t("common.amount")} (${currency})`}>
            <Input type="number" step="any" min="0" required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label={t("recurring.frequency")}>
            <Select value={frequency} onChange={(e) => setFrequency(e.target.value as PlanFrequency)}>
              <option value="monthly">{t("planner.freq_monthly")}</option>
              <option value="yearly">{t("planner.freq_yearly")}</option>
              <option value="once">{t("planner.freq_once")}</option>
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {/* deliberately not capped to the horizon: something starting in 36
              months is a valid plan even while you're looking at 12 — capping
              it made the browser silently refuse to submit the form */}
          <Field label={t("planner.startMonth")} hint={t("planner.startMonthHint")}>
            <Input type="number" step="1" min="0" max="600" value={startMonth} onChange={(e) => setStartMonth(e.target.value)} />
          </Field>
          {frequency !== "once" ? (
            <Field label={t("planner.duration")} hint={t("planner.durationHint")}>
              <Input type="number" step="1" min="1" max="600" value={duration} onChange={(e) => setDuration(e.target.value)} placeholder={t("planner.ongoing")} />
            </Field>
          ) : null}
        </div>
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
