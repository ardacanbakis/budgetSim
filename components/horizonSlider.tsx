"use client";

import { useI18n } from "@/lib/i18n";

export const MIN_HORIZON = 1;
export const MAX_HORIZON = 120;
const PRESETS = [6, 12, 24, 60, 120];

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
 * with the common year marks as one-tap presets.
 */
export function HorizonSlider({ months, onChange }: { months: number; onChange: (m: number) => void }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex min-w-56 flex-1 items-center gap-3">
        <input
          type="range"
          min={MIN_HORIZON}
          max={MAX_HORIZON}
          step={1}
          value={months}
          onChange={(e) => onChange(Number(e.target.value))}
          className="flex-1 accent-teal-600"
          aria-label={t("projections.horizon")}
        />
        <span className="w-24 shrink-0 text-right text-sm font-semibold tabular-nums">
          {horizonLabel(months, t)}
        </span>
      </div>
      <div className="flex gap-1">
        {PRESETS.map((preset) => (
          <button
            key={preset}
            onClick={() => onChange(preset)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              months === preset
                ? "bg-teal-600 text-white dark:bg-teal-500 dark:text-zinc-950"
                : "bg-[var(--edge-soft)] text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            }`}
          >
            {preset % 12 === 0 ? `${preset / 12}y` : `${preset}m`}
          </button>
        ))}
      </div>
    </div>
  );
}
