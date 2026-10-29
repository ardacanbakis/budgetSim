"use client";

import Link from "next/link";
import { ReactNode, useMemo, useState } from "react";
import { CardPaymentModal } from "@/components/cardPaymentModal";
import { Money, Section } from "@/components/pocket/kit";
import { AmountPhrase, PaceBar } from "@/components/pocket/paceBar";
import { Card, CardHeader, Spinner } from "@/components/ui";
import { useVictvsForecast, VictvsForecastView } from "@/components/victvsForecast";
import { useApp } from "@/lib/data/provider";
import { useLoans, useRates, useSnapshots, useTemplates } from "@/lib/data/queries";
import { Account } from "@/lib/data/types";
import { chargeAmount } from "@/lib/domain/cards";
import { computeDebtOverview } from "@/lib/domain/debt";
import { cardStandings } from "@/lib/domain/purchases";
import { templateProgress } from "@/lib/domain/templateStatus";
import { useI18n } from "@/lib/i18n";
import { CardId } from "@/lib/ui/dashboardLayout";
import { debtHref, statementRows, thisMonthSummary, trendPoints } from "@/lib/ui/dashboardCards";
import { monthlyCommitments } from "@/lib/ui/pocket/commitments";
import { formatRow, formatSigned } from "@/lib/ui/pocket/format";
import { AMOUNT_SLOT, recentRows, RECENT_DAYS } from "@/lib/ui/pocket/homeSections";
import { DashboardData } from "@/lib/useDashboardData";
import { useFormatDate } from "@/lib/useFormatDate";

/**
 * The dashboards' optional cards, off until turned on in Settings →
 * Dashboard: This month, Card statements, 12-month trend, Debts, Fixed
 * costs, Recent activity and the VICTVS outlook. One body each, drawn in a
 * Card on Classic and version 2 (frame "card") and as a Section on Pocket's
 * Home (frame "section"). The arithmetic is lib/ui/dashboardCards.ts and the
 * domain's own; every figure is a Money, so Pocket's Hide amounts blurs it.
 *
 * A card only mounts while it's on, so what it computes (and the data it
 * asks for: snapshots, loans, templates, the VICTVS forecast) costs nothing
 * while it's off. Buttons and links inside stop their clicks: on Classic the
 * whole card is a link to its page.
 */

export type OptionalCardId = Extract<
  CardId,
  "this-month" | "card-statements" | "trend" | "debt" | "commitments" | "recent" | "victvs-outlook"
>;

export const OPTIONAL_CARDS: readonly OptionalCardId[] = [
  "this-month",
  "card-statements",
  "trend",
  "debt",
  "commitments",
  "recent",
  "victvs-outlook",
];

const stop = (e: React.MouseEvent) => e.stopPropagation();
const linkClass = "text-xs text-teal-600 hover:underline dark:text-teal-400";
const muted = "text-xs text-zinc-500 dark:text-zinc-400";

export function OptionalCard({
  id,
  d,
  frame,
  className,
}: {
  id: OptionalCardId;
  d: DashboardData;
  frame: "card" | "section";
  className?: string;
}) {
  const { t } = useI18n();
  const title = t(`dashboard.card_${id}`);
  const body = (() => {
    switch (id) {
      case "this-month":
        return <ThisMonthBody d={d} />;
      case "card-statements":
        return <StatementsBody d={d} />;
      case "trend":
        return <TrendBody d={d} />;
      case "debt":
        return <DebtBody d={d} />;
      case "commitments":
        return <CommitmentsBody d={d} />;
      case "recent":
        return <RecentBody d={d} />;
      case "victvs-outlook":
        return <VictvsOutlookBody />;
    }
  })();
  if (frame === "section") {
    return (
      <Section title={title}>
        <div data-optional-card={id}>
          {body}
        </div>
      </Section>
    );
  }
  return (
    <Card className={className}>
      <CardHeader title={title} />
      <div data-optional-card={id} className="p-4">
        {body}
      </div>
    </Card>
  );
}

function Line({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5 text-sm">
      <span className="min-w-0 truncate text-zinc-600 dark:text-zinc-300">{label}</span>
      <span className="shrink-0 font-semibold">{children}</span>
    </div>
  );
}

/* ------------------------------------------------------------ this month */

