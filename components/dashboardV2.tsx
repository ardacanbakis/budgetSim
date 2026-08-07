"use client";

import Link from "next/link";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AvgSpendCard } from "@/components/avgSpendCard";
import { BudgetsCard } from "@/components/budgetsCard";
import { CardPaymentReminder } from "@/components/cardPaymentReminder";
import { GoalsCard } from "@/components/goalsCard";
import { Badge, Card, CardHeader, EmptyState, Figure, Spinner } from "@/components/ui";
import { useApp } from "@/lib/data/provider";
import { formatAmount } from "@/lib/domain/currencies";
import { convert } from "@/lib/domain/fx";
import { useDashboardData } from "@/lib/useDashboardData";
import { useFormatDate } from "@/lib/useFormatDate";
import { useI18n } from "@/lib/i18n";
import { useRates } from "@/lib/data/queries";

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
 */
export function DashboardV2() {
  const { t, locale } = useI18n();
  const fmtDate = useFormatDate();
  const { displayCurrency } = useApp();
  const rates = useRates();
  const d = useDashboardData(displayCurrency);

  if (!d) return <Spinner />;

  const money = (n: number) => formatAmount(n, displayCurrency, locale);
  const positive = d.netWorth.total >= 0;

  const live = d.accounts.filter((a) => !a.archived);
  const assets = live.filter((a) => a.kind !== "credit_card");
  const cards = live.filter((a) => a.kind === "credit_card");
  const accountById = new Map(d.accounts.map((a) => [a.id, a]));

  const inDisplay = (id: string): number | null => {
    const a = accountById.get(id);
    if (!a || !rates.data) return null;
    return convert(d.balances.get(id) ?? 0, a.currency, displayCurrency, rates.data.usdPer);
  };

  // biggest holding first: the ledger is for finding a number, not for
  // admiring the order you happened to create accounts in
  const byValue = (list: typeof live) =>
    [...list].sort((a, b) => Math.abs(inDisplay(b.id) ?? 0) - Math.abs(inDisplay(a.id) ?? 0));

  return (
    <div className="space-y-[var(--ui-gap)]">
      {/* headline: the one number, and the three that qualify it */}
      <Card>
        <div className="px-[var(--ui-card-pad-x)] py-[calc(var(--ui-card-pad-y)*1.5)]">
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
            {d.liability > 0 ? (
              <span className="text-xs text-zinc-500">
                −{money(d.liability)} {t("purchases.inclInstallments")}
              </span>
            ) : null}
          </div>
        </div>
        <div className="grid grid-cols-2 divide-x divide-[var(--edge-soft)] border-t border-[var(--edge-soft)] sm:grid-cols-3">
          <HeroStat
            href="/transactions"
            label={t("dashboard.safeToSpend")}
            value={money(d.safe.total)}
            tone={d.safe.total >= 0 ? "pos" : "neg"}
          />
          <HeroStat
            href="/cards"
            label={t("purchases.ccDebtTile")}
            value={money(d.ccPostedDebt)}
            tone={d.ccPostedDebt > 0 ? "neg" : undefined}
          />
          <HeroStat
            href="/victvs"
            label={t("dashboard.unpaidVictvs")}
            value={formatAmount(d.unpaidVictvs, "USD", locale)}
            className="col-span-2 border-t border-[var(--edge-soft)] sm:col-span-1 sm:border-t-0"
          />
        </div>
      </Card>

      {d.duePayments.length > 0 ? <CardPaymentReminder duePayments={d.duePayments} /> : null}

      <div className="grid gap-[var(--ui-gap)] lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {/* what you hold */}
        <Card>
          <CardHeader
            title={t("dashboard.accounts")}
            action={
              <Link href="/accounts" className="text-xs text-teal-600 hover:underline dark:text-teal-400">
                {t("dashboard.seeAll")}
              </Link>
            }
          />
          <div className="divide-y divide-[var(--edge-soft)]">
            {assets.length === 0 ? (
              <div className="p-[var(--ui-card-pad-x)]">
                <EmptyState>{t("accounts.empty")}</EmptyState>
              </div>
            ) : (
              byValue(assets).map((a) => (
                <LedgerRow
                  key={a.id}
                  name={a.name}
                  meta={a.currency === "XAU_G" ? "GOLD g" : a.currency}
                  raw={formatAmount(d.balances.get(a.id) ?? 0, a.currency, locale)}
                  converted={a.currency === displayCurrency ? null : money(inDisplay(a.id) ?? 0)}
                />
              ))
            )}
            {cards.map((a) => (
              <LedgerRow
                key={a.id}
                name={a.name}
                meta={t("nav.cards")}
                raw={formatAmount(d.balances.get(a.id) ?? 0, a.currency, locale)}
                converted={a.currency === displayCurrency ? null : money(inDisplay(a.id) ?? 0)}
                tone={(d.balances.get(a.id) ?? 0) < 0 ? "neg" : undefined}
              />
            ))}
          </div>
        </Card>

        {/* what's about to happen */}
        <Card>
          <CardHeader
            title={t("dashboard.upcoming")}
            action={
              <Link href="/transactions" className="text-xs text-teal-600 hover:underline dark:text-teal-400">
                {t("dashboard.seeAll")}
              </Link>
            }
          />
          {d.upcoming.length === 0 ? (
            <div className="p-[var(--ui-card-pad-x)]">
              <EmptyState>{t("dashboard.noUpcoming")}</EmptyState>
            </div>
          ) : (
            <ol className="divide-y divide-[var(--edge-soft)]">
              {d.upcoming.map((tx) => {
                const a = accountById.get(tx.accountId);
                const overdue = tx.dueDate < d.today;
                return (
                  <li
                    key={tx.id}
                    className="flex items-center justify-between gap-3 px-[var(--ui-card-pad-x)] py-[var(--ui-row-py)]"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm">{tx.description || a?.name || "—"}</div>
                      <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                        <span className="tnum">{fmtDate(tx.dueDate)}</span>
                        {overdue ? <Badge tone="red">{t("dashboard.overdue")}</Badge> : null}
                      </div>
                    </div>
                    <Figure size="sm" tone={tx.direction === "income" ? "pos" : undefined}>
                      {tx.direction === "income" ? "+" : "−"}
                      {a ? formatAmount(tx.amount, a.currency, locale) : tx.amount}
                    </Figure>
                  </li>
                );
              })}
            </ol>
          )}
        </Card>
      </div>

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

      <div className="grid gap-[var(--ui-gap)] lg:grid-cols-3">
        <BudgetsCard />
        <GoalsCard />
        <AvgSpendCard />
      </div>
    </div>
  );
}

function HeroStat({
  label,
  value,
  href,
  tone,
  className,
}: {
  label: string;
  value: string;
  href: string;
  tone?: "pos" | "neg";
  className?: string;
}) {
  return (
    <Link
      href={href}
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
  meta: string;
  raw: string;
  converted: string | null;
  tone?: "pos" | "neg";
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-[var(--ui-card-pad-x)] py-[var(--ui-row-py)]">
      <div className="min-w-0">
        <div className="truncate text-sm">{name}</div>
        <div className="text-xs text-zinc-500">{meta}</div>
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
