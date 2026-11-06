"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { Badge, EmptyState, Spinner } from "@/components/ui";
import { useTxLookup } from "@/components/pocket/dayList";
import { useApp } from "@/lib/data/provider";
import { useAccounts, useRates } from "@/lib/data/queries";
import { Currency, CURRENCIES, formatAmount } from "@/lib/domain/currencies";
import { dailyBalances, monthlyFlow, paymentRunway, RunwayRow } from "@/lib/domain/cashFlow";
import { addMonthsClamped } from "@/lib/domain/recurrence";
import { TimelineEvent } from "@/lib/domain/timeline";
import { FLOW_VIEW_KEY, usePinnedChoice } from "@/lib/prefs";
import { useFormatDate } from "@/lib/useFormatDate";
import { useI18n } from "@/lib/i18n";
import { useTimeline } from "@/lib/useTimeline";

const FlowChart = dynamic(() => import("@/components/flowChart"), { ssr: false, loading: () => <Spinner /> });

/**
 * The Plan's cash-flow card: what still has to move, and whether the account
 * paying each bill will hold enough on the day it leaves.
 *
 * The forecast table answers "what will I have at the end of the month". It
 * cannot answer "can I cover the 16th", and on these cards the 16th is where
 * three statements and a loan instalment land within hours of each other. So
 * this card is day-level, and it is the card statements the timeline already
 * projects (lib/domain/timeline.ts statementEvents) — expected ones
 * included, on each card's own payment day, charged to the account that pays
 * it — rather than a second guess at the same thing.
 *
 * Three views of the one walk (lib/domain/cashFlow.ts), picked here and
 * pinnable as the card's default:
 *   runway  — a row per movement, with the balance it leaves behind
 *   chart   — the accounts of one currency, day by day, and their total
 *   months  — in, out, net and the closing balance, a month a line
 */

const VIEWS = ["runway", "chart", "months"] as const;
type FlowView = (typeof VIEWS)[number];

/** How far the card looks. The ledger is laid out a year ahead. */
const HORIZON_MONTHS = [3, 6, 12] as const;
type HorizonMonths = (typeof HORIZON_MONTHS)[number];

const isExpected = (e: TimelineEvent) => e.kind === "expected";

/**
 * Rows the runway shows before asking. A year of bills is a few hundred
 * movements, and on a phone every one of them stacks into six lines — so
 * the table has to stop somewhere and offer the rest rather than run on for
 * twenty thousand pixels.
 */
const FIRST_ROWS = 25;

