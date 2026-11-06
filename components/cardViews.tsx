"use client";

import { ReactNode, useMemo, useState } from "react";
import { Badge, Card, CardHeader, EmptyState } from "@/components/ui";
import { Account } from "@/lib/data/types";
import { CardBook } from "@/lib/domain/cards";
import { Currency, formatAmount } from "@/lib/domain/currencies";
import { UsdPerMap } from "@/lib/domain/fx";
import { addMonthKey } from "@/lib/domain/planner";
import { CalendarEntry, paymentCalendar, payoffRows, statementMatrix } from "@/lib/ui/cardViews";
import { Shape } from "@/lib/ui/views";
import { useFormatDate } from "@/lib/useFormatDate";
import { useI18n } from "@/lib/i18n";

/**
 * The Cards screen's three other views (lib/ui/cardViews.ts does the
 * arithmetic; nothing here derives a figure of its own).
 *
 * Each answers a question the card-at-a-time list cannot:
 *   StatementMatrixView — what do the months ahead look like, across cards
 *   PaymentCalendarView — what lands on which day of a month
 *   PayoffView          — which card am I closest to being rid of
 */

export interface CardViewProps {
  accounts: readonly Account[];
  book: CardBook;
  today: string;
  usdPer: UsdPerMap;
  display: Currency;
  /** open a card's details */
  onOpen?: (card: Account) => void;
  /** record a payment on a card */
  onPay?: (card: Account) => void;
}

/** How far the matrix looks: a year of taksit is the case it has to show. */
const MATRIX_MONTHS = [6, 12] as const;
type MatrixMonths = (typeof MATRIX_MONTHS)[number];

const useMonthLabel = () => {
  const { locale } = useI18n();
  return (month: string, long = false) =>
    new Date(`${month}-01T00:00:00`).toLocaleDateString(locale === "tr" ? "tr-TR" : "en-GB", {
      month: long ? "long" : "short",
      year: long ? "numeric" : "2-digit",
    });
};

function MonthStep({ month, onStep, onNow }: { month: string; onStep: (d: number) => void; onNow: () => void }) {
  const { t } = useI18n();
  const label = useMonthLabel();
  const arrow =
    "flex h-8 w-8 items-center justify-center rounded-full text-zinc-500 hover:bg-[var(--edge-soft)] hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100";
  return (
    <div className="flex items-center justify-between gap-2" data-month-step={month}>
      <button type="button" onClick={() => onStep(-1)} aria-label={t("dashboard.prevMonth")} className={arrow}>
        ‹
      </button>
      <button type="button" onClick={onNow} className="truncate text-sm font-semibold capitalize" aria-live="polite">
        {label(month, true)}
      </button>
      <button type="button" onClick={() => onStep(1)} aria-label={t("dashboard.nextMonth")} className={arrow}>
        ›
      </button>
    </div>
  );
}

/**
 * Every open card against the months ahead, one cell a statement.
 *
 * The totals are the point as much as the cells: the column total is what
 * leaves in that month across every card, which is the figure a month has to
 * be planned against, and the row total is what a card will have taken from
 * you by the end of the window.
 */
