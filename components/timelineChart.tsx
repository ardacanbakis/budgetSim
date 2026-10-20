"use client";

import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Currency } from "@/lib/domain/currencies";
import { balanceAt, BalancePoint } from "@/lib/domain/timeline";
import { useI18n } from "@/lib/i18n";
import { formatCompact, formatSigned } from "@/lib/ui/pocket/format";

/**
 * One account's balance over the Timeline's window, as a step line: solid
 * up to today, dashed after it, with a rule at today and another at zero
 * when the line goes below it. Shared by the Classic and Pocket tabs; each
 * loads it lazily (next/dynamic), so recharts stays off the first paint.
 *
 * With `hideTicks` (Pocket's Hide amounts) the axis carries no figures and
 * the tooltip shows none: the shape stays, the numbers don't.
 */

const tooltipStyle = {
  backgroundColor: "var(--viz-tooltip-bg)",
  border: "1px solid var(--viz-grid)",
  borderRadius: 8,
  fontSize: 12,
};

const DAY = 86_400_000;
const ms = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

interface Datum {
  at: number;
  past?: number;
  ahead?: number;
}

export default function TimelineChart({
  points,
  today,
  from,
  to,
  currency,
  height,
  label,
  hideTicks = false,
}: {
  points: readonly BalancePoint[];
  today: string;
  from: string;
  to: string;
  currency: Currency;
  height: number;
  /** what the picture is, for a screen reader */
  label: string;
  hideTicks?: boolean;
}) {
  const { t, locale } = useI18n();

  // the window's own points, with the balance it starts at and holds to its end
  const inside = points.filter((p) => p.date > from && p.date <= to);
  const start = balanceAt(points, from);
  const series: BalancePoint[] = [...(start != null ? [{ date: from, balance: start }] : []), ...inside];
  const last = series.at(-1);
  if (last && last.date < to) series.push({ date: to, balance: last.balance });
  const data: Datum[] = series.map((p) => ({
    at: ms(p.date),
    past: p.date <= today ? p.balance : undefined,
    ahead: p.date >= today ? p.balance : undefined,
  }));
  // the dashed part starts where the solid part ends
  const now = balanceAt(points, today);
  if (now != null && !series.some((p) => p.date === today) && today >= from && today <= to) {
    data.push({ at: ms(today), past: now, ahead: now });
    data.sort((a, b) => a.at - b.at);
  }
  const low = Math.min(...series.map((p) => p.balance));
  const dateTag = locale === "tr" ? "tr-TR" : "en-GB";
  const day = (v: number) => new Date(v).toLocaleDateString(dateTag, { day: "numeric", month: "short", timeZone: "UTC" });

  return (
    <div role="img" aria-label={label} style={{ height }} data-timeline-chart>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--viz-grid)" vertical={false} />
          <XAxis
            dataKey="at"
            type="number"
            scale="time"
            domain={[ms(from), ms(to) + DAY / 2]}
            stroke="var(--viz-axis)"
            fontSize={11}
            tickLine={false}
            tickFormatter={day}
            minTickGap={24}
          />
          <YAxis
            stroke="var(--viz-axis)"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            width={hideTicks ? 0 : 56}
            tick={hideTicks ? false : undefined}
            tickFormatter={(v: number) => formatCompact(v, currency, locale)}
          />
          {low < 0 ? <ReferenceLine y={0} stroke="var(--color-red-500, #ef4444)" strokeDasharray="4 3" /> : null}
          {today >= from && today <= to ? (
            <ReferenceLine
              x={ms(today)}
              stroke="var(--viz-series-2)"
              strokeWidth={2}
              label={{ value: t("timeline.today"), fontSize: 11, fill: "var(--viz-series-2)", position: "insideTopLeft" }}
            />
          ) : null}
          {hideTicks ? null : (
            <Tooltip
              contentStyle={tooltipStyle}
              labelFormatter={(v) => day(Number(v))}
              formatter={(value) => formatSigned(Number(value), currency, locale)}
            />
          )}
          <Area
            type="stepAfter"
            dataKey="past"
            name={t("timeline.balance")}
            stroke="var(--viz-series-1)"
            fill="var(--viz-series-1)"
            fillOpacity={0.12}
            strokeWidth={2}
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
          />
          <Line
            type="stepAfter"
            dataKey="ahead"
            name={t("timeline.balanceAhead")}
            stroke="var(--viz-series-1)"
            strokeDasharray="5 4"
            strokeWidth={2}
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