function ThisMonthBody({ d }: { d: DashboardData }) {
  const { t, locale } = useI18n();
  const { displayCurrency } = useApp();
  const m = useMemo(() => thisMonthSummary(d.flow, d.today), [d.flow, d.today]);
  if (!m) return <p className={muted}>{t("dashboard.noMonth")}</p>;
  return (
    <div className="space-y-2">
      <div>
        <Line label={t("dashboard.income")}>
          <Money amount={m.income} currency={displayCurrency} sign="in" tone={m.income > 0.005 ? "pos" : undefined} />
        </Line>
        <Line label={t("dashboard.expense")}>
          <Money amount={m.expense} currency={displayCurrency} sign="out" />
        </Line>
        <Line
          label={
            <>
              {t("dashboard.kept")}
              {m.savingsRate != null ? (
                <span className="ml-1.5 text-xs text-zinc-400">{t("dashboard.keptRate", { pct: Math.round(m.savingsRate * 100) })}</span>
              ) : null}
            </>
          }
        >
          <Money amount={m.net} currency={displayCurrency} tone={m.net < 0 ? "neg" : "pos"} />
        </Line>
        {m.usual ? (
          <p className={`${muted} text-right`}>
            <AmountPhrase text={t("dashboard.usualNet", { amount: AMOUNT_SLOT })} amount={formatSigned(m.usual.net, displayCurrency, locale)} />
          </p>
        ) : null}
      </div>
      {m.pace && m.usual ? (
        <div data-month-pace={m.pace.tone}>
          <p className={`text-xs ${m.pace.tone === "ok" ? "text-zinc-500 dark:text-zinc-400" : "text-amber-700 dark:text-amber-400"}`}>
            {t(m.pace.tone === "ok" ? "dashboard.paceOk" : m.pace.tone === "ahead" ? "dashboard.paceAhead" : "dashboard.paceOver")}
          </p>
          <PaceBar
            name={t("dashboard.expense")}
            spent={m.expense}
            limit={m.usual.expense}
            currency={displayCurrency}
            today={d.today}
          />
        </div>
      ) : null}
      <p className={muted}>{t("dashboard.cashBasis")}</p>
    </div>
  );
}

/* ------------------------------------------------------- card statements */

function StatementsBody({ d }: { d: DashboardData }) {
  const { t, locale } = useI18n();
  const [paying, setPaying] = useState<Account | null>(null);
  const rows = useMemo(
    () =>
      statementRows({
        standings: cardStandings(d.accounts, d.book, d.today),
        book: d.book,
        today: d.today,
        duePayments: d.duePayments,
      }),
    [d.accounts, d.book, d.today, d.duePayments]
  );
  const monthName = (m: string) =>
    new Date(`${m}-01T00:00:00`).toLocaleDateString(locale === "tr" ? "tr-TR" : "en-GB", { month: "short" });
  const covers = paying ? d.book.wouldCover(paying.id, d.today.slice(0, 7)) : [];

  const due = (days: number | null, paid: boolean) =>
    paid
      ? t("dashboard.paidThisMonth")
      : days == null
        ? t("dashboard.noPayDay")
        : days === 0
          ? t("dashboard.dueToday")
          : days < 0
            ? t("dashboard.dueLate", { count: -days })
            : t("dashboard.dueIn", { count: days });

  return (
    <div className="space-y-3">
      {rows.active.length === 0 ? <p className={muted}>{t("dashboard.noStatements")}</p> : null}
      {rows.active.map(({ account, standing, figure, next }) => {
        const used = account.creditLimit ? Math.min(1, Math.max(0, standing.owed / account.creditLimit)) : null;
        return (
          <div key={account.id} data-statement={account.name} className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{account.name}</div>
                <div className={muted}>{due(standing.daysToDue, standing.paidThisMonth)}</div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Money amount={figure.amount} currency={account.currency} sign="out" className="text-sm font-semibold" />
                {figure.amount > 0.005 && !standing.paidThisMonth ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      stop(e);
                      setPaying(account);
                    }}
                    aria-label={t("pocket.home.payCard", { name: account.name })}
                    className="flex h-11 min-w-11 items-center justify-center"
                  >
                    <span className="flex h-8 items-center rounded-full bg-teal-600 px-3 text-xs font-semibold text-white hover:bg-teal-700 dark:bg-teal-500 dark:text-zinc-950">
                      {t("pocket.home.pay")}
                    </span>
                  </button>
                ) : null}
              </div>
            </div>
            {used != null ? (
              <div
                role="meter"
                aria-label={t("dashboard.limitUsed", { pct: Math.round(used * 100) })}
                aria-valuenow={Math.round(used * 100)}
                aria-valuemin={0}
                aria-valuemax={100}
                className="h-1.5 overflow-hidden rounded-full bg-[var(--edge-soft)]"
              >
                <div className={`h-full rounded-full ${used > 0.9 ? "bg-red-500" : "bg-teal-600"}`} style={{ width: `${used * 100}%` }} />
              </div>
            ) : null}
            {next.length > 0 ? (
              <p className={`${muted} tabular-nums`}>
                {next.map((n, i) => (
                  <span key={n.month}>
                    {i > 0 ? " · " : null}
                    {monthName(n.month)} <Money amount={n.total} currency={account.currency} sign="none" />
                  </span>
                ))}
              </p>
            ) : null}
          </div>
        );
      })}
      {rows.idle.length > 0 ? <p className={muted}>{t("dashboard.idleCards", { count: rows.idle.length })}</p> : null}
      <div onClick={stop}>
        <CardPaymentModal
          card={paying}
          suggested={Math.max(0, covers.reduce((sum, c) => sum + chargeAmount(c), 0))}
          covers={covers}
          onClose={() => setPaying(null)}
        />
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- trend */