export function ForecastFlow() {
  const { t } = useI18n();
  const { displayCurrency } = useApp();
  const accounts = useAccounts();
  const rates = useRates();
  const lookup = useTxLookup();
  const [months, setMonths] = useState<HorizonMonths>(6);
  const [countExpected, setCountExpected] = useState(false);
  const view = usePinnedChoice<FlowView>(FLOW_VIEW_KEY, VIEWS, "runway");
  const timeline = useTimeline(lookup.book, countExpected);
  const { today } = timeline;
  // never past the timeline's own horizon: beyond it there are no events to walk
  const to = useMemo(() => {
    const wanted = addMonthsClamped(today, months);
    return wanted < timeline.horizon ? wanted : timeline.horizon;
  }, [today, months, timeline.horizon]);

  const counts = countExpected ? isExpected : undefined;
  const accountList = accounts.data ?? [];

  if (timeline.loading || !rates.data) return <Spinner />;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <select
            aria-label={t("flow.view")}
            value={view.value}
            onChange={(e) => view.setValue(e.target.value as FlowView)}
            data-flow-view
            className="rounded-lg border border-[var(--edge)] bg-transparent px-2 py-1 text-sm"
          >
            {VIEWS.map((v) => (
              <option key={v} value={v}>
                {t(`flow.view_${v}`)}
              </option>
            ))}
          </select>
          {/* the same bargain the screens strike: picking applies now, the
              star decides what the card opens on */}
          <button
            type="button"
            aria-pressed={view.isDefault}
            aria-label={view.isDefault ? t("views.unsetDefault") : t("views.setDefault")}
            title={view.isDefault ? t("views.unsetDefault") : t("views.setDefaultHint")}
            onClick={() => (view.isDefault ? view.clearDefault() : view.setDefault())}
            data-flow-default={view.isDefault ? "on" : "off"}
            className={`rounded-lg border px-2 py-1 text-sm transition-colors ${
              view.isDefault
                ? "border-teal-600 bg-teal-600 text-white dark:border-teal-500 dark:bg-teal-500 dark:text-zinc-950"
                : "border-[var(--edge)] text-zinc-500 hover:bg-[var(--edge-soft)]"
            }`}
          >
            <span aria-hidden>{view.isDefault ? "★" : "☆"}</span>
          </button>
        </div>
        <div role="group" aria-label={t("flow.horizon")} className="flex rounded-lg border border-[var(--edge)] p-0.5">
          {HORIZON_MONTHS.map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={months === n}
              onClick={() => setMonths(n)}
              className={`rounded-md px-2 py-1 text-xs tnum transition-colors ${
                months === n
                  ? "bg-teal-600 text-white dark:bg-teal-500 dark:text-zinc-950"
                  : "text-zinc-500 hover:bg-[var(--edge-soft)]"
              }`}
            >
              {t("cards.matrixMonths", { count: n })}
            </button>
          ))}
        </div>
      </div>

      {view.value === "runway" ? (
        <RunwayTable timeline={timeline} to={to} accounts={accountList} counts={counts} />
      ) : view.value === "chart" ? (
        <ChartView timeline={timeline} to={to} />
      ) : (
        <MonthsTable timeline={timeline} months={months} counts={counts} display={displayCurrency} usdPer={rates.data.usdPer} />
      )}

      <label className="flex w-fit items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
        <input
          type="checkbox"
          role="switch"
          checked={countExpected}
          onChange={(e) => setCountExpected(e.target.checked)}
          className="h-4 w-4 accent-teal-600"
          data-flow-expected
        />
        {t("timeline.countExpected")}
      </label>
      <p className="text-xs text-zinc-500">{t("flow.hint")}</p>
    </div>
  );
}

type Timeline = ReturnType<typeof useTimeline>;

/** A row per movement, with what the account holds going in and coming out. */
function RunwayTable({
  timeline,
  to,
  accounts,
  counts,
}: {
  timeline: Timeline;
  to: string;
  accounts: Parameters<typeof paymentRunway>[0]["accounts"];
  counts?: (e: TimelineEvent) => boolean;
}) {
  const { t, locale } = useI18n();
  const fmtDate = useFormatDate();
  const [only, setOnly] = useState<string>("");
  const [showAll, setShowAll] = useState(false);
  const runway = useMemo(
    () =>
      paymentRunway({
        events: timeline.events,
        series: timeline.series,
        accounts,
        today: timeline.today,
        to,
        counts,
        accountId: only || null,
      }),
    [timeline.events, timeline.series, accounts, timeline.today, to, counts, only]
  );
  const cash = [...timeline.series.values()].map((s) => s.account);
  const shown = showAll ? runway.rows : runway.rows.slice(0, FIRST_ROWS);
  const hidden = runway.rows.length - shown.length;

  if (runway.rows.length === 0) return <EmptyState>{t("flow.empty")}</EmptyState>;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label={t("flow.account")}
          value={only}
          onChange={(e) => setOnly(e.target.value)}
          className="rounded-lg border border-[var(--edge)] bg-transparent px-2 py-1 text-xs"
        >
          <option value="">{t("flow.allAccounts")}</option>
          {cash.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        {runway.firstShort ? (
          <Badge tone="amber">{t("flow.shortOn", { date: fmtDate(runway.firstShort) })}</Badge>
        ) : (
          <Badge tone="green">{t("flow.covered")}</Badge>
        )}
      </div>
      {runway.lows.length > 0 ? (
        <p className="text-xs text-zinc-500">
          {runway.lows.slice(0, 3).map((l) => (
            <span key={l.account.id} className="mr-3 inline-block">
              {t("flow.low", {
                account: l.account.name,
                amount: formatAmount(l.balance, l.account.currency, locale),
                date: fmtDate(l.date),
              })}
            </span>
          ))}
        </p>
      ) : null}
      {/* the card is half the canvas in the two-column layout and the whole
          of it in the others, so the column that matters least gives way
          first rather than the balance the row exists for */}
      <div className="@container overflow-x-auto">
        {/* a table rather than stacked rows on a phone: six stacked lines a
            movement turns a year of bills into a scroll nobody reads, where
            four narrow columns stay legible at 390px */}
        <table className="w-full text-sm" data-flow-runway>
          <thead>
            <tr className="border-b border-[var(--edge)] text-left text-xs text-zinc-500">
              <th className="px-1 py-2 font-medium sm:px-2">{t("common.date")}</th>
              <th className="px-1 py-2 font-medium sm:px-2">{t("flow.due")}</th>
              <th className="hidden px-2 py-2 font-medium @lg:table-cell">{t("flow.from")}</th>
              <th className="px-1 py-2 text-right font-medium sm:px-2">{t("common.amount")}</th>
              <th className="hidden px-2 py-2 text-right font-medium @2xl:table-cell">{t("flow.before")}</th>
              <th className="px-1 py-2 text-right font-medium sm:px-2">{t("flow.after")}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <Row key={row.key} row={row} />
            ))}
          </tbody>
        </table>
      </div>
      {hidden > 0 ? (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          data-flow-show-all
          className="w-full rounded-lg border border-[var(--edge)] px-2 py-2 text-xs text-zinc-600 hover:bg-[var(--edge-soft)] dark:text-zinc-300"
        >
          {t("flow.showMore", { count: hidden })}
        </button>
      ) : null}
    </div>
  );
}

