"use client";

import Link from "next/link";
import { useAccounts, useCardEstimates, useTransactions } from "@/lib/data/queries";
import { buildCardBook, cardPaymentReminders } from "@/lib/domain/cards";
import { formatAmount } from "@/lib/domain/currencies";
import { todayISO } from "@/lib/domain/recurrence";
import { useI18n } from "@/lib/i18n";
import { useFormatDate } from "@/lib/useFormatDate";

/**
 * A quiet line under the header when a card's statement is due tomorrow or
 * today, or is past due and unpaid (cardPaymentReminders, the same rule as the
 * dashboard's reminder). It sits where the rates run because that strip is the
 * thing you glance at, and it links straight to the cards so paying is one hop.
 */
export function CardDueBanner() {
  const { t, locale } = useI18n();
  const fmtDate = useFormatDate();
  const accounts = useAccounts();
  const transactions = useTransactions();
  const estimates = useCardEstimates();

  if (!accounts.data || !transactions.data) return null;
  const book = buildCardBook(accounts.data, transactions.data, estimates.data);
  const due = cardPaymentReminders(accounts.data, book, todayISO());
  if (due.length === 0) return null;

  const first = due[0];
  const amount = formatAmount(first.amount, first.account.currency, locale);
  const overdue = first.when === "overdue";

  return (
    <Link
      href="/cards"
      className={`no-print flex items-center justify-center gap-2 border-b px-4 py-1.5 text-xs ${
        overdue
          ? "border-red-300 bg-red-50 text-red-900 hover:bg-red-100 dark:border-red-800 dark:bg-red-950 dark:text-red-200 dark:hover:bg-red-900"
          : "border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200 dark:hover:bg-amber-900"
      }`}
    >
      <span aria-hidden>💳</span>
      <span className="font-semibold">{first.account.name}</span>
      <span>
        {overdue
          ? t("cards.dueOverdue", { amount, date: fmtDate(first.date) })
          : first.when === "today"
            ? t("cards.dueToday", { amount })
            : t("cards.dueTomorrow", { amount })}
      </span>
      {due.length > 1 ? <span className="opacity-70">{t("cards.andMore", { count: due.length - 1 })}</span> : null}
      <span className="underline">{t("cards.goPay")}</span>
    </Link>
  );
}
