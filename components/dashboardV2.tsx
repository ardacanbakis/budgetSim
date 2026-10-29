"use client";

import Link from "next/link";
import { ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PendingConversions } from "@/components/convertedIncome";
import { AvgSpendCard } from "@/components/avgSpendCard";
import { BudgetsCard } from "@/components/budgetsCard";
import { CardPaymentReminder } from "@/components/cardPaymentReminder";
import { DataCheckNudge } from "@/components/dataCheck";
import { OPTIONAL_CARDS, OptionalCard, OptionalCardId } from "@/components/dashboardCards";
import { AccountsLeftOut } from "@/components/dashboardParts";
import { UpcomingCard, useUpcomingItems } from "@/components/dashboardUpcoming";
import { GoalsCard } from "@/components/goalsCard";
import { GoldLensCard } from "@/components/goldLens";
import { HoldingsSummary } from "@/components/goldHoldings";
import { Card, CardHeader, EmptyState, Figure, Spinner } from "@/components/ui";
import { useApp } from "@/lib/data/provider";
import { formatAmount } from "@/lib/domain/currencies";
import { useDashboardData } from "@/lib/useDashboardData";
import { useI18n } from "@/lib/i18n";
import { useRates } from "@/lib/data/queries";
import { CardId, isCardVisible, visibleCards } from "@/lib/ui/dashboardLayout";
import { dashboardAccountRows } from "@/lib/ui/dashboardAccounts";
import { isMixedGold } from "@/lib/ui/pocket/portfolioSections";
import { useDashboardLayout } from "@/lib/ui/useDashboardLayout";

const tooltipStyle = {
  backgroundColor: "var(--viz-tooltip-bg)",
  border: "1px solid var(--viz-grid)",
  borderRadius: 8,
  fontSize: 12,
};

/**
 * The version-2 dashboard: one hero figure, then the ledger, then what's
 * coming.
 *
 * The v1 grid gave ten cards equal billing, so the number you actually open
 * the app for — what am I worth, and can I spend — competed with a goals
 * widget for attention. Here the headline gets the whole top strip, the
 * supporting stats hang off it as a rule-separated row, and everything else
 * sorts into two columns: what you hold on the left, what's about to happen on
 * the right. Reading order matches the order you ask the questions in.
 *
 * The cards chosen in Settings (the synced layout, lib/ui/dashboardLayout.ts)
 * fill that composition rather than rearrange it: the headline always shows;
 * a stat, the accounts, upcoming or the flow chart that's off leaves its
 * place (accounts or upcoming alone take the full width); the grid at the
 * foot holds every other card that's on, in the layout's order.
 */
