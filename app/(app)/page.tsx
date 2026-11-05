"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  CollisionDetection,
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, SortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PendingConversions } from "@/components/convertedIncome";
import { AvgSpendCard } from "@/components/avgSpendCard";
import { BudgetsCard } from "@/components/budgetsCard";
import { CardPaymentReminders } from "@/components/cardPaymentReminder";
import { DataCheckNudge } from "@/components/dataCheck";
import { GoalsCard } from "@/components/goalsCard";
import { OPTIONAL_CARDS, OptionalCard, OptionalCardId } from "@/components/dashboardCards";
import { AccountsLeftOut } from "@/components/dashboardParts";
import { UpcomingCard, useUpcomingItems } from "@/components/dashboardUpcoming";
import { GoldLensCard } from "@/components/goldLens";
import { Button, Card, CardHeader, Spinner } from "@/components/ui";
import { useApp } from "@/lib/data/provider";
import { useAccounts, useRates, useTransactions } from "@/lib/data/queries";
import { DashboardV2 } from "@/components/dashboardV2";
import { pocketable } from "@/components/pocket/pocketable";
import { formatAmount } from "@/lib/domain/currencies";
import {
  CardId,
  cardsOff,
  cardSpec,
  isCardId,
  isCardVisible,
  moveCard,
  NormalizedLayout,
  setCardVisible,
  visibleCards,
} from "@/lib/ui/dashboardLayout";
import { dashboardAccountRows } from "@/lib/ui/dashboardAccounts";
import { formatSigned } from "@/lib/ui/pocket/format";
import { useDashboardLayout } from "@/lib/ui/useDashboardLayout";
import { useDashboardData } from "@/lib/useDashboardData";
import { useI18n } from "@/lib/i18n";

const PocketHome = dynamic(() => import("@/components/pocket/home").then((m) => m.PocketHome), {
  ssr: false,
  loading: () => <Spinner />,
});

export default pocketable(DashboardPage, PocketHome);

// the tiles stay put while one is dragged, and the place it would take
// lights up: cards of different widths sliding round each other read as a
// jumble, a drop target doesn't
const stayPut: SortingStrategy = () => null;

// the place under the pointer, or in a gap the nearest one to it; the
// keyboard, with no pointer, the nearest to the tile it moves
const underPointer: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  if (within.length > 0) return within;
  const p = args.pointerCoordinates;
  if (!p) return closestCenter(args);
  return closestCenter({ ...args, collisionRect: { top: p.y, left: p.x, bottom: p.y, right: p.x, width: 0, height: 0 } });
};

const tooltipStyle = {
  backgroundColor: "var(--viz-tooltip-bg)",
  border: "1px solid var(--viz-grid)",
  borderRadius: 8,
  fontSize: 12,
};

