"use client";

import { useState } from "react";
import { Card, CardHeader, Field, Input } from "@/components/ui";
import { latestCpiMonth, TUIK_CPI_INDEX } from "@/lib/data/inflation";
import { formatAmount } from "@/lib/domain/currencies";
import { formatRate } from "@/lib/domain/converter";
import { inflate } from "@/lib/domain/inflationCalc";
import { parseTypedAmount } from "@/lib/domain/money";
import { useI18n } from "@/lib/i18n";

const CPI_MONTHS = Object.keys(TUIK_CPI_INDEX).sort();

/** yyyy-mm, twelve months before the given one */
function yearBefore(month: string): string {
  const [y, m] = month.split("-");
  return `${Number(y) - 1}-${m}`;
}

/**
 * What a lira amount from one month is worth in another's, by TÜİK's CPI
 * (lib/domain/inflationCalc.ts over lib/data/inflation.ts). Starts at a year
 * ago against the index's latest month, and says how far the index reaches.
 */
export function InflationCard({ className }: { className?: string }) {
  const { t, locale } = useI18n();
  const latest = latestCpiMonth();
  const [text, setText] = useState("10000");
  const [fromMonth, setFromMonth] = useState(() => yearBefore(latest));
  const [toMonth, setToMonth] = useState(latest);

  const amount = parseTypedAmount(text, 2);
  const result = inflate(amount, fromMonth, toMonth, TUIK_CPI_INDEX);
  const intl = locale === "tr" ? "tr-TR" : "en-US";
  const monthName = (m: string) => new Date(`${m}-15T12:00:00`).toLocaleDateString(intl, { month: "long", year: "numeric" });
  const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${formatRate(Math.abs(Math.round(v * 10) / 10), locale)}%`;

  return (
    <Card className={className}>
      <CardHeader title={t("gadgets.inflation")} />
      <div className="space-y-3 p-[var(--ui-card-pad-x)]">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{t("gadgets.inflationHint")}</p>
        <Field label={t("gadgets.inflationAmount")} error={Number.isFinite(amount) ? undefined : t("gadgets.notAnAmount")}>
          <Input inputMode="decimal" autoComplete="off" value={text} onChange={(e) => setText(e.target.value)} className="tnum" />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t("gadgets.inflationFrom")}>
            <Input type="month" value={fromMonth} min={CPI_MONTHS[0]} onChange={(e) => e.target.value && setFromMonth(e.target.value)} />
          </Field>
          <Field label={t("gadgets.inflationTo")}>
            <Input type="month" value={toMonth} min={CPI_MONTHS[0]} onChange={(e) => e.target.value && setToMonth(e.target.value)} />
          </Field>
        </div>
        {result ? (
          <div data-inflation className="tnum space-y-0.5 rounded-lg bg-[var(--edge-soft)] px-3 py-2">
            <div className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">{formatAmount(result.value, "TRY", locale)}</div>
            <div className="text-xs text-zinc-500 dark:text-zinc-400">
              {t("gadgets.inflationResult", { amount: formatAmount(amount, "TRY", locale), month: monthName(result.fromMonth) })} →{" "}
              {monthName(result.toMonth)}
            </div>
            <div className="text-xs text-zinc-600 dark:text-zinc-300">
              {t("gadgets.inflationChange", { change: signed(result.changePct) })}
              {result.annualPct != null && result.fromMonth < result.toMonth
                ? ` · ${t("gadgets.inflationAnnual", { pct: formatRate(Math.round(result.annualPct * 10) / 10, locale) })}`
                : ""}
            </div>
          </div>
        ) : null}
        <p className="text-xs text-zinc-400 dark:text-zinc-500">
          {result?.clamped
            ? t("gadgets.inflationClamped", {
                first: monthName(CPI_MONTHS[0]),
                last: monthName(latest),
                from: monthName(result.fromMonth),
                to: monthName(result.toMonth),
              })
            : t("gadgets.inflationLatest", { month: monthName(latest) })}
        </p>
      </div>
    </Card>
  );
}
