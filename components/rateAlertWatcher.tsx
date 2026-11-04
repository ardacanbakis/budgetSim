"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { useRepo } from "@/lib/data/provider";
import { KEYS, useAppMutation, useRateAlerts, useRates } from "@/lib/data/queries";
import { formatRate, isConverterUnit } from "@/lib/domain/converter";
import { newlyMet } from "@/lib/domain/rateAlerts";
import { isStaleTable } from "@/lib/rates/fallback";
import { useI18n } from "@/lib/i18n";
import { useUnitLabels } from "@/lib/ui/useUnitLabels";

/**
 * Fires rate alerts (lib/domain/rateAlerts.ts): whenever a live rate table
 * arrives, an armed alert it meets gets the moment and the rate recorded, so
 * it fires once, on whichever device saw it first. The static fallback never
 * fires anything. Renders nothing; RateAlertBanner shows what fired.
 */
export function RateAlertWatcher() {
  const repo = useRepo();
  const rates = useRates();
  const alerts = useRateAlerts();
  const firing = useRef(new Set<string>());
  const fire = useAppMutation(
    (met: { id: string; rate: number }[]) =>
      Promise.all(
        met.map((m) => repo.updateRateAlert(m.id, { triggeredAt: new Date().toISOString(), triggeredRate: m.rate }))
      ),
    [KEYS.rateAlerts]
  );
  const { mutate } = fire;

  const table = rates.data;
  useEffect(() => {
    if (!table || isStaleTable(table) || !alerts.data) return;
    const met = newlyMet(alerts.data, table).filter((m) => !firing.current.has(m.alert.id));
    if (met.length === 0) return;
    for (const m of met) firing.current.add(m.alert.id);
    mutate(met.map((m) => ({ id: m.alert.id, rate: m.rate })));
  }, [table, alerts.data, mutate]);

  return null;
}

/** A line under the header for each alert that fired and hasn't been dismissed. */
export function RateAlertBanner() {
  const { t, locale } = useI18n();
  const repo = useRepo();
  const alerts = useRateAlerts();
  const { short } = useUnitLabels();
  const dismiss = useAppMutation(
    (ids: string[]) => Promise.all(ids.map((id) => repo.updateRateAlert(id, { acknowledgedAt: new Date().toISOString() }))),
    [KEYS.rateAlerts]
  );

  const fired = (alerts.data ?? []).filter((a) => a.triggeredAt && !a.acknowledgedAt);
  if (fired.length === 0) return null;
  const first = fired[0];
  const label = (u: string) => (isConverterUnit(u) ? short(u) : u);

  return (
    <div
      role="status"
      data-alert-banner
      className="no-print flex items-center justify-center gap-2 border-b border-emerald-300 bg-emerald-50 px-4 py-1.5 text-xs text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
    >
      <span aria-hidden>🔔</span>
      <span>
        {t("gadgets.bannerHit", {
          pair: `${label(first.fromUnit)} → ${label(first.toUnit)}`,
          went: t(`gadgets.went_${first.direction}`),
          threshold: formatRate(first.threshold, locale),
          rate: first.triggeredRate != null ? formatRate(first.triggeredRate, locale) : "—",
        })}
      </span>
      {fired.length > 1 ? <span className="opacity-70">{t("gadgets.bannerMore", { count: fired.length - 1 })}</span> : null}
      <Link href="/gadgets" className="underline">
        {t("gadgets.bannerSee")}
      </Link>
      <button type="button" className="font-semibold underline" onClick={() => dismiss.mutate(fired.map((a) => a.id))}>
        {t("gadgets.bannerDismiss")}
      </button>
    </div>
  );
}
