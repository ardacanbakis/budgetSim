"use client";

import { useI18n } from "@/lib/i18n";

export const MIN_HORIZON = 1;
export const MAX_HORIZON = 120;

/** Year marks along the track — each one is a jump target. */
const YEAR_MARKS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/** Human horizon label: "18 months" → "1y 6m", "60" → "5y". */
export function horizonLabel(months: number, t: (k: string, v?: Record<string, string | number>) => string): string {
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (y === 0) return t("projections.nMonths", { count: m });
  if (m === 0) return t("projections.nYears", { count: y });
  return `${t("projections.nYears", { count: y })} ${t("projections.nMonths", { count: m })}`;
}

/**
 * Horizon control shared by Projections and the Planner: a 1–120 month slider
 * with clickable year marks sitting on the track itself, so you can jump
 * straight to "5 years out" and watch everything below re-draw.
 */
export function HorizonSlider({ months, onChange }: { months: number; onChange: (m: number) => void }) {
  const { t } = useI18n();
  const pct = (value: number) => ((value - MIN_HORIZON) / (MAX_HORIZON - MIN_HORIZON)) * 100;

  return (
    <div className="w-full">
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="text-xs font-medium text-zinc-500">{t("projections.horizon")}</span>
        <span className="text-sm font-semibold tabular-nums">{horizonLabel(months, t)}</span>
      </div>

      <div className="relative">
        <input
          type="range"
          min={MIN_HORIZON}
          max={MAX_HORIZON}
          step={1}
          value={months}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full accent-teal-600"
          aria-label={t("projections.horizon")}
          aria-valuetext={horizonLabel(months, t)}
        />
        {/* tick marks pinned under the track at each year */}
        <div className="pointer-events-none relative mt-0.5 h-2">
          {YEAR_MARKS.map((year) => (
            <span
              key={year}
              className={`absolute top-0 h-1.5 w-px ${months >= year * 12 ? "bg-teal-500/70" : "bg-[var(--edge)]"}`}
              style={{ left: `${pct(year * 12)}%` }}
            />
          ))}
        </div>
      </div>

      {/* clickable year jumps, aligned with the ticks above */}
      <div className="relative mt-0.5 h-5">
        {YEAR_MARKS.map((year) => {
          const target = year * 12;
          const active = months === target;
          return (
            <button
              key={year}
              onClick={() => onChange(target)}
              style={{ left: `${pct(target)}%` }}
              className={`absolute top-0 -translate-x-1/2 rounded px-1 text-[11px] font-medium tabular-nums transition-colors ${
                active ? "bg-teal-600 text-white dark:bg-teal-500 dark:text-zinc-950" : "text-zinc-400 hover:text-teal-600"
              }`}
              aria-label={t("projections.nYears", { count: year })}
            >
              {year}y
            </button>
          );
        })}
      </div>
    </div>
  );
}
