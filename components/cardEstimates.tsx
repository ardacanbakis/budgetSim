"use client";

import { FormEvent, useState } from "react";
import { Button, Field, Input, Select } from "@/components/ui";
import { useRepo } from "@/lib/data/provider";
import { KEYS, useAppMutation } from "@/lib/data/queries";
import type { Account, CardEstimate } from "@/lib/data/types";
import { CardBook, CardStatement, estimateTopUps } from "@/lib/domain/cards";
import { formatAmount } from "@/lib/domain/currencies";
import { roundTo } from "@/lib/domain/money";
import { addMonthsClamped, todayISO } from "@/lib/domain/recurrence";
import { useI18n } from "@/lib/i18n";
import { useFormatDate } from "@/lib/useFormatDate";

const ESTIMATE_KEYS = [KEYS.cardEstimates];
/** how far ahead a bank's app shows a card's installments */
const MONTHS_AHEAD = 12;

function useMonthLabel() {
  const { locale } = useI18n();
  return (month: string) =>
    new Date(`${month}-01T00:00:00`).toLocaleDateString(locale === "tr" ? "tr-TR" : "en-US", { month: "long", year: "numeric" });
}

/**
 * What you expect a card's coming statements to be, as your bank's app shows
 * them: note a month's total and the day you saw it. Noting a month again
 * keeps the earlier note as history. Until a month's payment is recorded the
 * plan pays the larger of this and the charges tracked (lib/domain/cards.ts).
 */
export function CardEstimatesEditor({ card, book, className = "" }: { card: Account; book: CardBook; className?: string }) {
  const { t, locale } = useI18n();
  const fmtDate = useFormatDate();
  const monthLabel = useMonthLabel();
  const repo = useRepo();
  const today = todayISO();
  const thisMonth = today.slice(0, 7);
  const months = Array.from({ length: MONTHS_AHEAD }, (_, i) => addMonthsClamped(`${thisMonth}-01`, i).slice(0, 7));
  const [month, setMonth] = useState(addMonthsClamped(`${thisMonth}-01`, 1).slice(0, 7));
  const [amount, setAmount] = useState("");
  const [notedOn, setNotedOn] = useState(today);
  const add = useAppMutation((input: Omit<CardEstimate, "id" | "createdAt">) => repo.addCardEstimate(input), ESTIMATE_KEYS);
  const remove = useAppMutation((id: string) => repo.deleteCardEstimate(id), ESTIMATE_KEYS);
  const money = (n: number) => formatAmount(n, card.currency, locale);

  // what's tracked in each month, so the note can be read against it
  const topUps = new Map(estimateTopUps(book, card.id, thisMonth).map((u) => [u.month, u.amount]));
  const ahead = [...new Set(book.estimates(card.id).map((e) => e.month))].filter((m) => m >= thisMonth).sort();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const value = roundTo(Number(amount) || 0, card.currency);
    if (!(value >= 0) || amount.trim() === "") return;
    await add.mutateAsync({ accountId: card.id, month, amount: value, notedOn: notedOn || today });
    setAmount("");
  };

  return (
    <section className={`space-y-3 ${className}`} data-card-estimates={card.name}>
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">{t("cards.expectedTitle")}</h3>
        <p className="mt-1 text-xs text-zinc-500">{t("cards.expectedHint")}</p>
      </div>
      <form onSubmit={submit} className="grid grid-cols-2 items-end gap-2 sm:grid-cols-[1.2fr_1fr_1fr_auto]">
        <Field label={t("cards.expectedMonth")}>
          <Select value={month} onChange={(e) => setMonth(e.target.value)}>
            {months.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={`${t("cards.expectedAmount")} (${card.currency})`}>
          <Input type="number" step="any" min="0" inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label={t("cards.notedOn")}>
          <Input type="date" required value={notedOn} max={today} onChange={(e) => setNotedOn(e.target.value)} />
        </Field>
        <Button type="submit" variant="primary" disabled={add.isPending}>
          {t("cards.noteIt")}
        </Button>
      </form>
      {ahead.length > 0 ? (
        <ul className="divide-y divide-[var(--edge-soft)] rounded-lg border border-[var(--edge)]">
          {ahead.map((m) => {
            const notes = book.estimates(card.id).filter((e) => e.month === m);
            const latest = notes[notes.length - 1];
            const earlier = notes.slice(0, -1).reverse();
            const recorded = book.payments(card.id).some((p) => p.date.slice(0, 7) === m);
            const extra = topUps.get(m) ?? 0;
            return (
              <li key={m} className="flex items-start justify-between gap-2 px-3 py-2 text-sm" data-estimate-month={m}>
                <div className="min-w-0">
                  <div className="font-medium">{monthLabel(m)}</div>
                  <div className="text-xs text-zinc-500">
                    {recorded
                      ? t("cards.expectedRecorded")
                      : extra > 0
                        ? t("cards.expectedAbove", { amount: money(extra) })
                        : t("cards.expectedCovered")}
                  </div>
                  {earlier.length > 0 ? (
                    <div className="text-[11px] text-zinc-400">
                      {t("cards.expectedEarlier", { list: earlier.map((e) => `${money(e.amount)} (${fmtDate(e.notedOn)})`).join(", ") })}
                    </div>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <div className="text-right">
                    <div className="font-semibold tabular-nums">{money(latest.amount)}</div>
                    <div className="text-[11px] text-zinc-400">{t("cards.notedShort", { date: fmtDate(latest.notedOn) })}</div>
                  </div>
                  <Button
                    variant="ghost"
                    aria-label={t("common.delete")}
                    title={t("common.delete")}
                    onClick={() => window.confirm(t("common.confirmDelete")) && remove.mutate(latest.id)}
                  >
                    ✕
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}

/**
 * A statement read against what you expected: a month still to pay says
 * what's expected and what's tracked; one paid says how far it came from the
 * expectation noted before it.
 */
export function EstimateLine({ statement, currency }: { statement: CardStatement; currency: Account["currency"] }) {
  const { t, locale } = useI18n();
  const fmtDate = useFormatDate();
  const { estimate } = statement;
  if (!estimate) return null;
  const money = (n: number) => formatAmount(n, currency, locale);
  const expected = t("cards.expectedLine", { amount: money(estimate.amount), date: fmtDate(estimate.notedOn) });
  if (statement.payments.length === 0) {
    return (
      <p className="mt-1 text-xs text-zinc-500" data-estimate-line>
        {expected} · {t("cards.trackedLine", { amount: money(statement.tracked) })}
      </p>
    );
  }
  const diff = roundTo(statement.amount - estimate.amount, currency);
  return (
    <p className={`mt-1 text-xs ${diff > 0 ? "text-amber-600" : "text-zinc-500"}`} data-estimate-line>
      {expected} ·{" "}
      {Math.abs(diff) < 0.005
        ? t("cards.vsSame")
        : diff > 0
          ? t("cards.vsMore", { amount: money(diff) })
          : t("cards.vsLess", { amount: money(-diff) })}
    </p>
  );
}
