"use client";

import { Badge, Card, CardHeader, Figure } from "@/components/ui";
import { useApp } from "@/lib/data/provider";
import { useRates } from "@/lib/data/queries";
import { formatAmount } from "@/lib/domain/currencies";
import { convert } from "@/lib/domain/fx";
import { SOURCE_META } from "@/lib/rates/sources";
import { useDashboardData } from "@/lib/useDashboardData";
import { useI18n } from "@/lib/i18n";

/**
 * Net worth priced in gram gold.
 *
 * In Turkey gold is the unit people instinctively measure against, because
 * lira figures flatter you: a portfolio can grow 40% in a year and still buy
 * less metal than it did. Showing the same wealth in grams next to the lira
 * figure makes that visible without anyone having to do the division.
 *
 * Which provider quoted the gram is named on the card, because a number this
 * load-bearing should say where it came from.
 */
export function GoldLensCard() {
  const { t, locale } = useI18n();
  const { displayCurrency } = useApp();
  const rates = useRates();
  const data = useDashboardData(displayCurrency);

  if (!data || !rates.data) return null;
  const usdPer = rates.data.usdPer;
  const gramPrice = usdPer.XAU_G;
  if (!gramPrice) return null;

  const grams = convert(data.netWorth.total, displayCurrency, "XAU_G", usdPer);
  if (grams == null) return null;

  const tryPerGram = usdPer.TRY ? gramPrice / usdPer.TRY : null;
  const source = rates.data.sources?.XAU_G ?? "fallback";
  const meta = SOURCE_META[source];

  return (
    <Card>
      <CardHeader
        title={t("gold.title")}
        action={
          <Badge tone={source === "fallback" ? "amber" : meta?.turkish ? "sky" : "zinc"}>
            {meta?.label ?? source}
          </Badge>
        }
      />
      <div className="px-[var(--ui-card-pad-x)] py-[var(--ui-card-pad-y)]">
        <div className="flex flex-wrap items-baseline gap-3">
          <Figure size="lg">{formatAmount(grams, "XAU_G", locale)}</Figure>
          <span className="text-xs text-zinc-500">{t("gold.ofNetWorth")}</span>
        </div>
        {tryPerGram ? (
          <p className="mt-1 text-xs text-zinc-500">
            {t("gold.gramPrice", { amount: formatAmount(tryPerGram, "TRY", locale) })}
          </p>
        ) : null}
      </div>
    </Card>
  );
}
