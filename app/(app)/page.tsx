"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { DndContext, DragEndEvent, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AvgSpendCard } from "@/components/avgSpendCard";
import { BudgetsCard } from "@/components/budgetsCard";
import { CardPaymentReminder } from "@/components/cardPaymentReminder";
import { GoalsCard } from "@/components/goalsCard";
import { AccountsLeftOut } from "@/components/dashboardParts";
import { GoldLensCard } from "@/components/goldLens";
import { Badge, Button, Card, CardHeader, EmptyState, Spinner } from "@/components/ui";
import { useApp, useRepo } from "@/lib/data/provider";
import { KEYS, useAccounts, useAppMutation, useRates, useTransactions } from "@/lib/data/queries";
import { DashboardV2 } from "@/components/dashboardV2";
import { pocketable } from "@/components/pocket/pocketable";
import { formatAmount } from "@/lib/domain/currencies";
import { snapshotFromTable } from "@/lib/domain/fx";
import { todayISO } from "@/lib/domain/recurrence";
import {
  CardId,
  cardsOff,
  cardSpec,
  isCardId,
  moveCard,
  NormalizedLayout,
  setCardVisible,
  visibleCards,
} from "@/lib/ui/dashboardLayout";
import { dashboardAccountRows } from "@/lib/ui/dashboardAccounts";
import { formatSigned } from "@/lib/ui/pocket/format";
import { useDashboardLayout } from "@/lib/ui/useDashboardLayout";
import { useDashboardData } from "@/lib/useDashboardData";
import { useFormatDate } from "@/lib/useFormatDate";
import { useI18n } from "@/lib/i18n";

const PocketHome = dynamic(() => import("@/components/pocket/home").then((m) => m.PocketHome), {
  ssr: false,
  loading: () => <Spinner />,
});

export default pocketable(DashboardPage, PocketHome);

const tooltipStyle = {
  backgroundColor: "var(--viz-tooltip-bg)",
  border: "1px solid var(--viz-grid)",
  borderRadius: 8,
  fontSize: 12,
};

