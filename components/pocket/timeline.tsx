"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { Fragment, ReactNode, useEffect, useId, useMemo, useState } from "react";
import { CardPaymentModal } from "@/components/cardPaymentModal";
import { EmptyState } from "@/components/ui";
import { Account } from "@/lib/data/types";
import { Currency } from "@/lib/domain/currencies";
import { addDays } from "@/lib/domain/recurrence";
import { TimelineEvent } from "@/lib/domain/timeline";
import { useI18n } from "@/lib/i18n";
import { dayLabel } from "@/lib/ui/pocket/dates";
import { monthLabel } from "@/lib/ui/pocket/dayGroups";
import { formatSigned } from "@/lib/ui/pocket/format";
import { AMOUNT_SLOT } from "@/lib/ui/pocket/homeSections";
import { POCKET_KEYS, usePocketFlag } from "@/lib/ui/pocket/prefs";
import { replaceQuery } from "@/lib/ui/shallowUrl";
import {
  bucketTimeline,
  BucketOptions,
  filterTimeline,
  lowestRows,
  milestoneHref,
  MonthSummary,
  monthSummaries,
  shortDay,
  TIMELINE_KEYS,
  TIMELINE_PAGE_MONTHS,
  TimelineDay,
  timelineWindow,
} from "@/lib/ui/timeline";
import { LOOKAHEAD_MONTHS, useTimeline } from "@/lib/useTimeline";
import { AccountSheet, RowsSkeleton } from "./activityFilters";
import { PocketTxRow, TxLookup, useDueLabel, useTxLookup } from "./dayList";
import { Icon } from "./icons";
import { Avatar, Chip, ChipRow, Money, Section } from "./kit";
import { AmountPhrase } from "./paceBar";
import { FlagGlyph, useMilestoneText } from "@/components/timelineParts";
import { usePocketTxSheet } from "./txActions";

const TimelineChart = dynamic(() => import("@/components/timelineChart"), {
  ssr: false,
  loading: () => <div aria-hidden className="h-28 animate-pulse rounded-lg bg-[var(--edge-soft)]" />,
});

/**
 * Pocket's Timeline (/transactions?tab=timeline): what happened and what is
 * planned on one axis, earliest at the top, from lib/domain/timeline.ts.
 *
 * 1. "Lowest point ahead": one line per cash account with anything planned
 *    in the next three months, its lowest balance and when, in red when it
 *    goes below zero. A line picks that account.
 * 2. Chips: the account (AccountSheet), Milestones, Imported history; the
 *    last two are kept on the device (lib/ui/timeline.ts TIMELINE_KEYS).
 *    With an account picked: its balance as a chart, and each day's closing
 *    balance in place of the day's net.
 * 3. The stream: month headings with in, out and net (and, up to this month,
 *    the six-month average), day headings, then rows: ledger rows as the
 *    Activity list draws them (the same action sheet and ✓), card statements
 *    with their charges and Pay, and milestones. A Today divider
 *    (role=separator) sits between the past and the rest, with the overdue
 *    rows pinned under it. A pill floats above the tab bar while the divider
 *    is off screen and brings it back.
 * 4. It opens with last month and the next three; "Show earlier months" and
 *    "Show later months" add three at a time.
 *
 * Every figure goes through Money (data-amount), so Hide amounts blurs it,
 * and the chart drops its axis figures.
 */
