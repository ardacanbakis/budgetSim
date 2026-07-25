"use client";

import { useRates } from "@/lib/data/queries";
import { buildTickerItems, formatTickerValue, TickerItem } from "@/lib/domain/ticker";
import { useI18n } from "@/lib/i18n";

/**
 * Scrolling market-rate tape, the way finance channels run one: USD/TRY,
 * EUR/TRY, EUR/USD, BTC and gram gold with their 24h move. Opt-in from
 * Settings → Preferences. The row is duplicated so the marquee can loop
 * seamlessly; the copy is aria-hidden so screen readers read each quote once.
 */
export function RateTicker() {
  const { locale, t } = useI18n();
  const rates = useRates();

  if (!rates.data) return null;
  const items = buildTickerItems(rates.data.usdPer, rates.data.prevUsdPer);
  if (items.length === 0) return null;

  const stale =
    ("stale" in rates.data && rates.data.stale) ||
    Object.values(rates.data.sources).some((s) => s === "fallback");

  return (
    <div
      className="no-print relative flex items-center gap-2 overflow-hidden border-b border-[var(--edge)] bg-[var(--surface)] py-1.5"
      role="marquee"
      aria-label={t("settings.rateTicker")}
    >
      <span className="z-10 shrink-0 border-r border-[var(--edge)] bg-[var(--surface)] px-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
        {stale ? t("common.stale") : t("settings.rateTickerLive")}
      </span>
      <div className="ticker-track flex min-w-max gap-6 pr-6">
        {[0, 1].map((copy) => (
          <div key={copy} className="flex gap-6" aria-hidden={copy === 1}>
            {items.map((item) => (
              <Quote key={`${copy}-${item.id}`} item={item} locale={locale} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function Quote({ item, locale }: { item: TickerItem; locale: string }) {
  const up = item.changePct != null && item.changePct > 0;
  const down = item.changePct != null && item.changePct < 0;
  return (
    <span className="flex items-baseline gap-1.5 whitespace-nowrap text-xs">
      <span className="font-medium text-zinc-500">{item.label}</span>
      <span className="font-semibold tabular-nums">{formatTickerValue(item, locale)}</span>
      {item.changePct != null ? (
        <span className={`tabular-nums ${up ? "text-green-600" : down ? "text-red-600" : "text-zinc-400"}`}>
          {up ? "▲" : down ? "▼" : "▬"} {Math.abs(item.changePct).toFixed(2)}%
        </span>
      ) : null}
    </span>
  );
}
