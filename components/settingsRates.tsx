"use client";

import { Badge, Card, CardHeader, Field, Select } from "@/components/ui";
import { useApp } from "@/lib/data/provider";
import { useRates } from "@/lib/data/queries";
import { CURRENCIES, Currency, formatAmount } from "@/lib/domain/currencies";
import {
  FX_SOURCES,
  FxSourceId,
  GOLD_SOURCES,
  GoldSourceId,
  SOURCE_META,
} from "@/lib/rates/sources";
import { useI18n } from "@/lib/i18n";

/**
 * Where the numbers come from, and — just as importantly — where they actually
 * came from this time.
 *
 * A provider picker on its own is a promise; the diagnostic underneath is the
 * receipt. Without it, "my gold looks wrong" has no way to distinguish a
 * provider that changed shape from one that is merely rate-limited, and the
 * only person who can tell them apart is whoever can read the server logs.
 */
export function RateSourcesCard() {
  const { t, locale } = useI18n();
  const { ratePrefs, setRatePrefs } = useApp();
  const rates = useRates();

  const table = rates.data;
  const diagnostics = table?.diagnostics ?? [];
  const stale = Boolean(table && (("stale" in table && table.stale) || Object.values(table.sources).some((s) => s === "fallback")));

  const label = (id: string) => SOURCE_META[id]?.label ?? id;

  /**
   * Quote each thing the way it is actually quoted. A currency is "lira per
   * dollar"; an asset is the price of one unit. Running everything through
   * "per USD" is arithmetically fine and practically useless — it renders gram
   * gold as "0.01 g", which is a number nobody has ever looked up.
   */
  const price = (c: Currency): string => {
    const unit = table?.usdPer?.[c];
    if (!unit) return "—";
    if (c === "TRY" || c === "EUR") return formatAmount(1 / unit, c, locale);
    // gram gold is quoted in lira on every Turkish board, so quote it that way
    if (c === "XAU_G" && table?.usdPer?.TRY) {
      return formatAmount(unit / table.usdPer.TRY, "TRY", locale);
    }
    return formatAmount(unit, "USD", locale);
  };

  return (
    <Card>
      <CardHeader
        title={t("rates.title")}
        action={stale ? <Badge tone="amber">{t("common.stale")}</Badge> : <Badge tone="green">{t("rates.live")}</Badge>}
      />
      <div className="space-y-3 p-4">
        <p className="text-xs text-zinc-500">{t("rates.hint")}</p>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("rates.goldSource")} hint={t("rates.goldHint")}>
            <Select
              value={ratePrefs.gold}
              onChange={(e) => setRatePrefs({ ...ratePrefs, gold: e.target.value as GoldSourceId })}
            >
              {GOLD_SOURCES.map((id) => (
                <option key={id} value={id}>
                  {id === "auto" ? t("rates.auto") : label(id)}
                  {SOURCE_META[id]?.needsKey ? ` — ${t("rates.needsKey")}` : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("rates.fxSource")} hint={t("rates.fxHint")}>
            <Select
              value={ratePrefs.fx}
              onChange={(e) => setRatePrefs({ ...ratePrefs, fx: e.target.value as FxSourceId })}
            >
              {FX_SOURCES.map((id) => (
                <option key={id} value={id}>
                  {id === "auto" ? t("rates.auto") : label(id)}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {/* what each currency is actually priced from right now */}
        <div className="overflow-x-auto rounded-lg border border-[var(--edge)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--edge-soft)] text-left text-xs text-zinc-500">
                <th className="px-3 py-2 font-medium">{t("common.currency")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("rates.price")}</th>
                <th className="px-3 py-2 font-medium">{t("rates.servedBy")}</th>
              </tr>
            </thead>
            <tbody>
              {CURRENCIES.filter((c) => c !== "USD").map((c) => {
                const source = table?.sources?.[c as Currency] ?? "fallback";
                return (
                  <tr key={c} className="border-b border-[var(--edge-soft)] last:border-0">
                    <td className="px-3 py-1.5">{c === "XAU_G" ? t("rates.gramGold") : c}</td>
                    <td className="px-3 py-1.5 text-right tnum">{price(c as Currency)}</td>
                    <td className="px-3 py-1.5">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className={source === "fallback" ? "text-amber-600" : ""}>{label(source)}</span>
                        {SOURCE_META[source]?.turkish ? <Badge tone="sky">{t("rates.turkish")}</Badge> : null}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {diagnostics.length > 0 ? (
          <details className="rounded-lg border border-[var(--edge)] p-3">
            <summary className="cursor-pointer text-sm font-medium">{t("rates.attempts")}</summary>
            <ul className="mt-2 space-y-1 text-xs">
              {diagnostics.map((d, i) => (
                <li key={`${d.kind}-${d.source}-${i}`} className="flex flex-wrap items-baseline gap-2">
                  <span aria-hidden className={d.ok ? "text-emerald-600" : "text-red-600"}>
                    {d.ok ? "✓" : "✕"}
                  </span>
                  <span className="font-medium">{label(d.source)}</span>
                  <span className="text-zinc-400">{t(`rates.kind_${d.kind}`)}</span>
                  {d.asOf ? <span className="text-zinc-500">{d.asOf}</span> : null}
                  {d.detail ? <span className="text-red-600 dark:text-red-400">{d.detail}</span> : null}
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        {table ? (
          <p className="text-xs text-zinc-400">
            {t("common.ratesUpdated")} {new Date(table.fetchedAt).toLocaleString(locale)}
          </p>
        ) : null}
      </div>
    </Card>
  );
}
