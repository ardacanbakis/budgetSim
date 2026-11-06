"use client";

import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Currency } from "@/lib/domain/currencies";
import { DailyBalances } from "@/lib/domain/cashFlow";
import { useI18n } from "@/lib/i18n";
import { formatCompact, formatSigned } from "@/lib/ui/pocket/format";

/**
 * The cash accounts of one currency, day by day, as step lines, with their
 * total drawn heavier: the total is what has to stay above zero, since money
 * can be moved between your own accounts on the day.
 *
 * Loaded lazily by the Plan's flow card (next/dynamic), so recharts stays
 * off the first paint the way the Timeline's chart does.
 */

const tooltipStyle = {
  backgroundColor: "var(--viz-tooltip-bg)",
  border: "1px solid var(--viz-grid)",
  borderRadius: 8,
  fontSize: 12,
};

const SERIES = ["var(--viz-series-3)", "var(--viz-series-4)", "var(--viz-series-5)", "var(--viz-series-2)"];
const ms = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

export default function FlowChart({
  daily,
  currency,
  height = 280,
  label,
}: {
  daily: DailyBalances;
  currency: Currency;
  height?: number;
  label: string;
}) {
  const { t, locale } = useI18n();
  const dateTag = locale === "tr" ? "tr-TR" : "en-GB";
  const day = (v: number) => new Date(v).toLocaleDateString(dateTag, { day: "numeric", month: "short", timeZone: "UTC" });

  // one row a day: the total, then a key per account named after it
  const data = daily.dates.map((date, i) => {
    const row: Record<string, number> = { at: ms(date), total: daily.total[i] };
    daily.lines.forEach((line, n) => (row[`a${n}`] = line.values[i]));
    return row;
  });
  const goesUnder = daily.total.some((v) => v < -0.005) || daily.lines.some((l) => l.values.some((v) => v < -0.005));

  return (
    <div role="img" aria-label={label} style={{ height }} data-flow-chart={currency}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--viz-grid)" vertical={false} />
          <XAxis
            dataKey="at"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            stroke="var(--viz-axis)"
            fontSize={11}
            tickLine={false}
            tickFormatter={day}
            minTickGap={28}
          />
          <YAxis
            stroke="var(--viz-axis)"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            width={60}
            tickFormatter={(v: number) => formatCompact(v, currency, locale)}
          />
          {/* the line the plan must not cross, drawn only when it would */}
          {goesUnder ? <ReferenceLine y={0} stroke="var(--color-red-500, #ef4444)" strokeDasharray="4 3" /> : null}
          <Tooltip
            contentStyle={tooltipStyle}
            labelFormatter={(v) => day(Number(v))}
            formatter={(value) => formatSigned(Number(value), currency, locale)}
          />
          {daily.lines.length > 1 ? (
            <Line
              type="stepAfter"
              dataKey="total"
              name={t("flow.total")}
              stroke="var(--viz-series-1)"
              strokeWidth={2.5}
              dot={false}
              isAnimationActive={false}
            />
          ) : null}
          {daily.lines.map((line, n) => (
            <Line
              key={line.account.id}
              type="stepAfter"
              dataKey={`a${n}`}
              name={line.account.name}
              stroke={daily.lines.length > 1 ? SERIES[n % SERIES.length] : "var(--viz-series-1)"}
              strokeWidth={daily.lines.length > 1 ? 1.5 : 2.5}
              strokeDasharray={daily.lines.length > 1 ? "4 3" : undefined}
              dot={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
