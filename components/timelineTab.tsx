"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { Fragment, ReactNode, useMemo, useRef, useState } from "react";
import { CardPaymentModal } from "@/components/cardPaymentModal";
import { describeTx, TxLookup, useDueLabel, useTxLookup } from "@/components/pocket/dayList";
import { FlagGlyph, useMilestoneText } from "@/components/timelineParts";
import { TransactionModal } from "@/components/transactionModal";
import { TransferModal } from "@/components/transferModal";
import { CompleteModal, EditModal } from "@/components/txModals";
import { Badge, Button, Card, CardHeader, EmptyState, Select, Spinner } from "@/components/ui";
import { useRepo } from "@/lib/data/provider";
import { KEYS, useAccounts, useAppMutation, useCategories, useRates } from "@/lib/data/queries";
import { Transaction } from "@/lib/data/types";
import { Currency } from "@/lib/domain/currencies";
import { snapshotFromTable } from "@/lib/domain/fx";
import { addDays } from "@/lib/domain/recurrence";
import { TimelineEvent } from "@/lib/domain/timeline";
import { useI18n } from "@/lib/i18n";
import { monthLabel } from "@/lib/ui/pocket/dayGroups";
import { dayLabel } from "@/lib/ui/pocket/dates";
import { formatSigned } from "@/lib/ui/pocket/format";
import { usePocketFlag } from "@/lib/ui/pocket/prefs";
import { replaceQuery } from "@/lib/ui/shallowUrl";
import {
  balancesAfter,
  bucketTimeline,
  BucketOptions,
  filterTimeline,
  flowBetween,
  lowestRows,
  milestoneHref,
  monthHighlights,
  MonthSummary,
  monthSummaries,
  shortDay,
  TIMELINE_KEYS,
  TIMELINE_PAGE_MONTHS,
  TimelineMonth,
  timelineWindow,
} from "@/lib/ui/timeline";
import { LOOKAHEAD_MONTHS, useTimeline } from "@/lib/useTimeline";

const TimelineChart = dynamic(() => import("@/components/timelineChart"), {
  ssr: false,
  loading: () => <div aria-hidden className="h-[200px] animate-pulse rounded-lg bg-[var(--edge-soft)]" />,
});

type Zoom = "day" | "month";

const segmentClass = (on: boolean) =>
  `whitespace-nowrap rounded-md px-2.5 py-1 text-sm transition-colors ${
    on ? "bg-teal-600 text-white dark:bg-teal-500 dark:text-zinc-950" : "text-zinc-500 hover:bg-[var(--edge-soft)]"
  }`;

/**
 * The Timeline, as the Transactions page's middle tab (?tab=timeline): what
 * happened and what is planned on one axis, from lib/domain/timeline.ts.
 * `tabs` is the page's tab strip, as RecurringTab takes it.
 *
 * - The stream, month by month: each month's in, out and net (and, up to this
 *   month, the six-month average), its days, and its rows: ledger rows with
 *   ✓ Complete and ✎ (the Ledger tab's own forms, components/txModals.tsx),
 *   card statements with their charges and Pay, and milestones. A Today
 *   divider sits between the past and the rest, with the overdue rows under
 *   it. "Day" lists every row; "Month" sums each month up with its biggest
 *   outflows, statements and markers. Last month and the next three to
 *   start with; more three at a time.
 * - Beside it (above it under 1024px): the lowest point ahead per cash
 *   account (a line picks the account), what the next 30 days bring in and
 *   take out, the picked account's balance as a chart, and the milestones
 *   ahead.
 * - With an account picked (?account= too): its rows, both legs of a
 *   transfer on it, nets in its currency and the balance after each row.
 * Milestones and imported history are switches kept on the device, shared
 * with Pocket (lib/ui/timeline.ts TIMELINE_KEYS).
 */
