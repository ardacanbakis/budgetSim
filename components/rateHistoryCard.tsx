"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardHeader, Field, Input, Select, Skeleton } from "@/components/ui";
import { Icon } from "@/components/pocket/icons";
import { LiraDevaluationSection } from "@/components/liraDevaluation";
import { useRates } from "@/lib/data/queries";
import { convertUnits, formatRate, formatUnitAmount } from "@/lib/domain/converter";
import { parseTypedAmount } from "@/lib/domain/money";
import {
  convertOn,
  HISTORY_CURRENCIES,
  HISTORY_RANGES,
  HistoryCurrency,
  HistoryRange,
  isHistoryCurrency,
  pairSeries,
  RateHistory,
  RatesOn,
  summarize,
} from "@/lib/domain/rateHistory";
import { todayISO } from "@/lib/domain/recurrence";
import { useI18n } from "@/lib/i18n";
import { useFormatDate } from "@/lib/useFormatDate";

const tooltipStyle = {
  backgroundColor: "var(--viz-tooltip-bg)",
  border: "1px solid var(--viz-grid)",
  borderRadius: 8,
  fontSize: 12,
};

const segment = (on: boolean) =>
  `flex-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
    on ? "bg-teal-600 text-white dark:bg-teal-500 dark:text-zinc-950" : "text-zinc-600 hover:bg-[var(--edge-soft)] dark:text-zinc-300"
  }`;

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return (await res.json()) as T;
}

/**
 * How one pair of USD, EUR, TRY and BTC moved over the last month, quarter
 * or year (/api/rate-history; lib/domain/rateHistory.ts), one pair at a time
 * since they live on scales far apart. Under it, what an amount was worth on
 * a past date against what it's worth today.
 */