export function PocketTimeline({ accountParam }: { accountParam: string | null }) {
  const { t } = useI18n();
  const lookup = useTxLookup();
  const timeline = useTimeline(lookup.book);
  const sheet = usePocketTxSheet();
  const [hideAmounts] = usePocketFlag(POCKET_KEYS.hideAmounts);
  const [milestones, setMilestones] = usePocketFlag(TIMELINE_KEYS.milestones, true);
  const [legacy, setLegacy] = usePocketFlag(TIMELINE_KEYS.legacy);
  const [accountId, setAccountId] = useState<string | null>(accountParam);
  const [accountsOpen, setAccountsOpen] = useState(false);
  const [past, setPast] = useState(1);
  const [ahead, setAhead] = useState(TIMELINE_PAGE_MONTHS);
  const [paying, setPaying] = useState<TimelineEvent | null>(null);
  const [dividerEl, setDividerEl] = useState<HTMLDivElement | null>(null);

  const { accountsById, usdPer, display } = lookup;
  const { events, series, today, horizon, lookahead } = timeline;
  // a link to an account that isn't there (or a card) shows every account
  const picked = accountId ? accountsById.get(accountId) : undefined;
  const account = picked && picked.kind !== "credit_card" ? picked : undefined;
  const accountSeries = account ? (series.get(account.id) ?? null) : null;

  const pick = (id: string | null) => {
    setAccountId(id);
    replaceQuery(id ? `/transactions?tab=timeline&account=${encodeURIComponent(id)}` : "/transactions?tab=timeline");
  };

  const options: BucketOptions = useMemo(
    () => ({ accountsById, usdPer, display, accountId: account?.id ?? null, series: accountSeries }),
    [accountsById, usdPer, display, account, accountSeries]
  );
  // the list reaches the horizon, or the last milestone when one is further
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
    };
  }, [events, account, milestones, legacy, span.from, span.to, options, today]);

  const lows = useMemo(() => {
    const rows = lowestRows(series, today, lookahead);
    return account ? rows.filter((r) => r.account.id === account.id) : rows;
  }, [series, today, lookahead, account]);
  const overdueCount = (id: string) => view.overdue.filter((e) => e.legs.some((l) => l.accountId === id)).length;

  // the jump pill: which way the divider is while it's off screen. Read on
  // scroll rather than by an IntersectionObserver, which says nothing when a
  // jump to the end of the page carries the divider from below to above.
  const [offscreen, setOffscreen] = useState<"up" | "down" | null>(null);
  useEffect(() => {
    const el = dividerEl;
    if (!el) return;
    let frame = 0;
    const read = () => {
      frame = 0;
      const box = el.getBoundingClientRect();
      const top = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--pocket-top")) || 44;
      setOffscreen(box.bottom < top ? "up" : box.top > window.innerHeight ? "down" : null);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    schedule();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [dividerEl]);

  const jump = () => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    dividerEl?.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
  };

  if (lookup.loading || timeline.loading) return <RowsSkeleton />;

  const currency: Currency = account?.currency ?? display;
  // the divider goes before the first day from today on, else at the end
  const firstAhead = view.months.flatMap((m) => m.days).find((d) => d.date >= today)?.date ?? null;
  const divider = (
    <TodayDivider
      key="today"
      ref={setDividerEl}
      today={today}
      overdue={view.overdue}
      lookup={lookup}
      accountScoped={account != null}
      onRowTap={sheet.open}
      onComplete={sheet.complete}
      onPay={setPaying}
    />
  );

  return (
    <div className="space-y-4" data-timeline>
      <LowestCard
        rows={lows}
        months={LOOKAHEAD_MONTHS}
        onPick={(id) => pick(id)}
        overdueCount={overdueCount}
        picked={account != null}
      />

      <ChipRow label={t("timeline.filters")}>
        <button
          type="button"
          onClick={() => setAccountsOpen(true)}
          aria-haspopup="dialog"
          className={`relative flex h-8 shrink-0 items-center gap-1 whitespace-nowrap rounded-[var(--pocket-chip-radius,9999px)] border px-3 text-[13px] font-medium before:absolute before:-inset-y-1.5 before:inset-x-0 before:content-[''] ${
            account
              ? "border-transparent bg-teal-600 text-white dark:bg-teal-500 dark:text-zinc-950"
              : "border-[var(--edge)] bg-[var(--surface)] text-zinc-600 dark:text-zinc-300"
          }`}
        >
          {t("timeline.account", { name: account?.name ?? t("timeline.allAccounts") })}
        </button>
        <Chip active={milestones} onClick={() => setMilestones(!milestones)}>
          {t("timeline.milestones")}
        </Chip>
        <Chip active={legacy} onClick={() => setLegacy(!legacy)}>
          {t("timeline.history")}
        </Chip>
      </ChipRow>

      {account && accountSeries ? (
        <Section title={account.name}>
          <TimelineChart
            points={accountSeries.points}
            today={today}
            from={span.from}
            to={span.to}
            currency={account.currency}
            height={112}
            hideTicks={hideAmounts}
            label={t("timeline.balanceChart", { name: account.name })}
          />
        </Section>
      ) : null}

      {view.earlier ? <More onClick={() => setPast((p) => p + TIMELINE_PAGE_MONTHS)}>{t("timeline.showEarlier")}</More> : null}

      {view.months.length === 0 && view.overdue.length === 0 ? (
        <>
          {divider}
          <EmptyState>{t("timeline.empty")}</EmptyState>
        </>
      ) : (
        <div className="space-y-2">
          {view.months.map((month) => (
            <div key={month.month} className="space-y-3">
              <MonthHead summary={view.summaries.get(month.month)} month={month.month} currency={currency} today={today} />
              {month.days.map((day) => (
                  <Fragment key={day.date}>
                    {day.date === firstAhead ? divider : null}
                    <DaySection
                      day={day}
                      lookup={lookup}
                      currency={currency}
                      account={account}
                      onRowTap={sheet.open}
                      onComplete={sheet.complete}
                      onPay={setPaying}
                    />
                  </Fragment>
              ))}
            </div>
          ))}
          {/* nothing from today on in the window: the divider closes the list */}
          {firstAhead == null ? divider : null}
        </div>
      )}

      {span.to < end ? <More onClick={() => setAhead((a) => a + TIMELINE_PAGE_MONTHS)}>{t("timeline.showLater")}</More> : null}

      {offscreen ? (
        <button
          type="button"
          onClick={jump}
          aria-label={t("pocket.timeline.jumpLabel")}
          data-jump-today
          style={{ bottom: "calc(var(--pocket-bottom, 56px) + 12px)" }}
          className="fixed left-1/2 z-20 flex h-11 -translate-x-1/2 items-center rounded-full bg-teal-600 px-4 text-sm font-semibold text-white shadow-lg active:bg-teal-700 dark:bg-teal-500 dark:text-zinc-950"
        >
          {offscreen === "up" ? t("pocket.timeline.jumpUp") : t("pocket.timeline.jumpDown")}
        </button>
      ) : null}

      {sheet.element}
      <AccountSheet
        open={accountsOpen}
        onClose={() => setAccountsOpen(false)}
        accounts={[...accountsById.values()]}
        value={account?.id ?? null}
        onChange={pick}
      />
      <CardPaymentModal
        card={paying?.cardId ? (accountsById.get(paying.cardId) ?? null) : null}
        suggested={paying?.amount ?? 0}
        covers={paying?.charges ?? []}
        onClose={() => setPaying(null)}
      />
    </div>
  );
}

