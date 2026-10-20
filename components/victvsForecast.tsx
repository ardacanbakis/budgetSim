"use client";

import { useMemo, useState } from "react";
import { useVictvsPayouts, useVictvsSessions } from "@/lib/data/queries";
import { formatAmount } from "@/lib/domain/currencies";
import { todayISO } from "@/lib/domain/recurrence";
import { forecastVictvs, VictvsForecast } from "@/lib/domain/victvsForecast";
import { useI18n } from "@/lib/i18n";

/**
 * The VICTVS forecast (lib/domain/victvsForecast.ts) as a list of the months
 * ahead: what each should earn, its range across earlier years, the months it
 * stands on, and when the money should land. Shared by the VICTVS page (both
 * layouts) and the Planner; the caller supplies the card around it.
 */

/** The forecast from the sessions and payouts on record, null while they load. */
export function useVictvsForecast(months: number): VictvsForecast | null {
  const sessions = useVictvsSessions();
  const payouts = useVictvsPayouts();
  return useMemo(
    () =>
      sessions.data && payouts.data
        ? forecastVictvs({ sessions: sessions.data, payouts: payouts.data, today: todayISO(), months })
        : null,
    [sessions.data, payouts.data, months]
  );
}

/** `rows` months, of which the first `initialRows` show until "Show N months" is tapped. */
export function VictvsForecastView({
  forecast,
  rows = 6,
  initialRows = rows,
}: {
  forecast: VictvsForecast;
  rows?: number;
  initialRows?: number;
}) {
  const { t, locale } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const usd = (n: number) => formatAmount(n, "USD", locale);
  const tag = locale === "tr" ? "tr-TR" : "en-GB";
  const monthName = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString(tag, { month: "short", year: "numeric" });
  const shown = forecast.earnings.slice(0, expanded ? rows : Math.min(rows, initialRows));
  const top = Math.max(1, ...shown.map((e) => Math.max(e.high, e.soFar)));
  const bases = new Set(shown.map((e) => e.basis));

  if (bases.size === 1 && bases.has("none")) {
    return <p className="text-sm text-zinc-500" data-victvs-forecast="none">{t("victvs.forecastNone")}</p>;
  }

  const payouts = forecast.cash.slice(0, rows).filter((c) => c.expected > 0);

  return (
    <div className="space-y-3" data-victvs-forecast>
      <p className="text-xs text-zinc-500">
        {bases.has("recent") ? t("victvs.forecastRecent") : t("victvs.forecastSeasonal", { months: forecast.historyMonths })}
      </p>
      <ul className="space-y-2.5">
        {shown.map((e, i) => (
          <li key={e.month} data-forecast-month={e.month}>
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="font-medium">{monthName(e.month)}</span>
              <span className="tabular-nums">
                <span className="font-semibold" data-amount>
                  ~{usd(e.expected)}
                </span>
                {e.high > e.low ? (
                  <span className="ml-1.5 text-xs text-zinc-400" data-amount>
                    {usd(e.low)}–{usd(e.high)}
                  </span>
                ) : null}
              </span>
            </div>
            {/* the range as a pale band, the expected amount as the bar, work so far as a line */}
            <div className="relative mt-1 h-2 rounded-full bg-[var(--edge-soft)]" aria-hidden>
              <div
                className="absolute inset-y-0 rounded-full bg-sky-200 dark:bg-sky-900"
                style={{ left: `${(e.low / top) * 100}%`, width: `${((e.high - e.low) / top) * 100}%` }}
              />
              <div className="absolute inset-y-0 left-0 rounded-full bg-sky-500" style={{ width: `${(e.expected / top) * 100}%`, opacity: 0.85 }} />
              {i === 0 && e.soFar > 0 ? (
                <div className="absolute -inset-y-0.5 w-0.5 rounded bg-emerald-600" style={{ left: `${Math.min(100, (e.soFar / top) * 100)}%` }} />
              ) : null}
            </div>
            <p className="mt-0.5 text-xs text-zinc-400">
              {i === 0 && e.soFar > 0 ? (
                <span className="text-emerald-700 dark:text-emerald-400" data-amount>
                  {t("victvs.forecastSoFar", { amount: usd(e.soFar) })} ·{" "}
                </span>
              ) : null}
              {/* the same months behind each row; the recent-months note once, as it's the same for all */}
              {e.basis === "seasonal"
                ? e.samples.map((s) => `${s.month.slice(0, 4)} ${usd(s.amount)}`).join(" · ")
                : e.basis === "recent" && (i === 0 || shown[i - 1].basis !== "recent")
                  ? t("victvs.forecastFromRecent", { count: e.samples.length })
                  : null}
            </p>
          </li>
        ))}
      </ul>
      {!expanded && rows > initialRows && forecast.earnings.length > initialRows ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex min-h-[44px] w-full items-center justify-center rounded-lg text-sm font-medium text-teal-700 active:bg-[var(--edge-soft)] dark:text-teal-300"
        >
          {t("victvs.forecastMore", { count: rows })}
        </button>
      ) : null}
      <div className="border-t border-[var(--edge-soft)] pt-2 text-xs text-zinc-500">
        <p>
          {forecast.lagDays == null
            ? t("victvs.forecastLagAssumed")
            : t("victvs.forecastLagDays", { days: Math.round(forecast.lagDays) })}
          {forecast.unpaid > 0 ? (
            <>
              {" "}
              <span data-amount>{t("victvs.forecastWaiting", { amount: usd(forecast.unpaid) })}</span>
            </>
          ) : null}
        </p>
        {payouts.length ? (
          <p className="mt-1">
            {t("victvs.forecastPayouts")}:{" "}
            {payouts.map((c, i) => (
              <span key={c.month} data-amount>
                {i > 0 ? " · " : null}
                {monthName(c.month)} ~{usd(c.expected)}
              </span>
            ))}
          </p>
        ) : null}
      </div>
    </div>
  );
}
