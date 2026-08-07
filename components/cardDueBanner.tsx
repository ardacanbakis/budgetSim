"use client";

import Link from "next/link";
import { useAccounts, useTransactions } from "@/lib/data/queries";
import { computeBalances } from "@/lib/domain/balances";
import { formatAmount } from "@/lib/domain/currencies";
import { cardsDueSoon, cardStandings } from "@/lib/domain/purchases";
import { todayISO } from "@/lib/domain/recurrence";
import { useI18n } from "@/lib/i18n";

/**
 * A quiet line under the header when a card's payment day is on you. It sits
 * where the rates run because that strip is the thing you glance at, and it
 * links straight to the card so confirming the payment is one hop.
 */
export function CardDueBanner() {
  const { t, locale } = useI18n();
  const accounts = useAccounts();
  const transactions = useTransactions();

  if (!accounts.data || !transactions.data) return null;
  const balances = computeBalances(accounts.data, transactions.data);
  const due = cardsDueSoon(cardStandings(accounts.data, balances, transactions.data, todayISO()));
  if (due.length === 0) return null;

  const first = due[0];
  const days = first.daysToDue ?? 0;

  return (
    <Link
      href="/cards"
      className="no-print flex items-center justify-center gap-2 border-b border-amber-300 bg-amber-50 px-4 py-1.5 text-xs text-amber-900 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200 dark:hover:bg-amber-900"
    >
      <span aria-hidden>💳</span>
      <span className="font-semibold">{first.account.name}</span>
      <span>
        {days <= 0
          ? t("cards.dueToday", {
              amount: formatAmount(first.postedDebt, first.account.currency, locale),
            })
          : t("cards.dueInDays", {
              count: days,
              amount: formatAmount(first.postedDebt, first.account.currency, locale),
            })}
      </span>
      {due.length > 1 ? <span className="opacity-70">{t("cards.andMore", { count: due.length - 1 })}</span> : null}
      <span className="underline">{t("cards.goPay")}</span>
    </Link>
  );
}