function Row({ row }: { row: RunwayRow }) {
  const { t, locale } = useI18n();
  const fmtDate = useFormatDate();
  const money = (n: number) => formatAmount(n, row.account.currency, locale);
  return (
    <tr className={`border-b border-[var(--edge-soft)] ${row.short ? "bg-red-50/60 dark:bg-red-950/20" : ""}`} data-flow-row={row.date}>
      <td className="whitespace-nowrap px-1 py-1.5 text-xs tnum text-zinc-500 sm:px-2 sm:text-sm">{fmtDate(row.date)}</td>
      <td className="px-1 py-1.5 sm:px-2">
        <span className="block text-xs leading-tight sm:text-sm">
          {row.label}
          {row.kind === "statement" ? <span className="ml-1 text-[11px] text-zinc-400">{t("flow.statement")}</span> : null}
          {row.approx ? <span className="ml-1 text-[11px] text-zinc-400">≈</span> : null}
        </span>
        {/* the account has no column of its own until there's room for one */}
        <span className="block text-[11px] text-zinc-400 @lg:hidden">{row.account.name}</span>
      </td>
      <td className="hidden px-2 py-1.5 text-xs text-zinc-500 @lg:table-cell">{row.account.name}</td>
      <td className={`whitespace-nowrap px-1 py-1.5 text-right text-xs tnum sm:px-2 sm:text-sm ${row.delta < 0 ? "" : "text-emerald-600"}`}>
        {row.delta < 0 ? "−" : "+"}
        {money(Math.abs(row.delta))}
      </td>
      <td className="hidden px-2 py-1.5 text-right tnum text-zinc-400 @2xl:table-cell">{money(row.before)}</td>
      <td
        className={`whitespace-nowrap px-1 py-1.5 text-right text-xs font-medium tnum sm:px-2 sm:text-sm ${row.short ? "text-red-600" : ""}`}
      >
        {money(row.after)}
      </td>
    </tr>
  );
}