export function RateHistoryCard({ className }: { className?: string }) {
  const { t, locale } = useI18n();
  const formatDate = useFormatDate();
  const rates = useRates();
  const [from, setFrom] = useState<HistoryCurrency>("USD");
  const [to, setTo] = useState<HistoryCurrency>("TRY");
  const [days, setDays] = useState<HistoryRange>(90);
  const [amountText, setAmountText] = useState("1000");
  const [date, setDate] = useState("");

  const history = useQuery({
    queryKey: ["rate-history", days],
    queryFn: () => getJson<RateHistory>(`/api/rate-history?days=${days}`),
    staleTime: 60 * 60_000,
  });
  const on = useQuery({
    queryKey: ["rates-on", date],
    queryFn: () => getJson<RatesOn>(`/api/rate-history?on=${date}`),
    enabled: /^\d{4}-\d{2}-\d{2}$/.test(date),
    staleTime: Infinity,
  });

  const points = history.data ? pairSeries(history.data, from, to) : [];
  const summary = summarize(points);
  const intl = locale === "tr" ? "tr-TR" : "en-US";
  const pct = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${formatRate(Math.abs(Math.round(v * 100) / 100), locale)}%`;
  const shortDate = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(intl, { day: "numeric", month: "short" });

  const amount = parseTypedAmount(amountText, 8);
  const then = on.data && Number.isFinite(amount) ? convertOn(amount, from, to, on.data) : null;
  const now = rates.data && Number.isFinite(amount) ? convertUnits(amount, from, to, rates.data) : null;

  const picker = (value: HistoryCurrency, onChange: (c: HistoryCurrency) => void, label: string) => (
    <Select aria-label={label} value={value} onChange={(e) => isHistoryCurrency(e.target.value) && onChange(e.target.value)}>
      {HISTORY_CURRENCIES.map((c) => (
        <option key={c} value={c}>
          {c} · {t(`currency.${c}`)}
        </option>
      ))}
    </Select>
  );

  return (
    <Card className={className}>
      <CardHeader
        title={t("gadgets.history")}
        action={
          <div role="group" aria-label={t("gadgets.rangeLabel")} className="flex rounded-lg border border-[var(--edge)] p-0.5">
            {HISTORY_RANGES.map((r) => (
              <button key={r} type="button" aria-pressed={days === r} className={segment(days === r)} onClick={() => setDays(r)}>
                {t(`gadgets.range_${r}`)}
              </button>
            ))}
          </div>
        }
      />
      <div className="space-y-3 p-[var(--ui-card-pad-x)]">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{t("gadgets.historyHint")}</p>
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <Field label={t("gadgets.from")}>{picker(from, setFrom, t("gadgets.from"))}</Field>
          </div>
          <button
            type="button"
            onClick={() => {
              setFrom(to);
              setTo(from);
            }}
            aria-label={t("gadgets.swap")}
            title={t("gadgets.swap")}
            className="mb-1 rounded-full border border-[var(--edge)] bg-[var(--surface)] p-2 text-teal-700 hover:bg-[var(--edge-soft)] dark:text-teal-300"
          >
            <Icon name="swap" size={16} />
          </button>
          <div className="min-w-0 flex-1">
            <Field label={t("gadgets.to")}>{picker(to, setTo, t("gadgets.to"))}</Field>
          </div>
        </div>

        {history.isLoading ? (
          <Skeleton rows={5} />
        ) : !summary ? (
          <p className="text-sm text-zinc-400">{t("gadgets.historyEmpty")}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <div>
                <div data-history-last className="tnum text-xl font-semibold text-zinc-900 dark:text-zinc-100">
                  {formatRate(summary.last.rate, locale)} {to}
                </div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                  1 {from} · {formatDate(summary.last.date)}
                </div>
              </div>
              <div className="tnum text-right text-xs text-zinc-500 dark:text-zinc-400">
                <div data-history-change className="font-medium text-zinc-700 dark:text-zinc-200">
                  {summary.changePct > 0 ? "▲" : summary.changePct < 0 ? "▼" : "•"} {t("gadgets.historyChange", { change: pct(summary.changePct) })}
                </div>
                <div>{t("gadgets.historyLow", { rate: formatRate(summary.low.rate, locale), date: shortDate(summary.low.date) })}</div>
                <div>{t("gadgets.historyHigh", { rate: formatRate(summary.high.rate, locale), date: shortDate(summary.high.date) })}</div>
              </div>
            </div>
            <div className="h-56" role="img" aria-label={t("gadgets.historyChart", { from, to })}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="var(--viz-grid)" strokeWidth={1} vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={shortDate}
                    tick={{ fontSize: 11, fill: "var(--viz-muted)" }}
                    tickLine={false}
                    axisLine={{ stroke: "var(--viz-axis)" }}
                    minTickGap={24}
                  />
                  <YAxis
                    domain={["auto", "auto"]}
                    tick={{ fontSize: 11, fill: "var(--viz-muted)" }}
                    tickLine={false}
                    axisLine={false}
                    width={56}
                    tickFormatter={(v: number) => new Intl.NumberFormat(intl, { notation: "compact", maximumSignificantDigits: 4 }).format(v)}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    cursor={{ stroke: "var(--viz-axis)", strokeWidth: 1 }}
                    labelFormatter={(d) => formatDate(String(d))}
                    formatter={(v) => [`${formatRate(Number(v), locale)} ${to}`, `1 ${from}`]}
                  />
                  <Line
                    type="monotone"
                    dataKey="rate"
                    stroke="var(--viz-series-1)"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, stroke: "var(--viz-tooltip-bg)", strokeWidth: 2 }}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <details className="text-xs">
              <summary className="cursor-pointer text-zinc-500 dark:text-zinc-400">{t("gadgets.historyTable")}</summary>
              <div className="mt-1 max-h-56 overflow-y-auto rounded-lg border border-[var(--edge)]">
                <table className="w-full tabular-nums">
                  <tbody className="divide-y divide-[var(--edge-soft)]">
                    {[...points].reverse().map((p) => (
                      <tr key={p.date}>
                        <td className="px-3 py-1 text-zinc-500 dark:text-zinc-400">{formatDate(p.date)}</td>
                        <td className="px-3 py-1 text-right">{formatRate(p.rate, locale)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        )}

        <LiraDevaluationSection />

        <div className="space-y-2 border-t border-[var(--edge-soft)] pt-3">
          <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-200">{t("gadgets.onDate")}</h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{t("gadgets.onDateHint")}</p>
          <div className="grid grid-cols-2 gap-2">
            <Field label={`${t("gadgets.amount")} (${from})`}>
              <Input inputMode="decimal" autoComplete="off" value={amountText} onChange={(e) => setAmountText(e.target.value)} className="tnum" />
            </Field>
            <Field label={t("common.date")}>
              <Input type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>
          {date && on.isLoading ? <Skeleton rows={2} /> : null}
          {on.data ? (
            then == null ? (
              <p className="text-sm text-zinc-400">{t("gadgets.onDateMissing")}</p>
            ) : (
              <div data-on-date className="tnum space-y-0.5 rounded-lg bg-[var(--edge-soft)] px-3 py-2 text-sm">
                <div>
                  <span className="text-zinc-500 dark:text-zinc-400">
                    {t("gadgets.onDateThen", { amount: `${formatUnitAmount(amount, from, locale)} ${from}`, date: formatDate(on.data.date) })}
                  </span>{" "}
                  <span className="font-semibold">= {formatUnitAmount(then, to, locale)} {to}</span>
                </div>
                {now != null ? (
                  <div>
                    <span className="text-zinc-500 dark:text-zinc-400">{t("gadgets.onDateToday")}</span>{" "}
                    <span className="font-semibold">= {formatUnitAmount(now, to, locale)} {to}</span>
                    {then !== 0 ? (
                      <span className="text-zinc-500 dark:text-zinc-400"> · {t("gadgets.onDateChange", { change: pct(((now - then) / then) * 100) })}</span>
                    ) : null}
                  </div>
                ) : null}
                {on.data.date !== date ? (
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">{t("gadgets.onDateUsed", { date: formatDate(on.data.date) })}</div>
                ) : null}
              </div>
            )
          ) : null}
        </div>
      </div>
    </Card>
  );
}