function TrendBody({ d }: { d: DashboardData }) {
  const { t, locale } = useI18n();
  const { displayCurrency } = useApp();
  const snapshots = useSnapshots();
  const rates = useRates();
  const usdPer = rates.data?.usdPer;
  const trend = useMemo(
    () =>
      snapshots.data && usdPer
        ? trendPoints({ snapshots: snapshots.data, now: d.netWorth.total, usdPer, display: displayCurrency, today: d.today })
        : null,
    [snapshots.data, usdPer, d.netWorth.total, displayCurrency, d.today]
  );
  if (!trend) return <Spinner />;

  const values = trend.points.map((p) => p.value);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const W = 300;
  const H = 64;
  const x = (i: number) => (trend.points.length === 1 ? W / 2 : (i / (trend.points.length - 1)) * W);
  const y = (v: number) => H - 4 - ((v - lo) / span) * (H - 8);
  const monthName = (m: string) =>
    m === "now"
      ? t("dashboard.now")
      : new Date(`${m}-01T00:00:00`).toLocaleDateString(locale === "tr" ? "tr-TR" : "en-GB", { month: "short", year: "2-digit" });

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <Money amount={d.netWorth.total} currency={displayCurrency} className="text-xl font-bold" />
        {trend.change != null ? (
          <span className={`text-xs ${trend.change < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}>
            <AmountPhrase
              text={t("dashboard.sinceSnapshot", { amount: AMOUNT_SLOT })}
              amount={formatSigned(trend.change, displayCurrency, locale, trend.change < 0 ? "auto" : "in")}
            />
          </span>
        ) : null}
      </div>
      {trend.points.length > 1 ? (
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-16 w-full"
          preserveAspectRatio="none"
          role="img"
          aria-label={trend.points.map((p) => monthName(p.month)).join(", ")}
        >
          <polyline
            fill="none"
            stroke="var(--viz-series-1)"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
            points={trend.points.map((p, i) => `${x(i)},${y(p.value)}`).join(" ")}
          />
          <circle cx={x(trend.points.length - 1)} cy={y(trend.points.at(-1)!.value)} r={3} fill="var(--viz-series-1)" />
        </svg>
      ) : null}
      {trend.points.length > 1 ? (
        <div className={`flex justify-between ${muted}`}>
          <span>{monthName(trend.points[0].month)}</span>
          {trend.overPeriod != null ? (
            <span>
              <AmountPhrase
                text={t("dashboard.overPeriod", { amount: AMOUNT_SLOT })}
                amount={formatSigned(trend.overPeriod, displayCurrency, locale, trend.overPeriod < 0 ? "auto" : "in")}
              />
            </span>
          ) : null}
          <span>{t("dashboard.now")}</span>
        </div>
      ) : (
        <p className={muted}>{t("dashboard.firstPoint")}</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ debt */

function DebtBody({ d }: { d: DashboardData }) {
  const { t } = useI18n();
  const { displayCurrency } = useApp();
  const fmtDate = useFormatDate();
  const loans = useLoans();
  const rates = useRates();
  const usdPer = rates.data?.usdPer;
  const debt = useMemo(
    () =>
      loans.data && usdPer
        ? computeDebtOverview({
            loans: loans.data,
            accounts: d.accounts,
            balances: d.balances,
            transactions: d.transactions,
            usdPer,
            display: displayCurrency,
            today: d.today,
          })
        : null,
    [loans.data, usdPer, d.accounts, d.balances, d.transactions, displayCurrency, d.today]
  );
  if (!debt) return <Spinner />;
  if (debt.items.length === 0) return <p className={muted}>{t("dashboard.noDebt")}</p>;
  const target = debt.avalancheTarget;
  return (
    <div className="space-y-1">
      <Line label={t("dashboard.debtTotal")}>
        <Money amount={debt.totalInDisplay} currency={displayCurrency} sign="out" />
      </Line>
      {debt.debtFreeDate ? <p className={muted}>{t("dashboard.debtFree", { date: fmtDate(debt.debtFreeDate) })}</p> : null}
      {target ? (
        <Link href={target.kind === "loan" ? debtHref(target.id) : "/cards"} onClick={stop} className={`block ${linkClass}`}>
          {t("dashboard.payFirst", { name: target.name })} →
        </Link>
      ) : null}
    </div>
  );
}

/* ----------------------------------------------------------- commitments */

function CommitmentsBody({ d }: { d: DashboardData }) {
  const { t } = useI18n();
  const { displayCurrency } = useApp();
  const fmtDate = useFormatDate();
  const templates = useTemplates();
  const rates = useRates();
  const usdPer = rates.data?.usdPer;
  const result = useMemo(() => {
    if (!templates.data) return null;
    const progressById = new Map(templates.data.map((tpl) => [tpl.id, templateProgress(tpl, d.transactions, d.today)]));
    const accountsById = new Map(d.accounts.map((a) => [a.id, a]));
    return {
      totals: monthlyCommitments({ templates: templates.data, progressById, accountsById, usdPer, display: displayCurrency }),
      toConfirm: [...progressById.values()].filter((p) => p.status === "toConfirm").length,
    };
  }, [templates.data, d.transactions, d.today, d.accounts, usdPer, displayCurrency]);
  if (!result) return <Spinner />;
  const { totals, toConfirm } = result;
  return (
    <div className="space-y-1">
      <Line label={t("dashboard.perMonthOut")}>
        <Money amount={totals.out} currency={displayCurrency} sign="out" />
      </Line>
      <Line label={t("dashboard.perMonthIn")}>
        <Money amount={totals.in} currency={displayCurrency} sign="in" tone={totals.in > 0.005 ? "pos" : undefined} />
      </Line>
      {totals.next ? <p className={muted}>{t("dashboard.nextCommitment", { name: totals.next.name, date: fmtDate(totals.next.due) })}</p> : null}
      {toConfirm > 0 ? (
        <Link
          href="/transactions?tab=recurring"
          onClick={stop}
          className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 hover:underline dark:bg-amber-950 dark:text-amber-200"
        >
          {t("dashboard.toConfirmN", { count: toConfirm })} →
        </Link>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------- recent */

function RecentBody({ d }: { d: DashboardData }) {
  const { t, locale } = useI18n();
  const fmtDate = useFormatDate();
  const accountsById = useMemo(() => new Map(d.accounts.map((a) => [a.id, a])), [d.accounts]);
  const rows = useMemo(() => recentRows(d.transactions, d.book, accountsById, d.today), [d.transactions, d.book, accountsById, d.today]);
  if (rows.length === 0) return <p className={muted}>{t("dashboard.nothingRecent", { count: RECENT_DAYS })}</p>;
  return (
    <ul className="divide-y divide-[var(--edge-soft)]">
      {rows.map((tx) => {
        const account = accountsById.get(tx.accountId)!;
        return (
          <li key={tx.id} className="flex items-center justify-between gap-3 py-1.5">
            <div className="min-w-0">
              <div className="truncate text-sm">{tx.description || account.name}</div>
              <div className={muted}>
                {account.name} · <span className="tabular-nums">{fmtDate(tx.dueDate)}</span>
              </div>
            </div>
            <span
              data-amount
              className={`shrink-0 text-sm font-semibold tabular-nums ${tx.direction === "income" ? "text-emerald-600 dark:text-emerald-400" : ""}`}
            >
              {formatRow(tx.direction, tx.amount, account.currency, locale)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/* --------------------------------------------------------- VICTVS outlook */

function VictvsOutlookBody() {
  const forecast = useVictvsForecast(3);
  if (!forecast) return <Spinner />;
  return <VictvsForecastView forecast={forecast} rows={3} />;
}
