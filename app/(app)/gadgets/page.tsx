"use client";

import { ConverterCard } from "@/components/converterCard";
import { TimersCard } from "@/components/timersCard";
import { useI18n } from "@/lib/i18n";

/**
 * Gadgets: small tools that sit beside the money rather than in it. Date
 * timers (countdowns and counts since, stored per user) and a converter on
 * the app's own live rates. Nothing here touches a balance.
 */
export default function GadgetsPage() {
  const { t } = useI18n();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">{t("gadgets.title")}</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("gadgets.intro")}</p>
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <TimersCard />
        <ConverterCard />
      </div>
    </div>
  );
}
