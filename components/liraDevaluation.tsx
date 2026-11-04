"use client";

import Link from "next/link";
import { useState } from "react";
import { Skeleton } from "@/components/ui";
import { formatRate } from "@/lib/domain/converter";
import { projectTryPerUsd, windowAverages, yearByYear } from "@/lib/domain/liraDevaluation";
import { useI18n } from "@/lib/i18n";
import { useLiraHistory } from "@/lib/ui/useLiraHistory";

/**
 * Rate history's lira section (lib/domain/liraDevaluation.ts): the lira's
 * real average yearly loss against the dollar over the last 1, 3 and 5
 * years, each year on its own, and where USD/TRY goes if the chosen pace
 * holds. The Plan's devaluation card offers the same averages.
 */
export function LiraDevaluationSection() {
  const { t, locale } = useI18n();
  const history = useLiraHistory();
  const [chosen, setChosen] = useState<number | null>(null);

  const averages = history.data ? windowAverages(history.data) : [];
  const years = history.data ? yearByYear(history.data) : [];
  // the three-year average unless another was picked: long enough to smooth a shock, short enough to be today's lira
  const pick = averages.find((a) => a.years === chosen) ?? averages.find((a) => a.years === 3) ?? averages.at(-1);
  const now = averages[0]?.to.tryPerUsd;

  const pace = (pct: number) => {
    const rounded = Math.round(pct * 10) / 10;
    if (rounded === 0) return t("gadgets.devalFlat");
    return rounded > 0
      ? t("gadgets.devalPerYear", { pct: formatRate(rounded, locale) })
      : t("gadgets.devalGained", { pct: formatRate(-rounded, locale) });
  };
  const windowName = (n: number) => (n === 1 ? t("gadgets.devalWindowOne") : t("gadgets.devalWindow", { n }));
  const yearOf = (date: string) => date.slice(0, 4);

  return (
    <div data-lira-devaluation className="space-y-2 border-t border-[var(--edge-soft)] pt-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-200">{t("gadgets.deval")}</h3>
        <Link href="/planner" className="text-xs text-teal-700 underline dark:text-teal-300">
          {t("gadgets.devalUseInPlan")}
        </Link>
      </div>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">{t("gadgets.devalHint")}</p>
      {history.isLoading ? (
        <Skeleton rows={3} />
      ) : averages.length === 0 || !pick || now == null ? (
        <p className="text-sm text-zinc-400">{t("gadgets.devalEmpty")}</p>
      ) : (
        <>
          <div role="group" aria-label={t("gadgets.deval")} className="grid grid-cols-3 gap-2">
            {averages.map((a) => (
              <button
                key={a.years}
                type="button"
                data-deval-window={a.years}
                aria-pressed={a.years === pick.years}
                onClick={() => setChosen(a.years)}
                className={`rounded-lg border px-2 py-1.5 text-left transition-colors ${
                  a.years === pick.years
                    ? "border-teal-500 bg-teal-50 dark:bg-teal-950"
                    : "border-[var(--edge)] hover:bg-[var(--edge-soft)]"
                }`}
              >
                <span className="block text-[11px] text-zinc-500 dark:text-zinc-400">{windowName(a.years)}</span>
                <span className="tnum block text-sm font-semibold text-zinc-900 dark:text-zinc-100">{pace(a.pct)}</span>
                <span className="tnum block text-[11px] text-zinc-500 dark:text-zinc-400">
                  {t("gadgets.devalRange", { from: formatRate(a.from.tryPerUsd, locale), to: formatRate(a.to.tryPerUsd, locale) })}
                </span>
              </button>
            ))}
          </div>
          <div className="text-xs text-zinc-600 dark:text-zinc-300">
            <p>{t("gadgets.devalPace", { window: windowName(pick.years).toLowerCase() })}:</p>
            <ul data-deval-projection className="tnum mt-1 grid grid-cols-3 gap-2">
              {[1, 3, 5].map((n) => (
                <li key={n} className="rounded-md bg-[var(--edge-soft)] px-2 py-1">
                  <span className="block text-[11px] text-zinc-500 dark:text-zinc-400">{t("gadgets.devalInYears", { n })}</span>
                  <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                    {(() => {
                      const r = projectTryPerUsd(now, pick.pct, n);
                      return r == null ? "—" : formatRate(Math.round(r * 100) / 100, locale);
                    })()}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          {years.length ? (
            <details className="text-xs">
              <summary className="cursor-pointer text-zinc-500 dark:text-zinc-400">{t("gadgets.devalYears")}</summary>
              <ul className="tnum mt-1 divide-y divide-[var(--edge-soft)] rounded-lg border border-[var(--edge)]">
                {years.map((y) => (
                  <li key={y.from.date} className="flex justify-between gap-2 px-3 py-1">
                    <span className="text-zinc-500 dark:text-zinc-400">
                      {t("gadgets.devalYear", { from: yearOf(y.from.date), to: yearOf(y.to.date) })} ·{" "}
                      {formatRate(y.from.tryPerUsd, locale)} → {formatRate(y.to.tryPerUsd, locale)}
                    </span>
                    <span>{pace(y.pct)}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </>
      )}
    </div>
  );
}