export function TimelineTab({ tabs, accountParam }: { tabs: ReactNode; accountParam: string | null }) {
  const { t, locale } = useI18n();
  const repo = useRepo();
  const accounts = useAccounts();
  const categories = useCategories();
  const rates = useRates();
  const lookup = useTxLookup();
  const timeline = useTimeline(lookup.book);
  const [milestones, setMilestones] = usePocketFlag(TIMELINE_KEYS.milestones, true);
  const [legacy, setLegacy] = usePocketFlag(TIMELINE_KEYS.legacy);
  const [accountId, setAccountId] = useState<string | null>(accountParam);
  const [zoom, setZoom] = useState<Zoom>("day");
  const [past, setPast] = useState(1);
  const [ahead, setAhead] = useState(TIMELINE_PAGE_MONTHS);
  const [txModal, setTxModal] = useState(false);
  const [transferModal, setTransferModal] = useState(false);
  const [completing, setCompleting] = useState<Transaction | null>(null);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [paying, setPaying] = useState<TimelineEvent | null>(null);
  const dividerRef = useRef<HTMLLIElement | null>(null);

  const invalidate = [KEYS.transactions, KEYS.accounts];
  const updateTx = useAppMutation(
    (v: { id: string; patch: Partial<Pick<Transaction, "amount" | "dueDate" | "description" | "categoryId" | "accountId">> }) =>
      repo.updateTransaction(v.id, v.patch),
    invalidate
  );
  const completeTx = useAppMutation(
    (v: { id: string; amount?: number; legacy?: boolean }) =>
      repo.completeTransaction(v.id, snapshotFromTable(rates.data!), v.amount, v.legacy),
    invalidate
  );

  const { accountsById, usdPer, display } = lookup;
  const { events, series, today, horizon, lookahead } = timeline;
  const picked = accountId ? accountsById.get(accountId) : undefined;
  const account = picked && picked.kind !== "credit_card" ? picked : undefined;
  const accountSeries = account ? (series.get(account.id) ?? null) : null;
  const currency: Currency = account?.currency ?? display;

  const pick = (id: string | null) => {
    setAccountId(id);
    replaceQuery(id ? `/transactions?tab=timeline&account=${encodeURIComponent(id)}` : "/transactions?tab=timeline");
  };

  const options: BucketOptions = useMemo(
    () => ({ accountsById, usdPer, display, accountId: account?.id ?? null, series: accountSeries }),
    [accountsById, usdPer, display, account, accountSeries]
  );
  const end = milestones ? events.reduce((last, e) => (e.date > last ? e.date : last), horizon) : horizon;
  const span = timelineWindow(today, past, ahead, end);

  const view = useMemo(() => {
    const filtered = filterTimeline(events, { accountId: account?.id ?? null, milestones, legacy });
    const overdue = filtered.filter((e) => e.status === "overdue");
    const shown = filtered.filter((e) => e.status !== "overdue" && e.date >= span.from && e.date <= span.to);
    return {
      overdue,
      months: bucketTimeline(shown, options),
      summaries: monthSummaries(filtered, { ...options, today }),
      earlier: filtered.some((e) => e.status !== "overdue" && e.date < span.from),
      next30: flowBetween(filtered, today, addDays(today, 30), options),
      markers: filtered.filter((e) => e.kind === "milestone" && e.date >= today).slice(0, 4),
      after: account && accountSeries ? balancesAfter(events, account.id, accountSeries) : null,
    };
  }, [events, account, accountSeries, milestones, legacy, span.from, span.to, options, today]);

  const lows = useMemo(() => lowestRows(series, today, lookahead), [series, today, lookahead]);

  if (lookup.loading || timeline.loading) return <Spinner />;

  const firstAhead = view.months.flatMap((m) => m.days).find((d) => d.date >= today)?.date ?? null;
  const rowProps = {
    lookup,
    accountId: account?.id ?? null,
    after: view.after,
    onComplete: setCompleting,
    onEdit: setEditing,
    onPay: setPaying,
  };
  const divider = (
    <TodayDivider
      key="today"
      divRef={(el) => {
        dividerRef.current = el;
      }}
      today={today}
      overdue={view.overdue}
      rowProps={rowProps}
    />
  );

  return (
    <div className="mx-auto max-w-7xl space-y-4" data-timeline>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">{t("tx.title")}</h1>
        <div className="flex items-center gap-2">
          <Button onClick={() => setTransferModal(true)}>⇄ {t("tx.newTransfer")}</Button>
          <Button variant="primary" onClick={() => setTxModal(true)}>
            + {t("tx.newTransaction")}
          </Button>
        </div>
      </div>

      {tabs}

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("timeline.filters")}>
        <Select
          className="!w-auto"
          aria-label={t("tx.filterAccount")}
          value={account?.id ?? "all"}
          onChange={(e) => pick(e.target.value === "all" ? null : e.target.value)}
        >
          <option value="all">
            {t("tx.filterAccount")}: {t("common.all")}
          </option>
          {(accounts.data ?? [])
            .filter((a) => a.kind !== "credit_card")
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
        </Select>
        <div role="group" aria-label={t("timeline.zoom")} className="flex rounded-lg border border-[var(--edge)] p-0.5">
          {(["day", "month"] as const).map((z) => (
            <button key={z} type="button" aria-pressed={zoom === z} onClick={() => setZoom(z)} className={segmentClass(zoom === z)}>
              {z === "day" ? t("timeline.zoomDay") : t("timeline.zoomMonth")}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-sm text-zinc-600 dark:text-zinc-300">
          <input type="checkbox" className="h-4 w-4 accent-teal-600" checked={milestones} onChange={(e) => setMilestones(e.target.checked)} />
          {t("timeline.milestones")}
        </label>
        <label className="flex items-center gap-1.5 text-sm text-zinc-600 dark:text-zinc-300">
          <input type="checkbox" className="h-4 w-4 accent-teal-600" checked={legacy} onChange={(e) => setLegacy(e.target.checked)} />
          {t("timeline.history")}
        </label>
        <button
          type="button"
          onClick={() => dividerRef.current?.scrollIntoView({ block: "center", behavior: "smooth" })}
          className="text-xs text-teal-600 hover:underline"
        >
          {t("timeline.today")} ↧
        </button>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <aside className="space-y-4 lg:sticky lg:top-4 lg:order-2">
          <Card>
            <CardHeader title={t("timeline.lowestTitle")} />
            {lows.length === 0 ? (
              <p className="px-4 py-3 text-sm text-zinc-500">{t("timeline.nothingAhead", { months: LOOKAHEAD_MONTHS })}</p>
            ) : (
              <ul data-lowest className="divide-y divide-[var(--edge-soft)]">
                {lows.map(({ account: a, low }) => {
                  const late = view.overdue.filter((e) => e.legs.some((l) => l.accountId === a.id)).length;
                  const below = low.belowZeroOn != null;
                  return (
                    <li key={a.id}>
                      <button
                        type="button"
                        aria-pressed={account?.id === a.id}
                        onClick={() => pick(account?.id === a.id ? null : a.id)}
                        className={`flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-[var(--edge-soft)] ${
                          account?.id === a.id ? "bg-[var(--edge-soft)]" : ""
                        }`}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{a.name}</span>
                          <span className={`block text-xs ${below ? "text-red-600 dark:text-red-400" : "text-zinc-500"}`}>
                            {below
                              ? t("timeline.belowZeroOn", { date: shortDay(low.belowZeroOn!, locale) })
                              : t("timeline.lowestOn", { date: shortDay(low.date, locale) })}
                            {late > 0 ? ` · ${t("timeline.includesOverdue", { count: late })}` : ""}
                          </span>
                        </span>
                        <span className={`shrink-0 text-sm font-semibold tabular-nums ${low.balance < 0 ? "text-red-600" : ""}`}>
                          {formatSigned(low.balance, a.currency, locale)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="border-t border-[var(--edge-soft)] px-4 py-2 text-xs text-zinc-500">
              {t("timeline.lowestHint", { months: LOOKAHEAD_MONTHS })}
            </p>
          </Card>

          <Card>
            <CardHeader title={t("timeline.next30")} />
            <dl data-next30 className="grid grid-cols-3 gap-2 px-4 py-3 text-sm">
              <div>
                <dt className="text-xs text-zinc-500">{t("timeline.inLabel")}</dt>
                <dd className="font-semibold tabular-nums text-green-600">{formatSigned(view.next30.income, currency, locale, "in")}</dd>
              </div>
              <div>
                <dt className="text-xs text-zinc-500">{t("timeline.outLabel")}</dt>
                <dd className="font-semibold tabular-nums text-red-600">{formatSigned(view.next30.expense, currency, locale, "out")}</dd>
              </div>
              <div>
                <dt className="text-xs text-zinc-500">{t("timeline.net")}</dt>
                <dd className={`font-semibold tabular-nums ${view.next30.net < 0 ? "text-red-600" : "text-green-600"}`}>
                  {formatSigned(view.next30.net, currency, locale, view.next30.net > 0 ? "in" : "auto")}
                </dd>
              </div>
            </dl>
          </Card>

          {account && accountSeries ? (
            <Card>
              <CardHeader title={account.name} />
              <div className="px-2 py-3">
                <TimelineChart
                  points={accountSeries.points}
                  today={today}
                  from={span.from}
                  to={span.to}
                  currency={account.currency}
                  height={200}
                  label={t("timeline.balanceChart", { name: account.name })}
                />
              </div>
            </Card>
          ) : null}

          {milestones ? (
            <Card>
              <CardHeader title={t("timeline.markersAhead")} />
              {view.markers.length === 0 ? (
                <p className="px-4 py-3 text-sm text-zinc-500">{t("timeline.noMarkers")}</p>
              ) : (
                <ul data-markers className="divide-y divide-[var(--edge-soft)]">
                  {view.markers.map((e) => (
                    <MilestoneRow key={e.key} event={e} />
                  ))}
                </ul>
              )}
            </Card>
          ) : null}
        </aside>

        <div className="space-y-3 lg:order-1">
          {view.earlier ? (
            <Button className="w-full" onClick={() => setPast((p) => p + TIMELINE_PAGE_MONTHS)}>
              {t("timeline.showEarlier")}
            </Button>
          ) : null}

          {view.months.length === 0 && view.overdue.length === 0 ? (
            <>
              <Card>
                <ul>{divider}</ul>
              </Card>
              <EmptyState>{t("timeline.empty")}</EmptyState>
            </>
          ) : (
            <>
              {view.months.map((month) => (
                <MonthCard
                  key={month.month}
                  month={month}
                  summary={view.summaries.get(month.month)}
                  currency={currency}
                  today={today}
                  zoom={zoom}
                  options={options}
                  firstAhead={firstAhead}
                  divider={divider}
                  rowProps={rowProps}
                />
              ))}
              {firstAhead == null ? (
                <Card>
                  <ul>{divider}</ul>
                </Card>
              ) : null}
            </>
          )}

          {span.to < end ? (
            <Button className="w-full" onClick={() => setAhead((a) => a + TIMELINE_PAGE_MONTHS)}>
              {t("timeline.showLater")}
            </Button>
          ) : null}
        </div>
      </div>

      <TransactionModal open={txModal} onClose={() => setTxModal(false)} />
      <TransferModal open={transferModal} onClose={() => setTransferModal(false)} />
      <CardPaymentModal
        card={paying?.cardId ? (accountsById.get(paying.cardId) ?? null) : null}
        suggested={paying?.amount ?? 0}
        covers={paying?.charges ?? []}
        onClose={() => setPaying(null)}
      />
      <CompleteModal
        tx={completing}
        accountCurrency={completing ? accountsById.get(completing.accountId)?.currency : undefined}
        onClose={() => setCompleting(null)}
        onConfirm={async (amount, isLegacy) => {
          if (completing) await completeTx.mutateAsync({ id: completing.id, amount, legacy: isLegacy });
          setCompleting(null);
        }}
      />
      <EditModal
        tx={editing}
        accounts={(accounts.data ?? []).filter((a) => !a.archived && !(editing?.adjustment && a.kind === "credit_card"))}
        categories={categories.data ?? []}
        onClose={() => setEditing(null)}
        onSave={async (patch) => {
          if (editing) await updateTx.mutateAsync({ id: editing.id, patch });
          setEditing(null);
        }}
      />
    </div>
  );
}

interface RowProps {
  lookup: TxLookup;
  accountId: string | null;
  /** the picked account's balance after each row */
  after: Map<string, number> | null;
  onComplete: (tx: Transaction) => void;
  onEdit: (tx: Transaction) => void;
  onPay: (event: TimelineEvent) => void;
}

function MonthCard({
  month,
  summary,
  currency,
  today,
  zoom,
  options,
  firstAhead,
  divider,
  rowProps,
}: {
  month: TimelineMonth;
  summary?: MonthSummary;
  currency: Currency;
  today: string;
  zoom: Zoom;
  options: BucketOptions;
  firstAhead: string | null;
  divider: ReactNode;
  rowProps: RowProps;
}) {
  const { t, locale } = useI18n();
  const net = summary?.net ?? month.net;
  const hasToday = month.days.some((d) => d.date === firstAhead);
  const highlights = zoom === "month" ? monthHighlights(month, options) : null;
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--edge-soft)] px-4 py-2.5">
        <h2 className="text-sm font-semibold">
          {monthLabel(month.month, locale)}{" "}
          <span className="font-normal text-zinc-400">{t("timeline.inMonth", { count: month.days.reduce((n, d) => n + d.count, 0) })}</span>
        </h2>
        <span className="text-xs tabular-nums text-zinc-500">
          <span className="text-green-600">{formatSigned(summary?.income ?? 0, currency, locale, "in")}</span>
          {" − "}
          <span className="text-red-600">{formatSigned(summary?.expense ?? 0, currency, locale, "none")}</span>
          {" = "}
          <span className={`font-semibold ${net >= 0 ? "text-green-600" : "text-red-600"}`}>
            {formatSigned(net, currency, locale, net > 0 ? "in" : "auto")}
          </span>
          {summary?.avgNet != null && month.month <= today.slice(0, 7) ? (
            <span className="ml-2 text-zinc-400">· {t("timeline.avg", { amount: formatSigned(summary.avgNet, currency, locale) })}</span>
          ) : null}
        </span>
      </div>
      {highlights ? (
        <div className="grid gap-3 px-4 py-3 text-sm sm:grid-cols-3">
          <HighlightList title={t("timeline.biggest")} events={highlights.outflows} rowProps={rowProps} />
          <HighlightList title={t("timeline.statements")} events={highlights.statements} rowProps={rowProps} />
          <HighlightList title={t("timeline.milestones")} events={highlights.markers} rowProps={rowProps} />
          {hasToday ? <ul className="sm:col-span-3">{divider}</ul> : null}
        </div>
      ) : (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {month.days.map((day) => (
            <Fragment key={day.date}>
              {day.date === firstAhead ? divider : null}
              <DayRows day={day} today={today} currency={currency} rowProps={rowProps} />
            </Fragment>
          ))}
        </ul>
      )}
    </Card>
  );
}

function HighlightList({ title, events, rowProps }: { title: string; events: TimelineEvent[]; rowProps: RowProps }) {
  const { locale } = useI18n();
  const text = useMilestoneText();
  if (events.length === 0) return null;
  return (
    <div>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">{title}</h3>
      <ul className="space-y-1">
        {events.map((e) => {
          const name =
            e.kind === "milestone"
              ? text(e).title
              : e.kind === "statement"
                ? (rowProps.lookup.accountsById.get(e.cardId ?? "")?.name ?? "—")
                : e.tx
                  ? (describeTx(e.tx, rowProps.lookup, () => "—")?.title ?? "—")
                  : "—";
          return (
            <li key={e.key} className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate">
                {name} <span className="text-xs text-zinc-400">· {shortDay(e.date, locale)}</span>
              </span>
              {e.kind !== "milestone" && e.currency ? (
                <span className="shrink-0 tabular-nums text-red-600">{formatSigned(e.amount, e.currency, locale, "out")}</span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function DayRows({ day, today, currency, rowProps }: { day: TimelineMonth["days"][number]; today: string; currency: Currency; rowProps: RowProps }) {
  const { t, locale } = useI18n();
  const label = dayLabel(day.date, today, locale, {
    today: t("common.today"),
    yesterday: t("pocket.lists.yesterday"),
    tomorrow: t("pocket.lists.tomorrow"),
  });
  return (
    <>
      <li className="flex items-center justify-between bg-[var(--edge-soft)]/50 px-4 py-1 text-xs font-semibold text-zinc-500">
        <span>
          {label} · {day.count}
        </span>
        {Math.abs(day.net) >= 0.005 ? (
          <span className={`tabular-nums ${day.net < 0 ? "text-red-600" : "text-green-600"}`}>
            {formatSigned(day.net, currency, locale, day.net > 0 ? "in" : "auto")}
          </span>
        ) : null}
      </li>
      {day.events.map((e) => (
        <EventRow key={e.key} event={e} {...rowProps} />
      ))}
    </>
  );
}

function TodayDivider({
  divRef,
  today,
  overdue,
  rowProps,
}: {
  divRef: (el: HTMLLIElement | null) => void;
  today: string;
  overdue: TimelineEvent[];
  rowProps: RowProps;
}) {
  const { t, locale } = useI18n();
  const label = t("timeline.todayOn", { date: shortDay(today, locale) });
  return (
    <>
      <li
        ref={divRef}
        role="separator"
        aria-label={label}
        className="flex list-none items-center gap-2 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-300"
      >
        <span aria-hidden className="h-0.5 flex-1 rounded bg-teal-600 dark:bg-teal-400" />
        <span aria-hidden>{label}</span>
        <span aria-hidden className="h-0.5 flex-1 rounded bg-teal-600 dark:bg-teal-400" />
      </li>
      {overdue.length > 0 ? (
        <li className="list-none" data-overdue>
          <h3 className="px-4 pt-1 text-sm font-semibold text-red-600 dark:text-red-400">{t("timeline.overdue", { count: overdue.length })}</h3>
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {overdue.map((e) => (
              <EventRow key={e.key} event={e} {...rowProps} />
            ))}
          </ul>
        </li>
      ) : null}
    </>
  );
}

function EventRow({ event, ...props }: RowProps & { event: TimelineEvent }) {
  if (event.kind === "tx" && event.tx) return <TxEventRow event={event} tx={event.tx} {...props} />;
  if (event.kind === "statement") return <StatementRow event={event} {...props} />;
  if (event.kind === "milestone") return <MilestoneRow event={event} />;
  return null;
}

function AfterFigure({ value, currency }: { value: number | undefined; currency: Currency | undefined }) {
  const { t, locale } = useI18n();
  if (value == null || currency == null) return null;
  return (
    <span className="block text-[11px] font-normal text-zinc-400" title={t("timeline.balanceAfter")}>
      → {formatSigned(value, currency, locale)}
    </span>
  );
}

function TxEventRow({ event, tx, lookup, accountId, after, onComplete, onEdit }: RowProps & { event: TimelineEvent; tx: Transaction }) {
  const { t, locale } = useI18n();
  const dueLabel = useDueLabel();
  const d = describeTx(tx, lookup, t);
  if (!d) return null;
  const planned = tx.status === "planned";
  const scoped = accountId != null;
  // one account's view: the leg on it, signed; otherwise the row as the ledger shows it
  const leg = scoped ? event.legs.find((l) => l.accountId === accountId) : undefined;
  const shownCurrency = leg ? lookup.accountsById.get(leg.accountId)?.currency ?? d.account.currency : d.account.currency;
  const amount = leg ? Math.abs(leg.delta) : tx.amount;
  const sign = leg ? (leg.delta > 0 ? "in" : "out") : d.transfer ? "none" : tx.direction === "income" ? "in" : "out";
  const tone = sign === "none" ? "text-zinc-500" : sign === "in" ? "text-green-600" : "text-red-600";
  const late = event.status === "overdue" ? dueLabel(tx.dueDate, lookup.today) : null;
  const place = d.route ? `${d.route.from.name} → ${d.route.to.name}` : d.account.name;
  return (
    <li className={`flex items-center gap-3 px-4 py-2.5 ${tx.legacy ? "opacity-60" : ""}`} data-event={event.key}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">{d.title}</span>
          {d.transfer ? <Badge tone="sky">{t("tx.transfer")}</Badge> : null}
          {d.cardPayment ? <Badge tone="red">{t("tx.cardPayment")}</Badge> : null}
          {planned && !late ? <Badge tone="amber">{t("tx.planned")}</Badge> : null}
          {late ? <Badge tone="red">{late.text}</Badge> : null}
          {event.early ? <Badge tone="teal">{t("timeline.paidEarly")}</Badge> : null}
          {tx.legacy ? <Badge tone="zinc">{t("legacy.badge")}</Badge> : null}
          {tx.adjustment ? <Badge tone="violet">{t("adjust.badge")}</Badge> : null}
        </div>
        <div className="mt-0.5 truncate text-xs text-zinc-500">
          {[place, d.category && !d.transfer ? d.category.name : null, shortDay(tx.dueDate, locale)].filter(Boolean).join(" · ")}
        </div>
      </div>
      <div className={`shrink-0 text-right text-sm font-semibold tabular-nums ${tone}`}>
        {formatSigned(amount, shownCurrency, locale, sign)}
        {!leg && d.transfer && d.other && d.otherAccount && d.otherAccount.currency !== d.account.currency ? (
          <span className="block text-[11px] font-normal text-zinc-400">→ {formatSigned(d.other.amount, d.otherAccount.currency, locale, "none")}</span>
        ) : null}
        <AfterFigure value={after?.get(event.key)} currency={leg ? shownCurrency : undefined} />
      </div>
      <div className="flex shrink-0 gap-1">
        {planned && lookup.book.roleOf(tx) !== "charge" ? (
          <Button variant="primary" disabled={!lookup.ratesReady} onClick={() => onComplete(tx)}>
            {t("tx.complete")}
          </Button>
        ) : null}
        {!d.transfer && !d.cardPayment ? (
          <Button variant="ghost" aria-label={t("tx.editTitle")} title={t("tx.editTitle")} onClick={() => onEdit(tx)}>
            ✎
          </Button>
        ) : null}
      </div>
    </li>
  );
}

function StatementRow({ event, lookup, accountId, after, onPay }: RowProps & { event: TimelineEvent }) {
  const { t, locale } = useI18n();
  const dueLabel = useDueLabel();
  const [open, setOpen] = useState(false);
  const card = event.cardId ? lookup.accountsById.get(event.cardId) : undefined;
  if (!card) return null;
  const payer = event.legs[0] ? lookup.accountsById.get(event.legs[0].accountId) : undefined;
  const count = event.charges?.length ?? 0;
  const late = event.status === "overdue" ? dueLabel(event.date, lookup.today) : null;
  const soon = late != null || event.date <= addDays(lookup.today, 7);
  return (
    <li data-statement={card.id} data-event={event.key}>
      <div className="flex items-center gap-3 px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium">💳 {t("timeline.statementOf", { name: card.name })}</span>
            <Badge tone="zinc">{t("timeline.estimate")}</Badge>
            {late ? <Badge tone="red">{late.text}</Badge> : null}
            {event.legs[0]?.approx ? <Badge tone="sky">{t("timeline.approxRate")}</Badge> : null}
          </div>
          <div className="mt-0.5 text-xs text-zinc-500">
            {payer ? `${payer.name} · ` : `${t("timeline.noPayer")} · `}
            {shortDay(event.date, locale)}
            {" · "}
            <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="text-teal-600 hover:underline">
              {count === 1 ? t("timeline.chargesOne") : t("timeline.chargesMany", { count })} {open ? "▴" : "▾"}
            </button>
          </div>
        </div>
        <div className="shrink-0 text-right text-sm font-semibold tabular-nums text-red-600">
          {formatSigned(event.amount, card.currency, locale, "out")}
          {event.legs[0]?.approx && payer ? (
            <span className="block text-[11px] font-normal text-zinc-400">≈ {formatSigned(event.legs[0].delta, payer.currency, locale)}</span>
          ) : null}
          <AfterFigure value={accountId ? after?.get(event.key) : undefined} currency={payer?.currency} />
        </div>
        {soon ? (
          <Button variant="primary" aria-label={t("timeline.payCard", { name: card.name })} onClick={() => onPay(event)}>
            {t("timeline.pay")}
          </Button>
        ) : null}
      </div>
      {open ? (
        <ul className="border-t border-[var(--edge-soft)] bg-[var(--edge-soft)]/40 px-4 py-1 pl-10 text-xs">
          {(event.charges ?? []).map((c) => (
            <li key={c.id} className="flex justify-between gap-3 py-1">
              <span className="truncate text-zinc-600 dark:text-zinc-300">
                {c.description || "—"} <span className="text-zinc-400">· {shortDay(c.dueDate, locale)}</span>
              </span>
              <span className="shrink-0 tabular-nums">{formatSigned(c.amount, card.currency, locale, c.direction === "income" ? "in" : "none")}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function MilestoneRow({ event }: { event: TimelineEvent }) {
  const { locale } = useI18n();
  const text = useMilestoneText();
  const { title, frees } = text(event);
  return (
    <li data-milestone={event.key}>
      <Link href={milestoneHref(event.milestone!)} className="flex items-center gap-3 px-4 py-2.5 hover:bg-[var(--edge-soft)]">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-300">
          <FlagGlyph />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{title}</span>
          <span className="block truncate text-xs text-zinc-500">
            {shortDay(event.date, locale)}
            {event.date.slice(0, 4) !== new Date().getFullYear().toString() ? ` ${event.date.slice(0, 4)}` : ""}
            {frees ? (
              <>
                {" · "}
                <span className="text-teal-700 dark:text-teal-300">{frees}</span>
              </>
            ) : null}
          </span>
        </span>
      </Link>
    </li>
  );
}
