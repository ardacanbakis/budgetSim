"use client";

import { ReactNode } from "react";
import { AmountPhrase } from "@/components/pocket/paceBar";
import { TransferPrefill } from "@/components/transferModal";
import { Currency, formatAmount } from "@/lib/domain/currencies";
import { Runway } from "@/lib/domain/runway";
import { TimelineEvent } from "@/lib/domain/timeline";
import { useI18n } from "@/lib/i18n";
import { formatSigned } from "@/lib/ui/pocket/format";
import { AMOUNT_SLOT } from "@/lib/ui/pocket/homeSections";
import { shortDay } from "@/lib/ui/timeline";

/**
 * What the Classic and Pocket Timeline tabs both draw the same way: a
 * milestone's words and the flag that marks one, and an expected VICTVS
 * payout's words and the clipboard that marks it; the lira runway callout.
 */

export function FlagGlyph() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 21V4M5 4h11l-2 4 2 4H5" />
    </svg>
  );
}

/** VICTVS's clipboard, as Home's VICTVS row draws it. */
export function ClipboardGlyph() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 3h6v3H9zM9 5H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-3M9 12h6M9 16h4" />
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


/** "$620": a round figure, without its zero cents. */
function wholeAmount(amount: number, currency: Currency, locale: string): string {
  return formatAmount(amount, currency, locale).replace(/[.,]00(?=\D*$)/, "");
}

/** "$650": an expected payout is a guess, so whole dollars. */
export function roughUsd(amount: number, locale: string): string {
  return `$${new Intl.NumberFormat(locale === "tr" ? "tr-TR" : "en-US", { maximumFractionDigits: 0 }).format(amount)}`;
}

/**
 * An expected VICTVS payout's words: "VICTVS · expected ~$650" (the figure
 * alone blurs), and under it the range, what is already worked, where it
 * lands, and whether the balances count it.
 */
export function expectedParts({
  event,
  accountName,
  counted,
}: {
  event: TimelineEvent;
  /** the deposit account's name; null when none is set */
  accountName: string | null;
  counted: boolean;
}): { title: ReactNode; meta: ReactNode } {
  // a plain function returning nodes, so each layout lays them out its own way
  return { title: <ExpectedTitle event={event} />, meta: <ExpectedMeta event={event} accountName={accountName} counted={counted} /> };
}

function ExpectedTitle({ event }: { event: TimelineEvent }) {
  const { t, locale } = useI18n();
  return <AmountPhrase text={t("timeline.expectedVictvs", { amount: AMOUNT_SLOT })} amount={roughUsd(event.amount, locale)} />;
}

function ExpectedMeta({ event, accountName, counted }: { event: TimelineEvent; accountName: string | null; counted: boolean }) {
  const { t, locale } = useI18n();
  const range = event.expected;
  return (
    <>
      {range && range.high - range.low >= 1 ? (
        <>
          <span data-amount className="whitespace-nowrap tabular-nums">
            {roughUsd(range.low, locale)}–{roughUsd(range.high, locale)}
          </span>
          {" · "}
        </>
      ) : null}
      {range && range.earned > 0 ? (
        <>
          <AmountPhrase text={t("timeline.expectedEarned", { amount: AMOUNT_SLOT })} amount={roughUsd(range.earned, locale)} />
          {" · "}
        </>
      ) : null}
      {accountName ?? t("timeline.noVictvsAccount")}
      {counted ? null : ` · ${t("timeline.notCounted")}`}
    </>
  );
}

/**
 * The lira runway (lib/domain/runway.ts) as one callout at the top of the
 * Timeline: when the TRY accounts would run short and what to convert by
 * when, with "Plan this transfer"; or that they cover what's planned.
 * Figures blur under Pocket's Hide amounts.
 */
export function RunwayCallout({
  runway,
  months,
  onPlan,
  className = "",
}: {
  runway: Runway;
  months: number;
  onPlan: (prefill: TransferPrefill) => void;
  className?: string;
}) {
  const { t, locale } = useI18n();
  const short = runway.shortOn != null;
  const hint = runway.hint;
  return (
    <section
      data-runway={short ? "short" : "covered"}
      aria-label={t("timeline.runwayTitle")}
      className={`rounded-[var(--ui-card-radius)] border px-4 py-3 text-sm ${
        short
          ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
          : "border-[var(--edge)] bg-[var(--surface)] text-zinc-600 dark:text-zinc-300"
      } ${className}`}
    >
      {short ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="min-w-0 flex-1">
            {t("timeline.runwayShort", { date: shortDay(runway.shortOn!, locale) })}{" "}
            {hint ? (
              <AmountPhrase
                text={t("timeline.runwayConvert", { amount: AMOUNT_SLOT, date: shortDay(hint.convertBy, locale) })}
                amount={wholeAmount(hint.amount, hint.fromAccount.currency, locale)}
              />
            ) : (
              t("timeline.runwayNoSource")
            )}
          </p>
          {hint ? (
            <button
              type="button"
              aria-haspopup="dialog"
              onClick={() =>
                onPlan({
                  fromId: hint.fromAccount.id,
                  toId: hint.toAccount.id,
                  fromAmount: hint.amount,
                  date: hint.convertBy,
                  description: t("timeline.runwayDescription", { date: shortDay(runway.shortOn!, locale) }),
                })
              }
              className="flex min-h-[44px] shrink-0 items-center rounded-[var(--pocket-chip-radius,0.5rem)] bg-teal-600 px-4 text-sm font-semibold text-white hover:bg-teal-700 dark:bg-teal-500 dark:text-zinc-950"
            >
              {t("timeline.planTransfer")}
            </button>
          ) : null}
        </div>
      ) : (
        <p>
          {t("timeline.runwayCovered", { months })}{" "}
          <span className="text-zinc-500 dark:text-zinc-400">
            <AmountPhrase
              text={t("timeline.runwayLow", { amount: AMOUNT_SLOT, date: shortDay(runway.low.date, locale) })}
              amount={formatSigned(runway.low.balance, "TRY", locale)}
            />
          </span>
        </p>
      )}
    </section>
  );
}