/** The cash accounts of one currency, day by day. Currencies are never mixed. */
function ChartView({ timeline, to }: { timeline: Timeline; to: string }) {
  const { t, locale } = useI18n();
  const fmtDate = useFormatDate();
  // only what the chart can actually draw: cash in a currency, never a
  // crypto or gold holding, whose "balance" is a quantity and not money
  const cash = [...timeline.series.values()].map((s) => s.account).filter((a) => a.kind === "fiat");
  const offered = CURRENCIES.filter((c) => cash.some((a) => a.currency === c));
  const [currency, setCurrency] = useState<Currency>(() => (offered.includes("TRY") ? "TRY" : (offered[0] ?? "TRY")));
  const daily = useMemo(
    () => dailyBalances({ series: timeline.series, currency, today: timeline.today, to }),
    [timeline.series, currency, timeline.today, to]
  );
  if (daily.lines.length === 0) return <EmptyState>{t("flow.empty")}</EmptyState>;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="group" aria-label={t("flow.currency")} className="flex rounded-lg border border-[var(--edge)] p-0.5">
          {offered.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={currency === c}
              onClick={() => setCurrency(c)}
              className={`rounded-md px-2 py-1 text-xs transition-colors ${
                currency === c
                  ? "bg-teal-600 text-white dark:bg-teal-500 dark:text-zinc-950"
                  : "text-zinc-500 hover:bg-[var(--edge-soft)]"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
        {daily.low ? (
          <span className="text-xs text-zinc-500">
            {t("flow.chartLow", { amount: formatAmount(daily.low.balance, currency, locale), date: fmtDate(daily.low.date) })}
          </span>
        ) : null}
      </div>
      <FlowChart daily={daily} currency={currency} label={t("flow.view_chart")} />
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
        {daily.lines.map((l) => (
          <li key={l.account.id}>{l.account.name}</li>
        ))}
      </ul>
    </div>
  );
}

/** In, out, net and the closing balance, a month a line. */
function MonthsTable({
  timeline,
  months,
  counts,
  display,
  usdPer,
}: {
  timeline: Timeline;
  months: number;
  counts?: (e: TimelineEvent) => boolean;
  display: Currency;
  usdPer: Parameters<typeof monthlyFlow>[0]["usdPer"];
}) {
  const { t, locale } = useI18n();
  const rows = useMemo(
    () => monthlyFlow({ events: timeline.events, series: timeline.series, today: timeline.today, months, usdPer, display, counts }),
    [timeline.events, timeline.series, timeline.today, months, usdPer, display, counts]
  );
  const label = (month: string) =>
    new Date(`${month}-01T00:00:00`).toLocaleDateString(locale === "tr" ? "tr-TR" : "en-GB", { month: "long", year: "numeric" });
  const money = (n: number) => formatAmount(n, display, locale);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" data-flow-months>
        <thead>
          <tr className="border-b border-[var(--edge)] text-left text-xs text-zinc-500">
            <th className="px-1 py-2 font-medium sm:px-2">{t("flow.month")}</th>
            <th className="px-2 py-2 text-right font-medium">{t("dashboard.income")}</th>
            <th className="px-2 py-2 text-right font-medium">{t("dashboard.expense")}</th>
            <th className="px-2 py-2 text-right font-medium">{t("dashboard.monthNet")}</th>
            <th className="px-2 py-2 text-right font-medium">{t("flow.end")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.month} className="border-b border-[var(--edge-soft)]" data-flow-month={m.month}>
              <th scope="row" className="px-1 py-1.5 text-left text-xs font-medium capitalize sm:px-2 sm:text-sm">
                {label(m.month)}
              </th>
              <td className="whitespace-nowrap px-1 py-1.5 text-right text-xs tnum text-emerald-600 sm:px-2 sm:text-sm">
                {m.income > 0.005 ? `+${money(m.income)}` : "—"}
              </td>
              <td className="whitespace-nowrap px-1 py-1.5 text-right text-xs tnum sm:px-2 sm:text-sm">
                {m.expense > 0.005 ? `−${money(m.expense)}` : "—"}
              </td>
              <td className={`whitespace-nowrap px-1 py-1.5 text-right text-xs tnum sm:px-2 sm:text-sm ${m.net < 0 ? "text-red-600" : ""}`}>
                {money(m.net)}
              </td>
              <td
                className={`whitespace-nowrap px-1 py-1.5 text-right text-xs font-medium tnum sm:px-2 sm:text-sm ${m.endBalance < 0 ? "text-red-600" : ""}`}
              >
                {money(m.endBalance)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