function DashboardPage() {
  const { t, locale } = useI18n();
  const { displayCurrency, uiVersion } = useApp();
  const accounts = useAccounts();
  const transactions = useTransactions();
  const rates = useRates();

  const [editMode, setEditMode] = useState(false);
  // the cards, their order and which are on: synced, and shared with V2 and
  // Settings (lib/ui/dashboardLayout.ts)
  const { layout, navHrefs, update } = useDashboardLayout();

  // the card being dragged, for the copy that follows the pointer
  const [dragging, setDragging] = useState<CardId | null>(null);

  // a mouse picks a tile up after a few pixels; a finger after a short hold,
  // so a swipe still scrolls the page; the keyboard from a tile's grip
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // both dashboards run on the same derivation; only the arrangement differs
  const derived = useDashboardData(displayCurrency);

  const unpaidVictvs = derived?.unpaidVictvs ?? 0;
  const upcoming = useUpcomingItems(derived, layout, layout ? isCardVisible(layout, "victvs", "classic", navHrefs) : false);

  // Classic keeps the card grid below; every v2 skin gets the rebuilt layout.
  // Placed after every hook above so the hook order never changes with style.
  if (uiVersion === "v2") return <DashboardV2 />;

  if (!derived || !layout || accounts.isLoading || transactions.isLoading) return <Spinner />;

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

  const onDragStart = (event: DragStartEvent) => {
    const id = String(event.active.id);
    setDragging(isCardId(id) ? id : null);
  };

  const onDragEnd = (event: DragEndEvent) => {
    setDragging(null);
    const { active, over } = event;
    const id = String(active.id);
    const target = over ? String(over.id) : null;
    if (!target || id === target || !isCardId(id) || !isCardId(target)) return;
    update((l) => moveCard(l, shownIn(l), id, target));
  };

  // a step, or straight to either end of the cards on screen
  const move = (id: CardId, to: "top" | -1 | 1 | "bottom") =>
    update((l) => {
      const shown = shownIn(l);
      const target = to === "top" ? shown[0] : to === "bottom" ? shown[shown.length - 1] : to;
      return target == null ? l : moveCard(l, shown, id, target);
    });
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
        {derived && derived.scheduledVictvs.count > 0 ? (
          <div className="text-xs text-zinc-500" data-victvs-scheduled>
            {t("victvs.scheduledLine", {
              amount: formatAmount(derived.scheduledVictvs.total, "USD", locale),
              count: derived.scheduledVictvs.count,
            })}
          </div>
        ) : null}
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
    upcoming: upcoming ? <UpcomingCard d={derived} items={upcoming} days={layout.upcomingDays} variant="classic" className="h-full" /> : null,
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
    // off until turned on; each mounts, and computes, only while it's on
    ...(Object.fromEntries(
      OPTIONAL_CARDS.map((id) => [id, <OptionalCard key={id} id={id} d={derived} frame="card" className="h-full" />])
    ) as Record<OptionalCardId, React.ReactNode>),
  };

  const visible = shownIn(layout);
  const off = cardsOff(layout, "classic", navHrefs);

  return (
    <div className="mx-auto max-w-6xl space-y-4 3xl:max-w-[1700px]">
      {derived.paymentReminders.length + derived.bills.length > 0 ? (
        <CardPaymentReminders reminders={derived.paymentReminders} bills={derived.bills} />
      ) : null}
      <DataCheckNudge />
      <PendingConversions />

      <div className="flex items-center justify-end gap-2">
        {editMode ? <span className="text-xs text-zinc-400">{t("layout.dragHint")}</span> : null}
        <Button variant={editMode ? "primary" : "ghost"} onClick={() => setEditMode(!editMode)}>
          {editMode ? t("layout.done") : `⠿ ${t("layout.edit")}`}
        </Button>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={underPointer}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDragging(null)}
      >
        <SortableContext items={visible} strategy={stayPut}>
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
                onMove={(to) => move(id, to)}
              >
                {cardContent[id]}
              </SortableCard>
            ))}
          </div>
        </SortableContext>
        {/* what follows the pointer: the tile, lifted, rather than the tile moving in the grid */}
        <DragOverlay>
          {dragging ? (
            <EditTile label={t(cardSpec(dragging).labelKey)} isFirst isLast lifted onHide={() => undefined} onMove={() => undefined} />
          ) : null}
        </DragOverlay>
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

/**
 * One card on Classic's grid. Outside edit mode it's the card itself, and a
 * big click target for its page (inner buttons and links stop their clicks).
 *
 * In edit mode it shrinks to a short tile with the card's name at the width
 * it takes, so the whole layout fits on a screen: a card can be picked up
 * anywhere on its tile (a mouse after a few pixels, a finger after a short
 * hold, so a page still scrolls under a swipe; the grip with the keyboard)
 * and dropped on any other place without a long drag past the cards'
 * content. The buttons do the same in steps: to the top, up, down, to the
 * bottom, and hide.
 */