export function StatementMatrixView({ accounts, book, today, usdPer, display, onOpen }: CardViewProps) {
  const { t, locale } = useI18n();
  const label = useMonthLabel();
  const [months, setMonths] = useState<MatrixMonths>(6);
  const matrix = useMemo(
    () => statementMatrix({ accounts, book, today, usdPer, display, months }),
    [accounts, book, today, usdPer, display, months]
  );
  const money = (n: number, currency: Currency) => formatAmount(n, currency, locale);

  if (matrix.rows.length === 0) return <EmptyState>{t("cards.matrixEmpty")}</EmptyState>;

  return (
    <Card>
      <CardHeader
        title={t("views.shape_matrix")}
        action={
          <div role="group" aria-label={t("cards.matrixWindow")} className="flex rounded-lg border border-[var(--edge)] p-0.5">
            {MATRIX_MONTHS.map((n) => (
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
        }
      />
      <div className="overflow-x-auto">
        <table className="w-full text-sm" data-card-matrix>
          <thead>
            <tr className="border-b border-[var(--edge)] text-xs text-zinc-500">
              <th className="sticky left-0 bg-[var(--surface,transparent)] px-3 py-2 text-left font-medium">{t("cards.title")}</th>
              {matrix.months.map((m) => (
                <th key={m} className="px-3 py-2 text-right font-medium capitalize">
                  {label(m)}
                </th>
              ))}
              <th className="px-3 py-2 text-right font-medium">{t("cards.matrixRowTotal")}</th>
            </tr>
          </thead>
          <tbody>
            {matrix.rows.map((row) => (
              <tr key={row.account.id} className="border-b border-[var(--edge-soft)]" data-matrix-row={row.account.name}>
                <th scope="row" className="sticky left-0 bg-[var(--surface,transparent)] px-3 py-1.5 text-left font-medium">
                  <button type="button" className="hover:underline" onClick={() => onOpen?.(row.account)}>
                    {row.account.name}
                  </button>
                </th>
                {row.cells.map((cell) => (
                  <td
                    key={cell.month}
                    className={`px-3 py-1.5 text-right tnum ${cell.total > 0.005 ? "" : "text-zinc-300 dark:text-zinc-700"}`}
                  >
                    {cell.total > 0.005 ? money(cell.total, row.account.currency) : "·"}
                  </td>
                ))}
                <td className="px-3 py-1.5 text-right font-semibold tnum">{money(row.total, row.account.currency)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="text-sm font-semibold">
              <th scope="row" className="sticky left-0 bg-[var(--surface,transparent)] px-3 py-2 text-left">
                {t("cards.matrixColumnTotal")}
              </th>
              {matrix.columnTotals.map((total, i) => (
                <td key={matrix.months[i]} className="px-3 py-2 text-right tnum">
                  {formatAmount(total, display, locale)}
                </td>
              ))}
              <td className="px-3 py-2 text-right tnum">{formatAmount(matrix.grandTotal, display, locale)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="px-3 pb-3 text-xs text-zinc-500">{t("cards.matrixHint", { currency: display })}</p>
    </Card>
  );
}

const STATUS_KEY = {
  paid: "dashboard.statementPaid",
  planned: "dashboard.monthPlanned",
  expected: "dashboard.monthExpected",
} as const;

/**
 * One month, each card's statement on the day it falls due.
 *
 * Statements cluster: on these cards the 10th, the 15th and the 16th carry
 * nearly everything, and a list sorted by card never shows you that. The
 * grid does, which is what makes it possible to see a day you cannot cover
 * before it arrives.
 */
export function PaymentCalendarView({ accounts, book, today, usdPer, display, onOpen }: CardViewProps) {
  const { t, locale } = useI18n();
  const [offset, setOffset] = useState(0);
  const month = addMonthKey(today.slice(0, 7), offset);
  const cal = useMemo(
    () => paymentCalendar({ accounts, book, today, month, usdPer, display }),
    [accounts, book, today, month, usdPer, display]
  );
  const weekdays = useMemo(() => {
    // a Monday-first week, named in the reading language
    const base = Date.UTC(2024, 0, 1); // a Monday
    return Array.from({ length: 7 }, (_, i) =>
      new Date(base + i * 86_400_000).toLocaleDateString(locale === "tr" ? "tr-TR" : "en-GB", { weekday: "short" })
    );
  }, [locale]);
  const todayDay = today.slice(0, 7) === month ? Number(today.slice(8, 10)) : null;

  const cell = (entry: CalendarEntry) => (
    <button
      key={entry.account.id}
      type="button"
      onClick={() => onOpen?.(entry.account)}
      data-calendar-entry={entry.account.name}
      className="block w-full truncate rounded px-1 py-0.5 text-left text-[11px] hover:bg-[var(--edge-soft)]"
      title={`${entry.account.name} · ${t(STATUS_KEY[entry.status])}`}
    >
      <span className={`truncate ${entry.status === "paid" ? "text-zinc-400 line-through" : ""}`}>{entry.account.name}</span>
      <span className="block tnum font-medium">{formatAmount(entry.amount, entry.account.currency, locale)}</span>
    </button>
  );

  return (
    <Card>
      <CardHeader title={t("views.shape_calendar")} />
      <div className="space-y-3 p-3">
        <MonthStep month={month} onStep={(d) => setOffset(offset + d)} onNow={() => setOffset(0)} />
        <div className="grid grid-cols-3 gap-2 text-center text-xs">
          <Total label={t("dashboard.statementsTotal")} value={formatAmount(cal.totals.all, display, locale)} />
          <Total label={t("dashboard.statementsPaid")} value={formatAmount(cal.totals.paid, display, locale)} />
          <Total label={t("dashboard.statementsToPay")} value={formatAmount(cal.totals.toPay, display, locale)} />
        </div>
        {cal.totals.all <= 0.005 && cal.undated.length === 0 ? (
          <EmptyState>{t("dashboard.noStatementsMonth")}</EmptyState>
        ) : (
          <>
            <div className="grid grid-cols-7 gap-1 text-center text-[11px] uppercase tracking-wide text-zinc-400">
              {weekdays.map((w) => (
                <span key={w}>{w}</span>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1" data-card-calendar={month}>
              {Array.from({ length: cal.firstWeekday }, (_, i) => (
                <div key={`pad${i}`} aria-hidden />
              ))}
              {Array.from({ length: cal.daysInMonth }, (_, i) => i + 1).map((day) => {
                const entries = cal.byDay.get(day) ?? [];
                return (
                  <div
                    key={day}
                    data-calendar-day={day}
                    className={`min-h-16 rounded-lg border p-1 ${
                      day === todayDay ? "border-teal-500" : entries.length > 0 ? "border-[var(--edge)]" : "border-transparent"
                    }`}
                  >
                    <div className={`text-[11px] tnum ${day === todayDay ? "font-bold text-teal-600" : "text-zinc-400"}`}>{day}</div>
                    {entries.map(cell)}
                  </div>
                );
              })}
            </div>
          </>
        )}
        {cal.undated.length > 0 ? (
          <div className="space-y-1">
            <p className="text-xs text-zinc-500">{t("cards.calendarUndated")}</p>
            <div className="flex flex-wrap gap-2">{cal.undated.map(cell)}</div>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function Total({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="text-zinc-500">{label}</div>
      <div className="font-semibold tnum">{value}</div>
    </div>
  );
}

/**
 * The cards as a queue: the one clearing soonest first.
 *
 * What is owed is the whole remaining tail, installments included, because
 * that is what the bank holds against the limit — so the bar reads as the
 * room the card has left, not as this month's bill.
 */
export function PayoffView({ accounts, book, today, usdPer, display, onOpen, onPay }: CardViewProps) {
  const { t, locale } = useI18n();
  const fmtDate = useFormatDate();
  const label = useMonthLabel();
  const { rows, totals } = useMemo(
    () => payoffRows({ accounts, book, today, usdPer, display }),
    [accounts, book, today, usdPer, display]
  );
  if (rows.length === 0) return <EmptyState>{t("cards.payoffEmpty")}</EmptyState>;

  return (
    <Card>
      <CardHeader
        title={t("views.shape_payoff")}
        action={
          <span className="text-xs text-zinc-500">
            {t("cards.payoffTotals", {
              owed: formatAmount(totals.owed, display, locale),
              month: formatAmount(totals.nextMonth, display, locale),
            })}
          </span>
        }
      />
      <ul className="divide-y divide-[var(--edge-soft)]">
        {rows.map((row) => (
          <li key={row.account.id} className="space-y-2 p-3" data-payoff-row={row.account.name}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <button type="button" className="font-semibold hover:underline" onClick={() => onOpen?.(row.account)}>
                {row.account.name}
              </button>
              <span className="flex items-center gap-2">
                {row.idle ? <Badge tone="zinc">{t("cards.nothingOwed")}</Badge> : null}
                <span className="font-bold tnum">{formatAmount(row.owed, row.account.currency, locale)}</span>
              </span>
            </div>
            {row.idle ? null : (
              <>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
                  {/* the month name comes capitalised from the locale already;
                      a CSS capitalize here would shout every other word too */}
                  {row.clearsIn ? (
                    <span>{t("cards.payoffClears", { month: label(row.clearsIn, true), count: row.monthsLeft })}</span>
                  ) : null}
                  {row.next ? (
                    <span>
                      {t("cards.payoffNext", {
                        amount: formatAmount(row.next.total, row.account.currency, locale),
                        date: row.next.date ? fmtDate(row.next.date) : label(row.next.month),
                      })}
                    </span>
                  ) : null}
                  {row.perMonth > 0.005 ? (
                    <span>{t("cards.payoffPerMonth", { amount: formatAmount(row.perMonth, row.account.currency, locale) })}</span>
                  ) : null}
                </div>
                {row.limitUsed != null ? (
                  <div>
                    <div className="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                      <div
                        className={`h-full rounded-full ${row.limitUsed >= 1 ? "bg-red-600" : row.limitUsed >= 0.8 ? "bg-amber-500" : "bg-teal-600"}`}
                        style={{ width: `${Math.min(100, Math.round(row.limitUsed * 100))}%` }}
                      />
                    </div>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      {t("cards.payoffLimit", { pct: Math.round(row.limitUsed * 100) })}
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-zinc-400">{t("cards.payoffNoLimit")}</p>
                )}
              </>
            )}
            {onPay && !row.idle ? (
              <button
                type="button"
                onClick={() => onPay(row.account)}
                className="rounded-lg border border-[var(--edge)] px-2 py-1 text-xs text-zinc-600 hover:bg-[var(--edge-soft)] dark:text-zinc-300"
              >
                {t("cards.recordPayment")}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/**
 * Whichever of the three the screen is on. The Cards page asks for a shape,
 * not for a component, so adding a fourth view later touches this file only.
 */
export function CardsLens({ shape, ...props }: CardViewProps & { shape: Shape }) {
  if (shape === "matrix") return <StatementMatrixView {...props} />;
  if (shape === "calendar") return <PaymentCalendarView {...props} />;
  if (shape === "payoff") return <PayoffView {...props} />;
  return null;
}
