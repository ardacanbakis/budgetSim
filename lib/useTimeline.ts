"use client";

import { useMemo } from "react";
import { useAccounts, useLoans, usePurchases, useRates, useTemplates, useTransactions } from "@/lib/data/queries";
import { CardBook } from "@/lib/domain/cards";
import { goldRatiosOf } from "@/lib/domain/gold";
import { addMonthsClamped, todayISO } from "@/lib/domain/recurrence";
import { AccountSeries, balanceSeries, buildTimeline, CountsInBalance, TimelineEvent } from "@/lib/domain/timeline";

/** How far ahead the timeline reaches: as far as recurring rows are created. */
export const TIMELINE_MONTHS_AHEAD = 12;
/** How far ahead "lowest point ahead" looks. */
export const LOOKAHEAD_MONTHS = 3;

export interface TimelineData {
  /** every event, oldest first, to the horizon */
  events: TimelineEvent[];
  /** per cash account, by id */
  series: Map<string, AccountSeries>;
  today: string;
  /** the last day the timeline reaches */
  horizon: string;
  /** the last day "lowest point ahead" looks at */
  lookahead: string;
  loading: boolean;
}

/**
 * The timeline from the cached queries, in two memoised stages: the events
 * (rebuilt when the data changes), then the balances (when the events or the
 * `counts` toggle change). Filtering and grouping are the screen's, so a
 * filter change never rebuilds either. Pass the book the screen already has
 * (useTxLookup().book), so one card book serves the page.
 */
export function useTimeline(book: CardBook, counts?: CountsInBalance): TimelineData {
  const accounts = useAccounts();
  const transactions = useTransactions();
  const templates = useTemplates();
  const loans = useLoans();
  const purchases = usePurchases();
  const rates = useRates();
  const today = todayISO();
  const horizon = addMonthsClamped(today, TIMELINE_MONTHS_AHEAD);
  const lookahead = addMonthsClamped(today, LOOKAHEAD_MONTHS);
  const usdPer = rates.data?.usdPer;

  const events = useMemo(
    () =>
      buildTimeline(
        {
          accounts: accounts.data ?? [],
          transactions: transactions.data ?? [],
          templates: templates.data ?? [],
          loans: loans.data ?? [],
          purchases: purchases.data ?? [],
          book,
          usdPer,
        },
        { to: horizon, today }
      ),
    [accounts.data, transactions.data, templates.data, loans.data, purchases.data, book, usdPer, horizon, today]
  );

  const series = useMemo(
    () =>
      balanceSeries({
        accounts: accounts.data ?? [],
        transactions: transactions.data ?? [],
        events,
        today,
        to: horizon,
        goldRatios: goldRatiosOf(rates.data),
        counts,
      }),
    [accounts.data, transactions.data, events, today, horizon, rates.data, counts]
  );

  return {
    events,
    series,
    today,
    horizon,
    lookahead,
    loading: accounts.isLoading || transactions.isLoading,
  };
}
