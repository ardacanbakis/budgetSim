"use client";

import Link from "next/link";
import { MonthInOut } from "@/components/dashboardCards";
import { ForecastFlow } from "@/components/forecastFlow";
import { RealTermsCard } from "@/components/realTermsCard";
import { PocketPage, Section } from "./kit";
import { useI18n } from "@/lib/i18n";

/**
 * The Plan on a phone: the three things you look at away from a desk —
 * where this month's money goes, whether each bill is covered on the day it
 * leaves, and what the tail really costs.
 *
 * Not the whole Forecast. Scenarios, the devaluation assumption, the
 * funding order and the chart are a desk job: they are a canvas you arrange
 * and argue with, and shrinking that to a phone would make it worse rather
 * than smaller. Each card here is the same component the Plan page draws,
 * so the two can never disagree, and the page says plainly what is missing
 * and where to find it.
 */
export function PocketPlan() {
  const { t } = useI18n();
  return (
    <PocketPage title={t("pages.forecast")}>
      <Section title={t("dashboard.card_month-top")}>
        <MonthInOut />
      </Section>

      <Section title={t("flow.title")}>
        <ForecastFlow />
      </Section>

      <Section title={t("realTerms.title")}>
        <RealTermsCard />
      </Section>

      <p className="px-1 text-xs text-zinc-500">
        {t("flow.pocketRest")}{" "}
        <Link href="/planner?tab=evim" className="text-teal-600 hover:underline">
          {t("nav.savings")}
        </Link>
        {" · "}
        <Link href="/planner?tab=loan" className="text-teal-600 hover:underline">
          {t("pages.loanSimulator")}
        </Link>
      </p>
    </PocketPage>
  );
}
