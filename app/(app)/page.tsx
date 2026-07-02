"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { DndContext, DragEndEvent, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AvgSpendCard } from "@/components/avgSpendCard";
import { BudgetsCard } from "@/components/budgetsCard";
import { CardPaymentReminder } from "@/components/cardPaymentReminder";
import { GoalsCard } from "@/components/goalsCard";
import { Badge, Button, Card, CardHeader, EmptyState, Spinner } from "@/components/ui";
import { useApp, useRepo } from "@/lib/data/provider";
import {
  KEYS,
  useAccounts,
  useAppMutation,
  useRates,
  useTransactions,
  useUserSettings,
  useVictvsSessions,
} from "@/lib/data/queries";
import { DashboardLayout } from "@/lib/data/types";
import { computeBalances, computeNetWorth } from "@/lib/domain/balances";
import { safeToSpend } from "@/lib/domain/budgets";
import { formatAmount } from "@/lib/domain/currencies";
import { convert, snapshotFromTable } from "@/lib/domain/fx";
import { sumAmounts } from "@/lib/domain/money";
import { computePurchaseLiability, findDueCardPayments } from "@/lib/domain/purchases";
import { addDays, addMonthsClamped, todayISO } from "@/lib/domain/recurrence";
import { useI18n } from "@/lib/i18n";

const tooltipStyle = {
  backgroundColor: "var(--viz-tooltip-bg)",
  border: "1px solid var(--viz-grid)",
  borderRadius: 8,
  fontSize: 12,
};

const CARD_IDS = [
  "net-worth",
  "safe-to-spend",
  "cc-debt",
  "victvs",
  "accounts",
  "upcoming",
  "monthly-flow",
  "budgets",
  "goals",
  "avg-spend",
] as const;
type CardId = (typeof CARD_IDS)[number];

/** grid span per card on the xl 4-column dashboard grid */
const SPAN: Record<CardId, string> = {
  "net-worth": "sm:col-span-1",
  "safe-to-spend": "sm:col-span-1",
  "cc-debt": "sm:col-span-1",
  victvs: "sm:col-span-1",
  accounts: "sm:col-span-1",
  upcoming: "sm:col-span-2",
  "monthly-flow": "sm:col-span-2",
  budgets: "sm:col-span-2 xl:col-span-1",
  goals: "sm:col-span-2 xl:col-span-1",
  "avg-spend": "sm:col-span-2",
};

function normalizeLayout(saved: DashboardLayout | null): DashboardLayout {
  const known = new Set<string>(CARD_IDS);
  const order = (saved?.order ?? []).filter((id) => known.has(id));
  for (const id of CARD_IDS) if (!order.includes(id)) order.push(id);
  const hidden = (saved?.hidden ?? []).filter((id) => known.has(id));
  return { order, hidden };
}

