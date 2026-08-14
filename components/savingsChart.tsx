"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { SavingsPlan } from "@/lib/domain/savingsFinance";
import { useI18n } from "@/lib/i18n";

const tooltipStyle = {
  backgroundColor: "var(--viz-tooltip-bg)",
  border: "1px solid var(--viz-grid)",
  borderRadius: 8,
  fontSize: 12,
};

/**
 * One picture of the two gates.
 *
 * Bars are what you pay, the line is how close you are to the delivery share,
 * the dashed rule is the share you need, and the grey band is the stretch where
 * the day count blocks you no matter what the line says. Read together they
 * answer the only question that matters: when do I get the keys, and why not
 * sooner.
 */
export function SavingsChart({ plan }: { plan: SavingsPlan }) {
  const { t, locale } = useI18n();

  const data = plan.rows.map((r) => ({
    period: r.period,
    instalment: r.instalment,
    ratioPct: r.ratio * 100,
    locked: r.days < plan.input.minDeliveryDays,
  }));

  // the grey band covers every period still inside the day lock
  const lockedRows = plan.rows.filter((r) => r.days < plan.input.minDeliveryDays);
  const lockEnd = lockedRows.length > 0 ? lockedRows[lockedRows.length - 1].period : null;

  const nf = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });

  return (
    <div className="h-72 w-full sm:h-80">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--viz-grid)" vertical={false} />
          <XAxis dataKey="period" stroke="var(--viz-axis)" fontSize={11} tickLine={false} axisLine={false} />
          <YAxis
            yAxisId="money"
            stroke="var(--viz-axis)"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            width={60}
            tickFormatter={(v: number) => nf.format(v)}
          />
          <YAxis
            yAxisId="ratio"
            orientation="right"
            stroke="var(--viz-axis)"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            width={44}
            domain={[0, 100]}
            tickFormatter={(v: number) => `${v}%`}
          />

          {lockEnd != null ? (
            <ReferenceArea
              yAxisId="ratio"
              x1={1}
              x2={lockEnd}
              fill="var(--viz-muted)"
              fillOpacity={0.14}
              label={{ value: t("savings.chartLocked"), fontSize: 11, fill: "var(--viz-muted)", position: "insideTop" }}
            />
          ) : null}

          <ReferenceLine
            yAxisId="ratio"
            y={plan.input.deliveryRatioPct}
            stroke="var(--viz-series-4)"
            strokeDasharray="6 4"
            label={{
              value: `${plan.input.deliveryRatioPct}%`,
              fontSize: 11,
              fill: "var(--viz-series-4)",
              position: "right",
            }}
          />

          {plan.deliveryPeriod != null ? (
            <ReferenceLine
              yAxisId="ratio"
              x={plan.deliveryPeriod}
              stroke="var(--viz-series-1)"
              strokeWidth={2}
              label={{
                value: t("savings.chartDelivery"),
                fontSize: 11,
                fill: "var(--viz-series-1)",
                position: "top",
              }}
            />
          ) : null}

          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(value, name) =>
              name === t("savings.chartRatio")
                ? `${Number(value).toFixed(2)}%`
                : nf.format(Number(value))
            }
            labelFormatter={(p) => t("savings.chartPeriod", { n: Number(p) })}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar
            yAxisId="money"
            dataKey="instalment"
            name={t("savings.chartInstalment")}
            fill="var(--viz-series-3)"
            radius={[3, 3, 0, 0]}
          />
          <Line
            yAxisId="ratio"
            type="monotone"
            dataKey="ratioPct"
            name={t("savings.chartRatio")}
            stroke="var(--viz-series-1)"
            strokeWidth={2}
            dot={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