function DashboardPage() {
  const { t, locale } = useI18n();
  const fmtDate = useFormatDate();
  const repo = useRepo();
  const { displayCurrency, uiVersion } = useApp();
  const accounts = useAccounts();
  const transactions = useTransactions();
  const rates = useRates();

  const [editMode, setEditMode] = useState(false);
  // the cards, their order and which are on: synced, and shared with V2 and
  // Settings (lib/ui/dashboardLayout.ts)
  const { layout, navHrefs, update } = useDashboardLayout();

  const completePlanned = useAppMutation(
    (id: string) => repo.completeTransaction(id, snapshotFromTable(rates.data!)),
    [KEYS.transactions, KEYS.accounts]
  );

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const today = todayISO();

  // both dashboards run on the same derivation; only the arrangement differs
  const derived = useDashboardData(displayCurrency);

  const unpaidVictvs = derived?.unpaidVictvs ?? 0;

  // Classic keeps the card grid below; every v2 skin gets the rebuilt layout.
  // Placed after every hook above so the hook order never changes with style.
  if (uiVersion === "v2") return <DashboardV2 />;

  if (!derived || !layout || accounts.isLoading || transactions.isLoading) return <Spinner />;

  const accountById = new Map((accounts.data ?? []).map((a) => [a.id, a]));
  const activeAccounts = (accounts.data ?? []).filter((a) => !a.archived);
  // the accounts the card lists: hiding one tidies the list, never a total
  const accountRows = dashboardAccountRows(
    { ...derived, usdPer: rates.data?.usdPer, display: displayCurrency },
    layout.accounts,
    layout.accounts.limit
  );

  // Each change is worked out again on the layout as saved (useDashboardLayout
  // re-reads it first), so a move names cards rather than positions on this
  // screen; the cards that aren't showing keep their places in the order.
  const shownIn = (l: NormalizedLayout) => visibleCards(l, "classic", navHrefs);

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    const id = String(active.id);
    const target = over ? String(over.id) : null;
    if (!target || id === target || !isCardId(id) || !isCardId(target)) return;
    update((l) => moveCard(l, shownIn(l), id, target));
  };

  const move = (id: CardId, delta: -1 | 1) => update((l) => moveCard(l, shownIn(l), id, delta));
  const hide = (id: CardId) => update((l) => setCardVisible(l, id, false));
  const unhide = (id: CardId) => update((l) => setCardVisible(l, id, true));

  const cardContent: Record<CardId, React.ReactNode> = {
    "net-worth": (
      <Card className="h-full p-4">
        <div className="text-xs text-zinc-500">
          {t("dashboard.netWorth")} ({displayCurrency})
        </div>
        <div className="mt-1 text-3xl font-bold">{formatAmount(derived.netWorth.total, displayCurrency, locale)}</div>
        {derived.cardsOwed > 0 ? (
          <div className="mt-1 text-xs text-zinc-400">
            −{formatAmount(derived.cardsOwed, displayCurrency, locale)} {t("purchases.inclInstallments")}
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
        <div className={`mt-1 text-3xl font-bold ${derived.cardsOwed > 0 ? "text-red-600" : ""}`}>
          {formatAmount(derived.cardsOwed, displayCurrency, locale)}
        </div>
        <Link href="/cards" className="mt-1 inline-block text-xs text-teal-600 hover:underline">
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
          {accountRows.rows.map((line) => (
            <div key={line.account.id} className="flex justify-between gap-2 text-sm">
              <span className="truncate text-zinc-600 dark:text-zinc-300">{line.account.name}</span>
              <span className={`shrink-0 font-medium tabular-nums ${line.card && line.balance < 0 ? "text-red-600" : ""}`}>
                {formatSigned(line.shown.amount, line.shown.currency, locale)}
              </span>
            </div>
          ))}
          {activeAccounts.length === 0 ? (
            <Link href="/accounts" className="text-sm text-teal-600 hover:underline">
              {t("accounts.empty")}
            </Link>
          ) : null}
          {accountRows.overflow > 0 ? (
            <Link href="/accounts" className="block text-xs text-teal-600 hover:underline">
              {t("dashboard.accountsMore", { count: accountRows.overflow })} →
            </Link>
          ) : null}
        </div>
        <AccountsLeftOut hidden={accountRows.hiddenCount} empty={accountRows.emptyHidden} />
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
                      {account.name} · {fmtDate(tx.dueDate)} {overdue ? <Badge tone="red">!</Badge> : null}
                    </div>
                  </div>
                  <span className={`text-sm font-semibold tabular-nums ${tx.direction === "income" ? "text-emerald-600" : ""}`}>
                    {tx.direction === "income" ? "+" : "−"}
                    {formatAmount(tx.amount, account.currency, locale)}
                  </span>
                  <Button
                    variant="ghost"
                    disabled={!rates.data}
                    onClick={(e) => {
                      e.stopPropagation();
                      completePlanned.mutate(tx.id);
                    }}
                  >
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
    "gold-lens": <GoldLensCard className="h-full" />,
  };

  const visible = shownIn(layout);
  const off = cardsOff(layout, "classic", navHrefs);

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
                label={t(cardSpec(id).labelKey)}
                href={cardSpec(id).route}
                spanClass={cardSpec(id).span}
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

      {/* every card that's off, by the user or by default, can come back from here */}
      {editMode ? (
        <div data-cards-off className="flex flex-wrap items-center gap-2">
          {off.length > 0 ? <span className="text-xs text-zinc-400">{t("layout.hiddenCards")}:</span> : null}
          {off.map((id) => (
            <button
              key={id}
              onClick={() => unhide(id)}
              title={t(cardSpec(id).descKey)}
              className="rounded-full border border-dashed border-zinc-300 px-3 py-1 text-xs text-zinc-500 hover:border-teal-500 hover:text-teal-600 dark:border-zinc-700"
            >
              + {t(cardSpec(id).labelKey)}
            </button>
          ))}
          <Link href="/settings?tab=dashboard" className="text-xs text-teal-600 hover:underline">
            {t("dashboard.moreOptions")} →
          </Link>
        </div>
      ) : null}
    </div>
  );
}

function SortableCard({
  id,
  label,
  href,
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
  label: string;
  href?: string;
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
  const router = useRouter();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: !editMode,
  });

  // outside edit mode the whole card is a big click target for its page;
  // inner buttons/links stopPropagation so they keep their own behavior
  const navigable = !editMode && href;

  return (
    <div
      ref={setNodeRef}
      data-card={id}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`group relative ${spanClass} ${isDragging ? "z-50 opacity-80" : ""} ${
        navigable ? "cursor-pointer transition-transform hover:-translate-y-0.5" : ""
      }`}
      onClick={navigable ? () => router.push(href!) : undefined}
      onKeyDown={
        navigable
          ? (e) => {
              if (e.key === "Enter") router.push(href!);
            }
          : undefined
      }
      role={navigable ? "link" : undefined}
      tabIndex={navigable ? 0 : undefined}
    >
      {editMode ? (
        <div className="absolute -top-2 right-2 z-10 flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-1.5 py-0.5 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
          <button
            {...attributes}
            {...listeners}
            className="cursor-grab px-1 text-zinc-400 hover:text-zinc-700 active:cursor-grabbing dark:hover:text-zinc-200"
            aria-label={label}
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