function SortableCard({
  id,
  label,
  href,
  spanClass,
  editMode,
  isFirst,
  isLast,
  onHide,
  onMove,
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
  onMove: (to: "top" | -1 | 1 | "bottom") => void;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { attributes, listeners, setNodeRef, isDragging, isOver } = useSortable({
    id,
    disabled: !editMode,
  });

  if (editMode) {
    // the mouse and touch sensors start from anywhere on the tile; the
    // keyboard only from the grip, so Enter on a button stays that button's
    const { onKeyDown, ...pointer } = (listeners ?? {}) as Record<string, (e: unknown) => void>;
    return (
      <div
        ref={setNodeRef}
        data-card={id}
        data-editing
        data-drop-target={isOver && !isDragging ? "" : undefined}
        className={`${spanClass} ${isDragging ? "opacity-40" : ""}`}
        {...pointer}
      >
        <EditTile
          label={label}
          grip={{ ...attributes, onKeyDown }}
          isFirst={isFirst}
          isLast={isLast}
          onHide={onHide}
          onMove={onMove}
          target={isOver && !isDragging}
        />
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      data-card={id}
      className={`group relative ${spanClass} ${href ? "cursor-pointer transition-transform hover:-translate-y-0.5" : ""}`}
      onClick={href ? () => router.push(href) : undefined}
      onKeyDown={
        href
          ? (e) => {
              // Enter on a button inside the card is that button's
              if (e.key === "Enter" && e.target === e.currentTarget) router.push(href);
            }
          : undefined
      }
      role={href ? "link" : undefined}
      tabIndex={href ? 0 : undefined}
    >
      {children}
    </div>
  );
}

/** A card in edit mode: its name, the grip, and the buttons that move or hide it. */
function EditTile({
  label,
  grip,
  isFirst,
  isLast,
  onHide,
  onMove,
  lifted = false,
  target = false,
}: {
  label: string;
  grip?: React.HTMLAttributes<HTMLElement>;
  isFirst: boolean;
  isLast: boolean;
  onHide: () => void;
  onMove: (to: "top" | -1 | 1 | "bottom") => void;
  /** the copy that follows the pointer while dragging */
  lifted?: boolean;
  /** the place the dragged card would take if dropped now */
  target?: boolean;
}) {
  const { t } = useI18n();
  const btn =
    "flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 hover:bg-[var(--edge-soft)] hover:text-zinc-800 disabled:pointer-events-none disabled:opacity-30 dark:text-zinc-400 dark:hover:text-zinc-100";
  return (
    <div
      className={`flex h-24 cursor-grab touch-manipulation select-none flex-col justify-between rounded-[var(--ui-card-radius)] border-2 border-dashed bg-[var(--surface)] p-2 active:cursor-grabbing ${
        lifted
          ? "border-teal-500 shadow-xl ring-2 ring-teal-500/30"
          : target
            ? "border-solid border-teal-500 bg-teal-50 dark:bg-teal-950/40"
            : "border-[var(--edge)] hover:border-teal-500"
      }`}
    >
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          {...grip}
          aria-label={label}
          className="flex h-8 w-6 shrink-0 cursor-grab items-center justify-center rounded text-lg leading-none text-zinc-400 hover:text-zinc-700 active:cursor-grabbing dark:hover:text-zinc-200"
        >
          ⠿
        </button>
        <span className="min-w-0 truncate text-sm font-semibold">{label}</span>
      </div>
      <div className="flex items-center justify-end gap-0.5">
        <button type="button" onClick={() => onMove("top")} disabled={isFirst} className={btn} aria-label={t("layout.moveTop")} title={t("layout.moveTop")}>
          ⤒
        </button>
        <button type="button" onClick={() => onMove(-1)} disabled={isFirst} className={btn} aria-label={t("layout.moveUp")} title={t("layout.moveUp")}>
          ↑
        </button>
        <button type="button" onClick={() => onMove(1)} disabled={isLast} className={btn} aria-label={t("layout.moveDown")} title={t("layout.moveDown")}>
          ↓
        </button>
        <button type="button" onClick={() => onMove("bottom")} disabled={isLast} className={btn} aria-label={t("layout.moveBottom")} title={t("layout.moveBottom")}>
          ⤓
        </button>
        <button type="button" onClick={onHide} className={`${btn} hover:text-red-600`} aria-label={t("layout.hide")} title={t("layout.hide")}>
          ✕
        </button>
      </div>
    </div>
  );
}
