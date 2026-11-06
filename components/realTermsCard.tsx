"use client";

import { useMemo, useState } from "react";
import { Badge, EmptyState, Input, Spinner } from "@/components/ui";
import { useTxLookup } from "@/components/pocket/dayList";
import { useAccounts } from "@/lib/data/queries";
import { CURRENCIES, Currency, formatAmount } from "@/lib/domain/currencies";
import { addMonthsClamped } from "@/lib/domain/recurrence";
import { realTerms, realTermsByLabel, RealTermsGroup, recentAnnualInflationPct } from "@/lib/domain/realTerms";
import { TimelineEvent } from "@/lib/domain/timeline";
import { useFormatDate } from "@/lib/useFormatDate";
import { useI18n } from "@/lib/i18n";
import { useTimeline } from "@/lib/useTimeline";

/**
 * What the months ahead cost in today's money.
 *
 * A twelve-month taksit at 0% is not a loan at 0%. In a currency losing a
 * quarter of its value a year the last instalment is paid in much cheaper
 * lira, so the nominal tail every other screen adds up is the dearest way
 * to read the debt. This card shows both figures together — not to make the
 * debt look smaller, but because the nominal total cannot tell a debt worth
 * clearing early from one that is cheap to carry, and this can.
 *
 * It reads the same timeline as everything else, so a statement sits on its
 * card's payment day and a loan instalment on its own.
 */

const HORIZONS = [12, 24, 36] as const;
type Horizon = (typeof HORIZONS)[number];

const GROUP_KEY: Record<RealTermsGroup, string> = {
  card: "realTerms.groupCards",
  debt: "realTerms.groupDebts",
  other: "realTerms.groupOther",
};

const isExpected = (e: TimelineEvent) => e.kind === "expected";

export function RealTermsCard() {
  const { t, locale } = useI18n();
  const fmtDate = useFormatDate();
  const accounts = useAccounts();
  const lookup = useTxLookup();
  const timeline = useTimeline(lookup.book, false);
  const measured = useMemo(() => recentAnnualInflationPct(), []);
  const [pct, setPct] = useState<string>(() => String(measured ?? 25));
  const [months, setMonths] = useState<Horizon>(24);
  const [currency, setCurrency] = useState<Currency>("TRY");

  const annualPct = Number(pct);
  const valid = Number.isFinite(annualPct) && annualPct >= 0 && annualPct < 1000;
  const accountList = useMemo(() => accounts.data ?? [], [accounts.data]);
  const to = addMonthsClamped(timeline.today, months);

  const result = useMemo(
    () =>
      realTerms({
        events: timeline.events,
        accounts: accountList,
        today: timeline.today,
        to,
        annualPct: valid ? annualPct : 0,
        currency,
        counts: isExpected,
      }),
    [timeline.events, accountList, timeline.today, to, annualPct, valid, currency]
  );
  const lines = useMemo(() => realTermsByLabel(result), [result]);

  const offered = useMemo(
    () => CURRENCIES.filter((c) => accountList.some((a) => a.kind === "fiat" && !a.archived && a.currency === c)),
    [accountList]
  );
  const money = (n: number) => formatAmount(n, currency, locale);

  if (timeline.loading) return <Spinner />;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
          {t("realTerms.rate")}
          <Input
            type="number"
            step="any"
            min="0"
            inputMode="decimal"
            value={pct}
            onChange={(e) => setPct(e.target.value)}
            className="w-20"
            data-real-rate
          />
          %
        </label>
        <div role="group" aria-label={t("flow.horizon")} className="flex rounded-lg border border-[var(--edge)] p-0.5">
          {HORIZONS.map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={months === n}
              onClick={() => setMonths(n)}
              className={`rounded-md px-2 py-1 text-xs tnum transition-colors ${
                months === n
                  ? "bg-teal-600 text-white dark:bg-teal-500 dark:text-zinc-950"
                  : "text-zinc-500 hover:bg-[var(--edge-soft)]"
              }`}
            >
              {t("cards.matrixMonths", { count: n })}
            </button>
          ))}
        </div>
        {offered.length > 1 ? (
          <div role="group" aria-label={t("flow.currency")} className="flex rounded-lg border border-[var(--edge)] p-0.5">
            {offered.map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={currency === c}
                onClick={() => setCurrency(c)}
                className={`rounded-md px-2 py-1 text-xs transition-colors ${
                  currency === c
                    ? "bg-teal-600 text-white dark:bg-teal-500 dark:text-zinc-950"
                    : "text-zinc-500 hover:bg-[var(--edge-soft)]"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {measured != null ? (
        <p className="text-xs text-zinc-500">{t("realTerms.measured", { pct: measured.toFixed(1) })}</p>
      ) : null}

      {result.rows.length === 0 ? (
        <EmptyState>{t("realTerms.empty")}</EmptyState>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 text-center" data-real-totals>
            <Figure label={t("realTerms.nominal")} value={money(result.totals.nominal)} />
            <Figure label={t("realTerms.real")} value={money(result.totals.real)} tone="pos" />
            <Figure label={t("realTerms.saved")} value={money(result.totals.saved)} />
          </div>
          <p className="text-xs text-zinc-500">{t("realTerms.hint")}</p>

          <div className="overflow-x-auto">
            <table className="stack-sm w-full text-sm" data-real-lines>
              <thead>
                <tr className="border-b border-[var(--edge)] text-left text-xs text-zinc-500">
                  <th className="px-2 py-2 font-medium">{t("realTerms.commitment")}</th>
                  <th className="px-2 py-2 text-right font-medium">{t("realTerms.payments")}</th>
                  <th className="px-2 py-2 text-right font-medium">{t("realTerms.nominal")}</th>
                  <th className="px-2 py-2 text-right font-medium">{t("realTerms.real")}</th>
                  <th className="px-2 py-2 text-right font-medium">{t("realTerms.saved")}</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={`${line.group}:${line.label}`} className="border-b border-[var(--edge-soft)]" data-real-line={line.label}>
                    <th scope="row" className="px-2 py-1.5 text-left font-medium" data-label={t("realTerms.commitment")}>
                      <span className="flex flex-wrap items-center gap-2">
                        {line.label}
                        <Badge tone={line.group === "card" ? "amber" : line.group === "debt" ? "sky" : "zinc"}>
                          {t(GROUP_KEY[line.group])}
                        </Badge>
                      </span>
                      <span className="block text-xs font-normal text-zinc-400">
                        {fmtDate(line.from)} → {fmtDate(line.to)}
                      </span>
                    </th>
                    <td className="px-2 py-1.5 text-right tnum text-zinc-500" data-label={t("realTerms.payments")}>
                      {line.count}
                    </td>
                    <td className="px-2 py-1.5 text-right tnum text-zinc-500" data-label={t("realTerms.nominal")}>
                      {money(line.totals.nominal)}
                    </td>
                    <td className="px-2 py-1.5 text-right font-medium tnum" data-label={t("realTerms.real")}>
                      {money(line.totals.real)}
                    </td>
                    <td className="px-2 py-1.5 text-right tnum text-emerald-600" data-label={t("realTerms.saved")}>
                      {money(line.totals.saved)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: "pos" }) {
  return (
    <div>
      <div className="text-xs text-zinc-500">{label}</div>
      <div className={`text-sm font-semibold tnum ${tone === "pos" ? "text-emerald-600" : ""}`}>{value}</div>
    </div>
  );
}
