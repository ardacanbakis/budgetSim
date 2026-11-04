"use client";

import { useState } from "react";
import { Badge, Button, Card, CardHeader, Field, Input, Select, Skeleton } from "@/components/ui";
import { useRepo } from "@/lib/data/provider";
import { KEYS, useAppMutation, useRateAlerts, useRates } from "@/lib/data/queries";
import { RateAlert } from "@/lib/data/types";
import { availableUnits, ConverterUnit, formatRate, isConverterUnit } from "@/lib/domain/converter";
import { isCurrency } from "@/lib/domain/currencies";
import { parseTypedAmount } from "@/lib/domain/money";
import { AlertDirection, alertRate, distancePct } from "@/lib/domain/rateAlerts";
import { localDateOf } from "@/lib/domain/recurrence";
import { useI18n } from "@/lib/i18n";
import { useUnitLabels } from "@/lib/ui/useUnitLabels";
import { useFormatDate } from "@/lib/useFormatDate";

const segment = (on: boolean) =>
  `flex-1 rounded-md px-2 py-1.5 text-sm font-medium transition-colors ${
    on ? "bg-teal-600 text-white dark:bg-teal-500 dark:text-zinc-950" : "text-zinc-600 hover:bg-[var(--edge-soft)] dark:text-zinc-300"
  }`;

/**
 * Rate alerts (lib/domain/rateAlerts.ts): a pair of the converter's units, a
 * direction and a line. RateAlertWatcher, in the shell, fires them; this is
 * where they're set, where each shows today's rate and how far it has to go,
 * and where one that has fired is re-armed.
 */