export default function DashboardPage() {
  const { t, locale } = useI18n();
  const repo = useRepo();
  const { displayCurrency } = useApp();
  const accounts = useAccounts();
  const transactions = useTransactions();
  const victvs = useVictvsSessions();
  const rates = useRates();
  const settings = useUserSettings();

  const [editMode, setEditMode] = useState(false);
  const [layout, setLayout] = useState<DashboardLayout | null>(null);
  const saveLayout = useAppMutation(
    (next: DashboardLayout) => repo.saveUserSettings({ dashboardLayout: next }),
    [KEYS.userSettings]
  );

  useEffect(() => {
    if (settings.data && layout == null) {
      // deferred: layout initializes from persisted settings after first paint
      const saved = settings.data.dashboardLayout;
      queueMicrotask(() => setLayout((current) => current ?? normalizeLayout(saved)));
    }
  }, [settings.data, layout]);

  const completePlanned = useAppMutation(
    (id: string) => repo.completeTransaction(id, snapshotFromTable(rates.data!)),
    [KEYS.transactions, KEYS.accounts]
  );

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const today = todayISO();

  // computed per render (cheap at personal scale); the React compiler memoizes
  const derived = (() => {
    if (!accounts.data || !transactions.data || !rates.data) return null;
    const balances = computeBalances(accounts.data, transactions.data);
    const rawNetWorth = computeNetWorth(accounts.data, balances, rates.data.usdPer, displayCurrency);
    // remaining reflected installments count as debt now (current stat only —
    // the projector spreads them month by month, so it stays unadjusted)
    const liability = computePurchaseLiability(transactions.data, accounts.data, rates.data.usdPer, displayCurrency);
    const netWorth = { ...rawNetWorth, total: rawNetWorth.total - liability };
    let ccPostedDebt = 0;
    for (const a of accounts.data) {
      if (a.kind !== "credit_card" || a.archived) continue;
      const balance = balances.get(a.id) ?? 0;
      if (balance < 0) {
        const converted = convert(-balance, a.currency, displayCurrency, rates.data.usdPer);
        if (converted != null) ccPostedDebt += converted;
      }
    }
    const duePayments = findDueCardPayments(accounts.data, balances, transactions.data, today);
    const safe = safeToSpend({
      accounts: accounts.data,
      balances,
      transactions: transactions.data,
      usdPer: rates.data.usdPer,
      display: displayCurrency,
      today,
    });

    const upcoming = transactions.data
      .filter((tx) => tx.status === "planned" && tx.dueDate <= addDays(today, 30))
      .sort((a, b) => (a.dueDate > b.dueDate ? 1 : -1))
      .slice(0, 6);

    // last 6 completed months of income/expense in display currency (transfers excluded)
    const byMonth = new Map<string, { income: number; expense: number }>();
    for (let i = 5; i >= 0; i--) {
      byMonth.set(addMonthsClamped(today, -i).slice(0, 7), { income: 0, expense: 0 });
    }
    const currencyOf = new Map(accounts.data.map((a) => [a.id, a.currency] as const));
    for (const tx of transactions.data) {
      if (tx.status !== "completed" || tx.transferGroupId) continue;
      const bucket = byMonth.get(tx.dueDate.slice(0, 7));
      const currency = currencyOf.get(tx.accountId);
      if (!bucket || !currency) continue;
      // historical figures use the snapshot captured at completion, so they never drift
      const usdPer = tx.fxSnapshot?.usdPer ?? rates.data.usdPer;
      const converted = convert(tx.amount, currency, displayCurrency, usdPer);
      if (converted == null) continue;
      if (tx.direction === "income") bucket.income += converted;
      else bucket.expense += converted;
    }
    const flow = [...byMonth.entries()].map(([month, v]) => ({
      month,
      income: Math.round(v.income * 100) / 100,
      expense: Math.round(v.expense * 100) / 100,
    }));

    return { balances, netWorth, liability, ccPostedDebt, duePayments, safe, upcoming, flow };
  })();

  const unpaidVictvs = sumAmounts(
    "USD",
    (victvs.data ?? []).filter((s) => s.status === "unpaid").map((s) => s.amount)
  );

  if (!derived || !layout || accounts.isLoading || transactions.isLoading) return <Spinner />;

  const accountById = new Map((accounts.data ?? []).map((a) => [a.id, a]));
  const activeAccounts = (accounts.data ?? []).filter((a) => !a.archived);

  const applyLayout = (next: DashboardLayout) => {
    setLayout(next);
    saveLayout.mutate(next);
  };

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const visible = layout.order.filter((id) => !layout.hidden.includes(id));
    const from = visible.indexOf(String(active.id));
    const to = visible.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    const nextVisible = arrayMove(visible, from, to);
    // rebuild full order: visible in new order, hidden keep their positions at the end
    applyLayout({ ...layout, order: [...nextVisible, ...layout.order.filter((id) => layout.hidden.includes(id))] });
  };

  const move = (id: CardId, delta: -1 | 1) => {
    const visible = layout.order.filter((x) => !layout.hidden.includes(x));
    const index = visible.indexOf(id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= visible.length) return;
    const nextVisible = arrayMove(visible, index, target);
    applyLayout({ ...layout, order: [...nextVisible, ...layout.order.filter((x) => layout.hidden.includes(x))] });
  };

  const hide = (id: CardId) => applyLayout({ ...layout, hidden: [...layout.hidden, id] });
  const unhide = (id: CardId) => applyLayout({ ...layout, hidden: layout.hidden.filter((x) => x !== id) });

  const cardContent: Record<CardId, React.ReactNode> = {
    "net-worth": (
      <Card className="h-full p-4">
        <div className="text-xs text-zinc-500">
          {t("dashboard.netWorth")} ({displayCurrency})
        </div>
        <div className="mt-1 text-3xl font-bold">{formatAmount(derived.netWorth.total, displayCurrency, locale)}</div>
        {derived.liability > 0 ? (
          <div className="mt-1 text-xs text-zinc-400">
            −{formatAmount(derived.liability, displayCurrency, locale)} {t("purchases.inclInstallments")}
          </div>
        ) : null}
        {derived.netWorth.skippedAccountIds.length > 0 ? (
          <div className="mt-1 text-xs text-amber-600">{t("dashboard.skippedAccounts")}</div>
        ) : null}
      </Card>
    ),
    "safe-to-spend": (
      <Card className="h-full p-4">
        <div className="text-xs text-zinc-500" title={t("dashboard.safeHint")}>
          {t("dashboard.safeToSpend")} ({displayCurrency})
        </div>
        <div className={`mt-1 text-3xl font-bold ${derived.safe.total < 0 ? "text-red-600" : "text-emerald-600"}`}>
          {formatAmount(derived.safe.total, displayCurrency, locale)}
        </div>
        <div className="mt-1 text-xs text-zinc-400 tabular-nums">
          {formatAmount(derived.safe.liquid, displayCurrency, locale)} + {formatAmount(derived.safe.plannedIncome, displayCurrency, locale)} −{" "}
          {formatAmount(derived.safe.plannedExpense, displayCurrency, locale)}
        </div>
      </Card>
    ),
    "cc-debt": (
      <Card className="h-full p-4">
        <div className="text-xs text-zinc-500">
          {t("purchases.ccDebtTile")} ({displayCurrency})
        </div>
        <div className={`mt-1 text-3xl font-bold ${derived.ccPostedDebt > 0 ? "text-red-600" : ""}`}>
          {formatAmount(derived.ccPostedDebt, displayCurrency, locale)}
        </div>
        {derived.liability > 0 ? (
          <div className="mt-1 text-xs text-zinc-400">
            +{formatAmount(derived.liability, displayCurrency, locale)} {t("purchases.upcomingInstallments").toLowerCase()}
          </div>
        ) : null}
        <Link href="/purchases" className="mt-1 inline-block text-xs text-teal-600 hover:underline">
          {t("dashboard.seeAll")} →
        </Link>
      </Card>
    ),
    victvs: (
      <Card className="h-full p-4">
        <div className="text-xs text-zinc-500">{t("dashboard.unpaidVictvs")}</div>
        <div className="mt-1 text-3xl font-bold">{formatAmount(unpaidVictvs, "USD", locale)}</div>
        <Link href="/victvs" className="mt-1 inline-block text-xs text-teal-600 hover:underline">
          {t("dashboard.seeAll")} →
        </Link>
      </Card>
    ),
    accounts: (
      <Card className="h-full p-4">
        <div className="text-xs text-zinc-500">{t("dashboard.accounts")}</div>
        <div className="mt-1 space-y-1">
          {activeAccounts.slice(0, 5).map((a) => (
            <div key={a.id} className="flex justify-between text-sm">
              <span className="truncate text-zinc-600 dark:text-zinc-300">{a.name}</span>
              <span className="font-medium tabular-nums">
                {formatAmount(derived.balances.get(a.id) ?? 0, a.currency, locale)}
              </span>
            </div>
          ))}
          {activeAccounts.length === 0 ? (
            <Link href="/accounts" className="text-sm text-teal-600 hover:underline">
              {t("accounts.empty")}
            </Link>
          ) : null}
        </div>
      </Card>
    ),
    upcoming: (
      <Card className="h-full">
        <CardHeader
          title={t("dashboard.upcoming")}
          action={
            <Link href="/transactions" className="text-xs text-teal-600 hover:underline">
              {t("dashboard.seeAll")} →
            </Link>
          }
        />
        {derived.upcoming.length === 0 ? (
          <div className="p-4">
            <EmptyState>{t("dashboard.noUpcoming")}</EmptyState>
          </div>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {derived.upcoming.map((tx) => {
              const account = accountById.get(tx.accountId);
              if (!account) return null;
              const overdue = tx.dueDate < today;
              return (
                <li key={tx.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{tx.description || "—"}</div>
                    <div className="text-xs text-zinc-500">
                      {account.name} · {tx.dueDate} {overdue ? <Badge tone="red">!</Badge> : null}
                    </div>
                  </div>
                  <span className={`text-sm font-semibold tabular-nums ${tx.direction === "income" ? "text-emerald-600" : ""}`}>
                    {tx.direction === "income" ? "+" : "−"}
                    {formatAmount(tx.amount, account.currency, locale)}
                  </span>
                  <Button variant="ghost" disabled={!rates.data} onClick={() => completePlanned.mutate(tx.id)}>
                    ✓ {t("dashboard.complete")}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    ),
    "monthly-flow": (
      <Card className="h-full">
        <CardHeader title={`${t("dashboard.monthlyFlow")} (${displayCurrency})`} />
        <div className="h-64 p-3">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={derived.flow} margin={{ top: 8, right: 12, bottom: 0, left: 8 }} barGap={2}>
              <CartesianGrid stroke="var(--viz-grid)" strokeWidth={1} vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--viz-muted)" }} tickLine={false} axisLine={{ stroke: "var(--viz-axis)" }} />
              <YAxis
                tick={{ fontSize: 11, fill: "var(--viz-muted)" }}
                tickLine={false}
                axisLine={false}
                width={70}
                tickFormatter={(v: number) => Intl.NumberFormat(locale, { notation: "compact" }).format(v)}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(v) => formatAmount(Number(v), displayCurrency, locale)}
                cursor={{ fill: "var(--viz-grid)", opacity: 0.4 }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="income" name={t("dashboard.income")} fill="var(--viz-series-1)" radius={[4, 4, 0, 0]} maxBarSize={18} />
              <Bar dataKey="expense" name={t("dashboard.expense")} fill="var(--viz-series-2)" radius={[4, 4, 0, 0]} maxBarSize={18} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    ),
    budgets: <BudgetsCard className="h-full" />,
    goals: <GoalsCard className="h-full" />,
    "avg-spend": <AvgSpendCard className="h-full" />,
  };

  const visible = layout.order.filter((id) => !layout.hidden.includes(id)) as CardId[];

  return (
    <div className="mx-auto max-w-6xl space-y-4 3xl:max-w-[1700px]">
      {derived.duePayments.length > 0 ? <CardPaymentReminder duePayments={derived.duePayments} /> : null}

      <div className="flex items-center justify-end gap-2">
        {editMode ? <span className="text-xs text-zinc-400">{t("layout.dragHint")}</span> : null}
        <Button variant={editMode ? "primary" : "ghost"} onClick={() => setEditMode(!editMode)}>
          {editMode ? t("layout.done") : `⠿ ${t("layout.edit")}`}
        </Button>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={visible} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {visible.map((id, index) => (
              <SortableCard
                key={id}
                id={id}
                spanClass={SPAN[id]}
                editMode={editMode}
                isFirst={index === 0}
                isLast={index === visible.length - 1}
                onHide={() => hide(id)}
                onMoveUp={() => move(id, -1)}
                onMoveDown={() => move(id, 1)}
              >
                {cardContent[id]}
              </SortableCard>
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {editMode && layout.hidden.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-zinc-400">{t("layout.hiddenCards")}:</span>
          {(layout.hidden as CardId[]).map((id) => (
            <button
              key={id}
              onClick={() => unhide(id)}
              className="rounded-full border border-dashed border-zinc-300 px-3 py-1 text-xs text-zinc-500 hover:border-teal-500 hover:text-teal-600 dark:border-zinc-700"
            >
              + {id}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SortableCard({
  id,
  spanClass,
  editMode,
  isFirst,
  isLast,
  onHide,
  onMoveUp,
  onMoveDown,
  children,
}: {
  id: string;
  spanClass: string;
  editMode: boolean;
  isFirst: boolean;
  isLast: boolean;
  onHide: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: !editMode,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`relative ${spanClass} ${isDragging ? "z-50 opacity-80" : ""}`}
    >
      {editMode ? (
        <div className="absolute -top-2 right-2 z-10 flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-1.5 py-0.5 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
          <button
            {...attributes}
            {...listeners}
            className="cursor-grab px-1 text-zinc-400 hover:text-zinc-700 active:cursor-grabbing dark:hover:text-zinc-200"
            aria-label={id}
          >
            ⠿
          </button>
          <button onClick={onMoveUp} disabled={isFirst} className="px-1 text-zinc-400 hover:text-zinc-700 disabled:opacity-30 dark:hover:text-zinc-200" aria-label={t("layout.moveUp")}>
            ↑
          </button>
          <button onClick={onMoveDown} disabled={isLast} className="px-1 text-zinc-400 hover:text-zinc-700 disabled:opacity-30 dark:hover:text-zinc-200" aria-label={t("layout.moveDown")}>
            ↓
          </button>
          <button onClick={onHide} className="px-1 text-zinc-400 hover:text-red-600" aria-label={t("layout.hide")}>
            ✕
          </button>
        </div>
      ) : null}
      {children}
    </div>
  );
}