function More({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[44px] w-full items-center justify-center rounded-[var(--ui-card-radius)] border border-[var(--edge)] bg-[var(--surface)] text-sm font-medium text-teal-700 active:bg-[var(--edge-soft)] dark:text-teal-300"
    >
      {children}
    </button>
  );
}

/* ---------------------------------------------------------- lowest ahead */

function LowestCard({
  rows,
  months,
  onPick,
  overdueCount,
  picked,
}: {
  rows: ReturnType<typeof lowestRows>;
  months: number;
  onPick: (id: string) => void;
  overdueCount: (accountId: string) => number;
  picked: boolean;
}) {
  const { t, locale } = useI18n();
  return (
    <Section title={t("timeline.lowestTitle")} flush>
      {rows.length === 0 ? (
        <p className="px-4 pb-3 text-sm text-zinc-500 dark:text-zinc-400">{t("timeline.nothingAhead", { months })}</p>
      ) : (
        <ul data-lowest className="divide-y divide-[var(--edge-soft)] border-t border-[var(--edge-soft)]">
          {rows.map(({ account, low }) => {
            const below = low.belowZeroOn != null;
            const late = overdueCount(account.id);
            const meta = [
              below ? t("timeline.belowZeroOn", { date: shortDay(low.belowZeroOn!, locale) }) : t("timeline.lowestOn", { date: shortDay(low.date, locale) }),
              late > 0 ? t("timeline.includesOverdue", { count: late }) : null,
            ]
              .filter(Boolean)
              .join(" · ");
            const body = (
              <>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium">{account.name}</span>
                  <span className={`block truncate text-xs ${below ? "text-red-600 dark:text-red-400" : "text-zinc-500 dark:text-zinc-400"}`}>
                    {meta}
                  </span>
                </span>
                <Money amount={low.balance} currency={account.currency} tone={low.balance < 0 ? "neg" : undefined} className="shrink-0 text-[15px] font-semibold" />
              </>
            );
            return (
              <li key={account.id}>
                {picked ? (
                  <div className="flex min-h-[var(--pocket-row,56px)] items-center gap-3 px-4 py-2">{body}</div>
                ) : (
                  <button
                    type="button"
                    onClick={() => onPick(account.id)}
                    className="flex min-h-[var(--pocket-row,56px)] w-full items-center gap-3 px-4 py-2 text-left active:bg-[var(--edge-soft)]"
                  >
                    {body}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="border-t border-[var(--edge-soft)] px-4 py-2 text-xs text-zinc-500 dark:text-zinc-400">
        {t("timeline.lowestHint", { months })}
      </p>
    </Section>
  );
}

/* --------------------------------------------------------------- stream */

/** "October 2026" and its net; under it, in and out, and the six-month average up to this month. */
function MonthHead({ summary, month, currency, today }: { summary?: MonthSummary; month: string; currency: Currency; today: string }) {
  const { t, locale } = useI18n();
  const net = summary?.net ?? 0;
  return (
    <div className="pt-1">
      <div className="flex min-h-10 items-center justify-between gap-3">
        <h2 className="min-w-0 truncate text-[15px] font-bold">{monthLabel(month, locale)}</h2>
        {Math.abs(net) >= 0.005 ? (
          <Money amount={net} currency={currency} sign={net > 0 ? "in" : "auto"} tone="auto" className="text-sm font-semibold" />
        ) : null}
      </div>
      {summary && (summary.income > 0 || summary.expense > 0) ? (
        <p className="flex flex-wrap gap-x-3 text-xs text-zinc-500 dark:text-zinc-400">
          <span>
            {t("timeline.inLabel")} <Money amount={summary.income} currency={currency} sign="in" />
          </span>
          <span>
            {t("timeline.outLabel")} <Money amount={summary.expense} currency={currency} sign="out" />
          </span>
          {summary.avgNet != null && month <= today.slice(0, 7) ? (
            <span>
              <AmountPhrase text={t("timeline.avg", { amount: AMOUNT_SLOT })} amount={formatSigned(summary.avgNet, currency, locale)} />
            </span>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

const TodayDivider = function TodayDivider({
  ref,
  today,
  overdue,
  lookup,
  accountScoped,
  onRowTap,
  onComplete,
  onPay,
}: {
  ref: (el: HTMLDivElement | null) => void;
  today: string;
  overdue: TimelineEvent[];
  lookup: TxLookup;
  accountScoped: boolean;
  onRowTap: (tx: NonNullable<TimelineEvent["tx"]>) => void;
  onComplete: (tx: NonNullable<TimelineEvent["tx"]>) => void;
  onPay: (event: TimelineEvent) => void;
}) {
  const { t, locale } = useI18n();
  const headId = useId();
  return (
    <div className="space-y-3 py-1">
      <div
        ref={ref}
        role="separator"
        aria-label={t("timeline.todayOn", { date: shortDay(today, locale) })}
        className="flex scroll-mt-[calc(var(--pocket-top,44px)+0.5rem)] items-center gap-2 text-xs font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-300"
      >
        <span aria-hidden className="h-0.5 flex-1 rounded bg-teal-600 dark:bg-teal-400" />
        <span aria-hidden>{t("timeline.todayOn", { date: shortDay(today, locale) })}</span>
        <span aria-hidden className="h-0.5 flex-1 rounded bg-teal-600 dark:bg-teal-400" />
      </div>
      {overdue.length > 0 ? (
        <section
          aria-labelledby={headId}
          data-overdue
          className="overflow-hidden rounded-[var(--ui-card-radius)] border border-[var(--edge)] bg-[var(--surface)]"
        >
          <h3 id={headId} className="flex min-h-10 items-center px-4 text-sm font-semibold text-red-600 dark:text-red-400">
            {t("timeline.overdue", { count: overdue.length })}
          </h3>
          <ul className="divide-y divide-[var(--edge-soft)] border-t border-[var(--edge-soft)]">
            {overdue.map((e) => (
              <EventRow
                key={e.key}
                event={e}
                lookup={lookup}
                accountScoped={accountScoped}
                due
                onRowTap={onRowTap}
                onComplete={onComplete}
                onPay={onPay}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
};

function DaySection({
  day,
  lookup,
  currency,
  account,
  onRowTap,
  onComplete,
  onPay,
}: {
  day: TimelineDay;
  lookup: TxLookup;
  currency: Currency;
  account: Account | undefined;
  onRowTap: (tx: NonNullable<TimelineEvent["tx"]>) => void;
  onComplete: (tx: NonNullable<TimelineEvent["tx"]>) => void;
  onPay: (event: TimelineEvent) => void;
}) {
  const { t, locale } = useI18n();
  const id = useId();
  const label = dayLabel(day.date, lookup.today, locale, {
    today: t("common.today"),
    yesterday: t("pocket.lists.yesterday"),
    tomorrow: t("pocket.lists.tomorrow"),
  });
  const entries = day.count === 1 ? t("pocket.lists.entriesOne") : t("pocket.lists.entriesMany", { count: day.count });
  return (
    <section aria-labelledby={id}>
      <div className="sticky top-[var(--pocket-top,44px)] z-10 -mx-4 flex h-8 items-center justify-between gap-3 bg-[var(--page)]/95 px-4 text-xs font-semibold text-zinc-500 backdrop-blur dark:text-zinc-400">
        <h3 id={id} className="min-w-0 truncate">
          {label}
          <span aria-hidden> · {day.count}</span>
          <span className="sr-only">, {entries}</span>
        </h3>
        {account && day.endBalance != null ? (
          <span className="flex shrink-0 items-center gap-1" title={t("timeline.balanceAfter")}>
            <span aria-hidden>→</span>
            <span className="sr-only">{t("timeline.balanceAfter")}</span>
            <Money amount={day.endBalance} currency={account.currency} />
          </span>
        ) : Math.abs(day.net) >= 0.005 ? (
          <Money amount={day.net} currency={currency} sign={day.net > 0 ? "in" : "auto"} tone="auto" />
        ) : null}
      </div>
      <ul className="divide-y divide-[var(--edge-soft)] overflow-hidden rounded-[var(--ui-card-radius)] border border-[var(--edge)] bg-[var(--surface)]">
        {day.events.map((e) => (
          <EventRow
            key={e.key}
            event={e}
            lookup={lookup}
            accountScoped={account != null}
            onRowTap={onRowTap}
            onComplete={onComplete}
            onPay={onPay}
          />
        ))}
      </ul>
    </section>
  );
}

function EventRow({
  event,
  lookup,
  accountScoped,
  due = false,
  onRowTap,
  onComplete,
  onPay,
}: {
  event: TimelineEvent;
  lookup: TxLookup;
  accountScoped: boolean;
  /** the overdue block: rows say how late they are */
  due?: boolean;
  onRowTap: (tx: NonNullable<TimelineEvent["tx"]>) => void;
  onComplete: (tx: NonNullable<TimelineEvent["tx"]>) => void;
  onPay: (event: TimelineEvent) => void;
}) {
  if (event.kind === "tx" && event.tx) {
    return <PocketTxRow tx={event.tx} lookup={lookup} onTap={onRowTap} onComplete={onComplete} accountScoped={accountScoped} due={due} />;
  }
  if (event.kind === "statement") return <StatementRow event={event} lookup={lookup} onPay={onPay} />;
  if (event.kind === "milestone") return <MilestoneRow event={event} />;
  return null;
}

const rowClass = "flex min-h-[var(--pocket-row-tx,60px)] min-w-0 flex-1 items-center gap-3 py-2 pl-4 text-left active:bg-[var(--edge-soft)]";

/** A card's statement: its charges fold out of the row; Pay when it's due within a week or late. */
function StatementRow({ event, lookup, onPay }: { event: TimelineEvent; lookup: TxLookup; onPay: (event: TimelineEvent) => void }) {
  const { t, locale } = useI18n();
  const dueLabel = useDueLabel();
  const [open, setOpen] = useState(false);
  const listId = useId();
  const card = event.cardId ? lookup.accountsById.get(event.cardId) : undefined;
  if (!card || event.currency == null) return null;
  const count = event.charges?.length ?? 0;
  const payer = event.legs[0] ? lookup.accountsById.get(event.legs[0].accountId) : undefined;
  const soon = event.status === "overdue" || event.date <= addDays(lookup.today, 7);
  const when = dueLabel(event.date, lookup.today);
  const meta = [
    event.status === "overdue" ? null : count === 1 ? t("timeline.chargesOne") : t("timeline.chargesMany", { count }),
    payer ? payer.name : t("timeline.noPayer"),
    // the bank's statement is the real figure; this adds up what's logged
    t("timeline.estimate"),
  ].filter(Boolean);
  return (
    <li data-statement={card.id}>
      <div className="flex items-center">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((o) => !o)}
          className={`${rowClass} ${soon ? "pr-1" : "pr-4"}`}
        >
          <span className="shrink-0">
            <Avatar label={card.name} icon={<Icon name="card" size={18} />} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-medium">{t("timeline.statementOf", { name: card.name })}</span>
            <span className="flex min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap text-xs text-zinc-500 dark:text-zinc-400">
              {event.status === "overdue" ? (
                <>
                  <span className="shrink-0 text-red-600 dark:text-red-400">{when.text}</span>
                  <span aria-hidden className="shrink-0">·</span>
                </>
              ) : null}
              <span className="min-w-0 truncate">{meta.join(" · ")}</span>
            </span>
          </span>
          <span className="shrink-0 text-right">
            <Money amount={event.amount} currency={card.currency} sign="out" tone="auto" className="block text-[15px] font-semibold" />
            {event.legs[0]?.approx && payer ? (
              <span data-amount className="block whitespace-nowrap text-[11px] tabular-nums text-zinc-400">
                ≈ {formatSigned(event.legs[0].delta, payer.currency, locale)}
              </span>
            ) : null}
          </span>
        </button>
        {soon ? (
          <span className="pr-1">
            <button
              type="button"
              onClick={() => onPay(event)}
              aria-haspopup="dialog"
              aria-label={t("timeline.payCard", { name: card.name })}
              className="flex h-11 min-w-11 items-center justify-center px-1"
            >
              <span className="flex h-8 items-center rounded-[var(--pocket-chip-radius,9999px)] bg-teal-600 px-3 text-[13px] font-semibold text-white active:bg-teal-700 dark:bg-teal-500 dark:text-zinc-950">
                {t("timeline.pay")}
              </span>
            </button>
          </span>
        ) : null}
      </div>
      {open ? (
        <ul id={listId} className="border-t border-[var(--edge-soft)] bg-[var(--edge-soft)]/40 py-1">
          {(event.charges ?? []).map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-1.5 pl-16 text-[13px]">
              <span className="min-w-0 truncate text-zinc-600 dark:text-zinc-300">
                {c.description || "—"} <span className="text-zinc-400">· {shortDay(c.dueDate, locale)}</span>
              </span>
              <Money amount={c.amount} currency={card.currency} sign={c.direction === "income" ? "in" : "none"} className="shrink-0" />
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function MilestoneRow({ event }: { event: TimelineEvent }) {
  const text = useMilestoneText();
  const { title, frees } = text(event);
  return (
    <li data-milestone={event.key}>
      <Link href={milestoneHref(event.milestone!)} className={`${rowClass} min-h-12 pr-2`}>
        <span className="shrink-0">
          <Avatar color="#0d9488" label="⚑" icon={<FlagGlyph />} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-medium">{title}</span>
          {frees ? <span className="block truncate text-xs text-teal-700 dark:text-teal-300">{frees}</span> : null}
        </span>
        <Icon name="chevron" size={18} className="shrink-0 text-zinc-400" />
      </Link>
    </li>
  );
}
