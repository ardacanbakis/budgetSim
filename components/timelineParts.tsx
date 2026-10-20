"use client";

import { ReactNode } from "react";
import { AmountPhrase } from "@/components/pocket/paceBar";
import { TimelineEvent } from "@/lib/domain/timeline";
import { useI18n } from "@/lib/i18n";
import { formatSigned } from "@/lib/ui/pocket/format";
import { AMOUNT_SLOT } from "@/lib/ui/pocket/homeSections";

/**
 * What the Classic and Pocket Timeline tabs both draw the same way: a
 * milestone's words, and the flag that marks one.
 */

export function FlagGlyph() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 21V4M5 4h11l-2 4 2 4H5" />
    </svg>
  );
}

/** "Car loan: last payment", and what it frees each month (the figure alone blurs under Hide amounts). */
export function useMilestoneText(): (event: TimelineEvent) => { title: string; frees: ReactNode | null } {
  const { t, locale } = useI18n();
  return (event) => {
    const m = event.milestone!;
    const title =
      m.what === "loan"
        ? t("timeline.loanEnds", { name: m.name })
        : m.what === "purchase"
          ? t("timeline.purchaseEnds", { name: m.name })
          : t("timeline.templateEnds", { name: m.name });
    if (m.frees == null || m.currency == null) return { title, frees: null };
    const amount = formatSigned(m.frees, m.currency, locale, "none");
    const key =
      m.direction === "income"
        ? "timeline.incomeEnds"
        : m.frequency === "weekly"
          ? "timeline.freesWeekly"
          : m.frequency === "yearly"
            ? "timeline.freesYearly"
            : "timeline.freesMonthly";
    return { title, frees: <AmountPhrase text={t(key, { amount: AMOUNT_SLOT })} amount={amount} /> };
  };
}

