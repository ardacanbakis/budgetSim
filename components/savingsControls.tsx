"use client";

import { ReactNode } from "react";
import { Badge, Input } from "@/components/ui";
import { formatAmount } from "@/lib/domain/currencies";
import { SavingsPlan } from "@/lib/domain/savingsFinance";
import { useI18n } from "@/lib/i18n";

/**
 * A continuous number, three ways: quick picks for the value you probably
 * want, a slider for exploring, and a field for the number you were actually
 * quoted. All three write the same state, so none of them is the "real" one.
 */
export function NumberControl({
  label,
  hint,
  value,
  onChange,
  min,
  max,
  step,
  quickPicks,
  format,
  suffix,
  error,
}: {
  label: string;
  hint?: ReactNode;
  value: number;
  onChange: (next: number) => void;
  min: number;
  max: number;
  step: number;
  quickPicks: number[];
  format?: (n: number) => string;
  suffix?: string;
  error?: string;
}) {
  const show = format ?? ((n: number) => String(n));
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{label}</span>
        {hint ? <span className="text-xs text-zinc-400">{hint}</span> : null}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {quickPicks.map((pick) => (
          <button
            key={pick}
            type="button"
            onClick={() => onChange(pick)}
            aria-pressed={value === pick}
            className={`rounded-md border px-2 py-1 text-xs tnum transition-colors ${
              value === pick
                ? "border-teal-500 bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-300"
                : "border-[var(--edge)] text-zinc-600 hover:border-teal-500/40 dark:text-zinc-300"
            }`}
          >
            {show(pick)}
          </button>
        ))}
      </div>
      <input
        type="range"
        aria-label={label}
        className="w-full accent-teal-600"
        min={min}
        max={max}
        step={step}
        value={Math.min(max, Math.max(min, value))}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <div className="flex items-center gap-2">
        <Input
          type="number"
          inputMode="decimal"
          min={min}
          step={step}
          value={value}
          aria-label={`${label} (exact)`}
          onChange={(e) => onChange(Number(e.target.value))}
          className={error ? "border-red-500 focus:border-red-500 focus:ring-red-500" : undefined}
        />
        {suffix ? <span className="shrink-0 text-xs text-zinc-500">{suffix}</span> : null}
      </div>
      {error ? <p className="text-xs font-medium text-red-600 dark:text-red-400">{error}</p> : null}
    </div>
  );
}

/**
 * The step rate is a four-option segmented control, never a slider: the
 * provider sells exactly these rates and a 7% step is not something you can
 * buy. Offering a continuum would imply otherwise.
 */
export function StepRatePicker({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: number;
  options: number[];
  onChange: (next: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{label}</span>
      <div role="group" aria-label={label} className="flex rounded-lg border border-[var(--edge)] p-0.5">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={value === option}
            onClick={() => onChange(option)}
            className={`flex-1 rounded-md px-2 py-1.5 text-sm font-medium tnum transition-colors ${
              value === option
                ? "bg-teal-600 text-white dark:bg-teal-500 dark:text-zinc-950"
                : "text-zinc-600 hover:bg-[var(--edge-soft)] dark:text-zinc-300"
            }`}
          >
            {option}%
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The schedule, row by row. Tier starts and the balloon are tagged because
 * they are the two places the number stops being what you expect; the delivery
 * row is highlighted and everything before the day gate is dimmed, so the
 * shape of the plan is legible without reading a single figure.
 */
export function SavingsSchedule({ plan }: { plan: SavingsPlan }) {
  const { t, locale } = useI18n();
  const money = (n: number) => formatAmount(n, "TRY", locale);
  const stepTag = `+${plan.input.stepRatePct}%`;

  return (
    <div className="overflow-x-auto">
      <table className="stack-sm sticky-head w-full text-sm tabular-nums">
        <thead>
          <tr className="border-b border-[var(--edge)] text-left text-xs text-zinc-500">
            <th className="px-3 py-2 font-medium">{t("savings.colPeriod")}</th>
            <th className="px-3 py-2 font-medium">{t("common.date")}</th>
            <th className="px-3 py-2 text-right font-medium">{t("savings.colInstalment")}</th>
            <th className="px-3 py-2 text-right font-medium">{t("savings.colCumulative")}</th>
            <th className="px-3 py-2 text-right font-medium">{t("savings.colRatio")}</th>
            <th className="px-3 py-2 text-right font-medium">{t("savings.colDays")}</th>
            <th className="px-3 py-2 text-right font-medium">{t("savings.colOrgFee")}</th>
            <th className="px-3 py-2 text-right font-medium">{t("savings.colCashOut")}</th>
          </tr>
        </thead>
        <tbody>
          {plan.rows.map((row) => {
            const locked = row.days < plan.input.minDeliveryDays;
            const isDelivery = row.period === plan.deliveryPeriod;
            return (
              <tr
                key={row.period}
                data-delivery={isDelivery || undefined}
                className={`border-b border-[var(--edge-soft)] ${
                  isDelivery ? "bg-teal-50 dark:bg-teal-950/50" : locked ? "opacity-55" : ""
                }`}
              >
                <td className="px-3 py-1.5" data-label={t("savings.colPeriod")}>
                  <span className="flex flex-wrap items-center gap-1.5">
                    {row.period}
                    {row.isTierStart && plan.input.stepRatePct > 0 ? (
                      <Badge tone="sky">{stepTag}</Badge>
                    ) : null}
                    {row.isBalloon ? <Badge tone="amber">{t("savings.balloon")}</Badge> : null}
                    {isDelivery ? <Badge tone="green">{t("savings.delivery")}</Badge> : null}
                  </span>
                </td>
                <td className="px-3 py-1.5" data-label={t("common.date")}>
                  {row.date}
                </td>
                <td className="px-3 py-1.5 text-right font-medium" data-label={t("savings.colInstalment")}>
                  {money(row.instalment)}
                </td>
                <td className="px-3 py-1.5 text-right text-zinc-500" data-label={t("savings.colCumulative")}>
                  {money(row.cumulative)}
                </td>
                <td className="px-3 py-1.5 text-right" data-label={t("savings.colRatio")}>
                  {(row.ratio * 100).toFixed(2)}%
                </td>
                <td className="px-3 py-1.5 text-right text-zinc-500" data-label={t("savings.colDays")}>
                  {row.days}
                </td>
                <td className="px-3 py-1.5 text-right text-zinc-500" data-label={t("savings.colOrgFee")}>
                  {row.orgFeeInstalment > 0 ? money(row.orgFeeInstalment) : "—"}
                </td>
                <td className="px-3 py-1.5 text-right font-medium" data-label={t("savings.colCashOut")}>
                  {money(row.cashOut)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