export function DashboardV2() {
  const { t, locale } = useI18n();
  const { displayCurrency } = useApp();
  const rates = useRates();
  const d = useDashboardData(displayCurrency);
  const { layout, navHrefs } = useDashboardLayout();
  const upcoming = useUpcomingItems(d, layout, layout ? isCardVisible(layout, "victvs", "v2", navHrefs) : false);

  if (!d || !layout) return <Spinner />;

  const visible = visibleCards(layout, "v2", navHrefs);
  const on = (id: CardId) => visible.includes(id);

  const money = (n: number) => formatAmount(n, displayCurrency, locale);
  const positive = d.netWorth.total >= 0;

  const live = d.accounts.filter((a) => !a.archived);

  // biggest holding first, cards last: the ledger is for finding a number,
  // not for admiring the order you happened to create accounts in. Every
  // account, less those chosen away in Settings (the totals still count them).
  const accountRows = dashboardAccountRows({ ...d, usdPer: rates.data?.usdPer, display: displayCurrency }, layout.accounts);

  const stats = [
    on("safe-to-spend")
      ? { id: "safe-to-spend", href: "/transactions", label: t("dashboard.safeToSpend"), value: money(d.safe.total), tone: d.safe.total >= 0 ? "pos" : "neg" }
      : null,
    on("cc-debt")
      ? { id: "cc-debt", href: "/cards", label: t("purchases.ccDebtTile"), value: money(d.cardsOwed), tone: d.cardsOwed > 0 ? "neg" : undefined }
      : null,
    on("victvs")
      ? { id: "victvs", href: "/victvs", label: t("dashboard.unpaidVictvs"), value: formatAmount(d.unpaidVictvs, "USD", locale) }
      : null,
  ].filter((s) => s != null) as Array<{ id: string; href: string; label: string; value: string; tone?: "pos" | "neg" }>;
  // three sit side by side from sm up; on a phone the third takes a row of its own
  const statGrid = stats.length === 1 ? "grid-cols-1" : stats.length === 2 ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3";

  // the grid at the foot: every other card that's on, in the layout's order
  const gridCards: Partial<Record<CardId, ReactNode>> = {
    "gold-lens": <GoldLensCard className="h-full" />,
    budgets: <BudgetsCard className="h-full" />,
    goals: <GoalsCard className="h-full" />,
    "avg-spend": <AvgSpendCard className="h-full" />,
    ...(Object.fromEntries(
      OPTIONAL_CARDS.map((id) => [id, <OptionalCard key={id} id={id} d={d} frame="card" className="h-full" />])
    ) as Record<OptionalCardId, ReactNode>),
  };
  const grid = visible.filter((id) => gridCards[id] != null);

  const accountsCard = (
    <div data-card="accounts">
      <Card className="h-full">
        <CardHeader
          title={t("dashboard.accounts")}
          action={
            <Link href="/accounts" className="text-xs text-teal-600 hover:underline dark:text-teal-400">
              {t("dashboard.seeAll")}
            </Link>
          }
        />
        <div className="divide-y divide-[var(--edge-soft)]">
          {live.length === 0 ? (
            <div className="p-[var(--ui-card-pad-x)]">
              <EmptyState>{t("accounts.empty")}</EmptyState>
            </div>
          ) : (
            accountRows.rows.map(({ account: a, shown, converted, card, balance }) =>
              card ? (
                // a card shows what it's owed, not its ledger balance (lib/domain/cards.ts)
                <LedgerRow
                  key={a.id}
                  name={a.name}
                  meta={t("nav.cards")}
                  raw={formatAmount(balance, a.currency, locale)}
                  converted={a.currency === displayCurrency ? null : money(converted ?? 0)}
                  tone={card.owed > 0.005 ? "neg" : undefined}
                />
              ) : (
                // a gold account holding a mix reads in lira, with what it holds as its label
                <LedgerRow
                  key={a.id}
                  name={a.name}
                  meta={isMixedGold(a) ? <HoldingsSummary holdings={a.holdings!} /> : a.currency === "XAU_G" ? "GOLD g" : a.currency}
                  raw={formatAmount(shown.amount, shown.currency, locale)}
                  converted={shown.currency === displayCurrency ? null : money(converted ?? 0)}
                />
              )
            )
          )}
        </div>
        <AccountsLeftOut
          hidden={accountRows.hiddenCount}
          empty={accountRows.emptyHidden}
          className="mt-0 border-t border-[var(--edge-soft)] px-[var(--ui-card-pad-x)] py-[var(--ui-row-py)]"
        />
      </Card>
    </div>
  );

  const upcomingCard = upcoming ? (
    <div data-card="upcoming">
      <UpcomingCard d={d} items={upcoming} days={layout.upcomingDays} variant="v2" className="h-full" />
    </div>
  ) : null;

  return (
    <div className="space-y-[var(--ui-gap)]">
      {/* headline: the one number, and the stats that qualify it */}
      <Card>
        <div data-card="net-worth" className="px-[var(--ui-card-pad-x)] py-[calc(var(--ui-card-pad-y)*1.5)]">
          <div
            className="text-[length:var(--ui-head-size)] text-[color:var(--ui-head-color)]"
            style={{
              fontWeight: "var(--ui-head-weight)" as unknown as number,
              letterSpacing: "var(--ui-head-tracking)",
              textTransform: "var(--ui-head-transform)" as React.CSSProperties["textTransform"],
            }}
          >
            {t("dashboard.netWorth")} · {displayCurrency}
          </div>
          <div className="mt-1 flex flex-wrap items-baseline gap-3">
            <Figure size="xl" tone={positive ? undefined : "neg"}>
              {money(d.netWorth.total)}
            </Figure>
            {d.cardsOwed > 0 ? (
              <span className="text-xs text-zinc-500">
                −{money(d.cardsOwed)} {t("purchases.inclInstallments")}
              </span>
            ) : null}
          </div>
          {d.netWorth.skippedAccountIds.length > 0 ? (
            <div className="mt-1 text-xs text-amber-600 dark:text-amber-400">{t("dashboard.skippedAccounts")}</div>
          ) : null}
        </div>
        {stats.length > 0 ? (
          <div className={`grid ${statGrid} divide-x divide-[var(--edge-soft)] border-t border-[var(--edge-soft)]`}>
            {stats.map((s, i) => (
              <HeroStat
                key={s.id}
                id={s.id}
                href={s.href}
                label={s.label}
                value={s.value}
                tone={s.tone}
                className={
                  stats.length === 3 && i === 2 ? "col-span-2 border-t border-[var(--edge-soft)] sm:col-span-1 sm:border-t-0" : undefined
                }
              />
            ))}
          </div>
        ) : null}
      </Card>

      {d.duePayments.length > 0 ? <CardPaymentReminder duePayments={d.duePayments} /> : null}
      <DataCheckNudge />
      <PendingConversions />

      {on("accounts") && on("upcoming") ? (
        <div className="grid gap-[var(--ui-gap)] lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          {/* what you hold, and what's about to happen */}
          {accountsCard}
          {upcomingCard}
        </div>
      ) : on("accounts") ? (
        accountsCard
      ) : on("upcoming") ? (
        upcomingCard
      ) : null}

      {on("monthly-flow") ? (
        <div data-card="monthly-flow">
          <Card>
            <CardHeader title={t("dashboard.monthlyFlow")} />
            <div className="h-64 p-[var(--ui-card-pad-x)]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={d.flow}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--viz-grid)" vertical={false} />
                  <XAxis dataKey="month" stroke="var(--viz-axis)" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="var(--viz-axis)" fontSize={11} tickLine={false} axisLine={false} width={64} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v) => money(Number(v))} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="income" name={t("dashboard.income")} fill="var(--viz-series-2)" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="expense" name={t("dashboard.expense")} fill="var(--viz-series-3)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
      ) : null}

      {grid.length > 0 ? (
        <div className="grid gap-[var(--ui-gap)] lg:grid-cols-3">
          {grid.map((id) => (
            <div key={id} data-card={id}>
              {gridCards[id]}
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex justify-end">
        <Link href="/settings?tab=dashboard" className="text-xs text-teal-600 hover:underline dark:text-teal-400">
          {t("dashboard.customise")} →
        </Link>
      </div>
    </div>
  );
}

function HeroStat({
  id,
  label,
  value,
  href,
  tone,
  className,
}: {
  id: string;
  label: string;
  value: string;
  href: string;
  tone?: "pos" | "neg";
  className?: string;
}) {
  return (
    <Link
      href={href}
      data-card={id}
      className={`block px-[var(--ui-card-pad-x)] py-[var(--ui-card-pad-y)] transition-colors hover:bg-[var(--edge-soft)] ${className ?? ""}`}
    >
      <div className="truncate text-xs text-zinc-500">{label}</div>
      <Figure size="md" tone={tone} className="mt-0.5 block">
        {value}
      </Figure>
    </Link>
  );
}

/**
 * One holding. The name is free to be long and the figure is free to be exact,
 * because they're on opposite ends of a row with tabular digits — which is the
 * whole reason columns of money are readable at all.
 */
function LedgerRow({
  name,
  meta,
  raw,
  converted,
  tone,
}: {
  name: string;
  meta: React.ReactNode;
  raw: string;
  converted: string | null;
  tone?: "pos" | "neg";
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-[var(--ui-card-pad-x)] py-[var(--ui-row-py)]">
      <div className="min-w-0">
        <div className="truncate text-sm">{name}</div>
        <div className="truncate text-xs text-zinc-500">{meta}</div>
      </div>
      <div className="shrink-0 text-right">
        <Figure size="sm" tone={tone} className="block">
          {raw}
        </Figure>
        {converted ? <div className="text-xs text-zinc-400 tnum">{converted}</div> : null}
      </div>
    </div>
  );
}