export function RateAlertsCard({ className }: { className?: string }) {
  const { t, locale } = useI18n();
  const repo = useRepo();
  const rates = useRates();
  const alerts = useRateAlerts();
  const { short, long } = useUnitLabels();
  const formatDate = useFormatDate();
  const [from, setFrom] = useState<ConverterUnit>("USD");
  const [to, setTo] = useState<ConverterUnit>("TRY");
  const [direction, setDirection] = useState<AlertDirection>("above");
  const [text, setText] = useState("");
  const [error, setError] = useState(false);

  const table = rates.data;
  const units = availableUnits(table);
  const current = table ? alertRate({ fromUnit: from, toUnit: to }, table) : null;

  const add = useAppMutation(
    (threshold: number) => repo.createRateAlert({ fromUnit: from, toUnit: to, direction, threshold }),
    [KEYS.rateAlerts]
  );
  const update = useAppMutation(
    ({ id, patch }: { id: string; patch: Partial<RateAlert> }) => repo.updateRateAlert(id, patch),
    [KEYS.rateAlerts]
  );
  const remove = useAppMutation((id: string) => repo.deleteRateAlert(id), [KEYS.rateAlerts]);

  const picker = (value: ConverterUnit, onChange: (u: ConverterUnit) => void, label: string) => (
    <Select aria-label={label} value={value} onChange={(e) => isConverterUnit(e.target.value) && onChange(e.target.value)}>
      <optgroup label={t("gadgets.groupCurrencies")}>
        {units.filter(isCurrency).map((u) => (
          <option key={u} value={u}>
            {long(u)}
          </option>
        ))}
      </optgroup>
      {units.some((u) => !isCurrency(u)) ? (
        <optgroup label={t("gadgets.groupGold")}>
          {units
            .filter((u) => !isCurrency(u))
            .map((u) => (
              <option key={u} value={u}>
                {long(u)}
              </option>
            ))}
        </optgroup>
      ) : null}
    </Select>
  );

  const label = (u: string) => (isConverterUnit(u) ? short(u) : u);

  return (
    <Card className={className}>
      <CardHeader title={t("gadgets.alerts")} />
      <div className="space-y-3 p-[var(--ui-card-pad-x)]">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{t("gadgets.alertsHint")}</p>
        {!table ? (
          <Skeleton rows={3} />
        ) : (
          <form
            data-alert-form
            className="space-y-2"
            noValidate
            onSubmit={async (e) => {
              e.preventDefault();
              const threshold = parseTypedAmount(text, 8);
              if (!(threshold > 0) || from === to) return setError(true);
              setError(false);
              await add.mutateAsync(threshold);
              setText("");
            }}
          >
            <div className="grid grid-cols-2 gap-2">
              <Field label={t("gadgets.from")}>{picker(from, setFrom, t("gadgets.from"))}</Field>
              <Field label={t("gadgets.to")}>{picker(to, setTo, t("gadgets.to"))}</Field>
            </div>
            <div role="group" aria-label={t("gadgets.alertDirection")} className="flex rounded-lg border border-[var(--edge)] p-0.5">
              {(["above", "below"] as const).map((d) => (
                <button key={d} type="button" aria-pressed={direction === d} className={segment(direction === d)} onClick={() => setDirection(d)}>
                  {t(`gadgets.${d}`)}
                </button>
              ))}
            </div>
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <Field
                  label={`${t("gadgets.threshold")} (${label(to)})`}
                  error={error ? t("gadgets.thresholdRequired") : undefined}
                  hint={current != null ? t("gadgets.alertNow", { rate: formatRate(current, locale) }) : undefined}
                >
                  <Input
                    inputMode="decimal"
                    autoComplete="off"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder={current != null ? formatRate(current, locale) : ""}
                    className="tnum"
                  />
                </Field>
              </div>
              <Button type="submit" variant="primary" disabled={add.isPending} className="mb-[1.375rem] shrink-0">
                {t("gadgets.addAlert")}
              </Button>
            </div>
          </form>
        )}

        {alerts.isLoading ? null : (alerts.data ?? []).length === 0 ? (
          <p className="text-sm text-zinc-400">{t("gadgets.alertsEmpty")}</p>
        ) : (
          <ul className="divide-y divide-[var(--edge-soft)] rounded-lg border border-[var(--edge)]">
            {(alerts.data ?? []).map((a) => {
              const rate = table ? alertRate(a, table) : null;
              const hit = a.triggeredAt != null;
              const line = t("gadgets.alertLine", {
                from: label(a.fromUnit),
                direction: t(`gadgets.${a.direction}`),
                threshold: formatRate(a.threshold, locale),
                to: label(a.toUnit),
              });
              return (
                <li key={a.id} data-alert className="flex items-start justify-between gap-2 px-3 py-2">
                  <div className="min-w-0 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-zinc-800 dark:text-zinc-100">{line}</span>
                      <Badge tone={hit ? "green" : "zinc"}>{hit ? t("gadgets.alertHit") : t("gadgets.alertArmed")}</Badge>
                    </div>
                    <div className="tnum text-xs text-zinc-500 dark:text-zinc-400">
                      {hit
                        ? t("gadgets.alertHitAt", {
                            date: formatDate(localDateOf(a.triggeredAt!)),
                            rate: a.triggeredRate != null ? formatRate(a.triggeredRate, locale) : "—",
                          })
                        : rate == null
                          ? t("gadgets.alertNoRate")
                          : `${t("gadgets.alertNow", { rate: formatRate(rate, locale) })} · ${t("gadgets.alertToGo", {
                              pct: formatRate(Math.max(0, Math.round(distancePct(a, rate) * 100) / 100), locale),
                            })}`}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {hit ? (
                      <Button
                        variant="ghost"
                        className="px-2 py-1 text-xs"
                        onClick={() => update.mutate({ id: a.id, patch: { triggeredAt: null, triggeredRate: null, acknowledgedAt: null } })}
                      >
                        {t("gadgets.rearm")}
                      </Button>
                    ) : null}
                    <Button
                      variant="ghost"
                      className="px-2 py-1 text-xs"
                      aria-label={`${t("gadgets.deleteAlert")}: ${line}`}
                      title={t("gadgets.deleteAlert")}
                      onClick={() => remove.mutate(a.id)}
                    >
                      ✕
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Card>
  );
}
