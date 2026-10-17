"use client";

import { Currency } from "@/lib/domain/currencies";
import { useI18n } from "@/lib/i18n";
import { formatSigned } from "@/lib/ui/pocket/format";
import { AMOUNT_SLOT, splitAtSlot } from "@/lib/ui/pocket/homeSections";
import { pace, Pace } from "@/lib/ui/pocket/pace";
import { Money } from "./kit";

/**
 * A budget against the calendar (lib/ui/pocket/pace.ts): a 6px track whose
 * fill is teal while spending keeps pace with the month, amber once it runs
 * ahead and red at the limit, with a tick where today sits in the month.
 *
 * - PaceTrack({ pace, label, valueText }): the bar alone, a role=progressbar
 *   with the whole story in aria-valuetext.
 * - PaceBar({ name, color, spent, limit, currency, today }): a budget's row on
 *   Home: its dot and name, "₺4,200 / ₺6,000", the track, and what is left
 *   per day ("₺120/day for 21 days") or how far over it is.
 * - AmountPhrase({ text, amount }): a sentence translated with AMOUNT_SLOT
 *   for its figure, drawn so only the figure blurs when amounts are hidden.
 */

export function AmountPhrase({ text, amount }: { text: string; amount: string }) {
  const parts = splitAtSlot(text);
  if (!parts) return <>{text}</>;
  return (
    <>
      {parts[0]}
      <span data-amount className="whitespace-nowrap tabular-nums">
        {amount}
      </span>
      {parts[1]}
    </>
  );
}

const FILL = {
  ok: "bg-teal-600 dark:bg-teal-500",
  ahead: "bg-amber-500",
  over: "bg-red-500",
} as const;

export function PaceTrack({ pace: p, label, valueText }: { pace: Pace; label: string; valueText: string }) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(p.fill)}
      aria-valuetext={valueText}
      className="relative h-1.5 rounded-full bg-[var(--edge-soft)]"
    >
      <div className={`h-full rounded-full ${FILL[p.tone]}`} style={{ width: `${p.fill}%` }} />
      <span
        aria-hidden
        className="absolute -top-[3px] h-3 w-0.5 rounded-full bg-zinc-500 dark:bg-zinc-400"
        style={{ left: `calc(${p.elapsedPct}% - 1px)` }}
      />
    </div>
  );
}

export function PaceBar({
  name,
  color,
  spent,
  limit,
  currency,
  today,
}: {
  name: string;
  color?: string | null;
  spent: number;
  limit: number;
  currency: Currency;
  today: string;
}) {
  const { t, locale } = useI18n();
  const p = pace({ spent, limit, today });
  const plain = (amount: number) => formatSigned(amount, currency, locale, "none");
  const overLimit = spent - limit > 0.005;
  const caption = overLimit
    ? { text: t("pocket.home.over", { amount: AMOUNT_SLOT }), amount: plain(p.over) }
    : p.daysLeft === 1
      ? { text: t("pocket.home.perDayOne", { amount: AMOUNT_SLOT }), amount: plain(p.perDay) }
      : { text: t("pocket.home.perDay", { amount: AMOUNT_SLOT, count: p.daysLeft }), amount: plain(p.perDay) };
  const valueText = t("pocket.home.paceLabel", {
    spent: plain(spent),
    limit: plain(limit),
    elapsed: Math.round(p.elapsedPct),
  });

  return (
    <div className="py-2">
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color ?? "#71717a" }} />
          <span className="truncate text-[15px] font-medium">{name}</span>
        </span>
        <span className="shrink-0 whitespace-nowrap text-[13px] tabular-nums">
          <Money amount={spent} currency={currency} sign="none" className="font-semibold" />
          <span className="text-zinc-400"> / </span>
          <Money amount={limit} currency={currency} sign="none" className="text-zinc-500 dark:text-zinc-400" />
        </span>
      </div>
      <div className="mt-2">
        <PaceTrack pace={p} label={name} valueText={valueText} />
      </div>
      <p className={`mt-1.5 truncate text-xs ${overLimit ? "text-red-600 dark:text-red-400" : "text-zinc-500 dark:text-zinc-400"}`}>
        <AmountPhrase text={caption.text} amount={caption.amount} />
      </p>
    </div>
  );
}
