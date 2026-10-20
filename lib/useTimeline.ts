"use client";

import { useMemo } from "react";
import {
  useAccounts,
  useLoans,
  usePurchases,
  useRates,
  useTemplates,
  useTransactions,
  useUserSettings,
  useVictvsPayouts,
  useVictvsSessions,
} from "@/lib/data/queries";
import { CardBook } from "@/lib/domain/cards";
import { goldRatiosOf } from "@/lib/domain/gold";
import { addMonthsClamped, todayISO } from "@/lib/domain/recurrence";
import { AccountSeries, balanceSeries, buildTimeline, expectedVictvsEvents, TimelineEvent } from "@/lib/domain/timeline";
import { forecastVictvs } from "@/lib/domain/victvsForecast";

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

const isExpected = (e: TimelineEvent) => e.kind === "expected";

/**
 * The timeline from the cached queries, in two memoised stages: the events
 * (rebuilt when the data changes), then the balances (when the events or
 * `countExpected` change). Filtering and grouping are the screen's, so a
 * filter change never rebuilds either. Pass the book the screen already has
 * (useTxLookup().book), so one card book serves the page.
 *
 * Expected VICTVS payouts come from the VICTVS forecast (forecastVictvs),
 * into the deposit account in Settings; they move the balances only with
 * `countExpected` (the "Count expected VICTVS" switch, off by default).
 */
export function useTimeline(book: CardBook, countExpected = false): TimelineData {
  const accounts = useAccounts();
  const transactions = useTransactions();
  const templates = useTemplates();
  const loans = useLoans();
  const purchases = usePurchases();
  const rates = useRates();
  const sessions = useVictvsSessions();
  const payouts = useVictvsPayouts();
  const settings = useUserSettings();
  const today = todayISO();
  const horizon = addMonthsClamped(today, TIMELINE_MONTHS_AHEAD);
  const lookahead = addMonthsClamped(today, LOOKAHEAD_MONTHS);
  const usdPer = rates.data?.usdPer;

  const victvsAccountId = settings.data?.victvsAccountId ?? null;
  const expected = useMemo(() => {
    if (!sessions.data || !payouts.data) return [];
    const forecast = forecastVictvs({ sessions: sessions.data, payouts: payouts.data, today, months: TIMELINE_MONTHS_AHEAD + 1 });
    return expectedVictvsEvents({
      forecast,
      payoutDates: payouts.data.map((p) => p.paymentDate),
      accountId: victvsAccountId,
      accounts: accounts.data ?? [],
      today,
      usdPer,
    });
  }, [sessions.data, payouts.data, victvsAccountId, accounts.data, today, usdPer]);

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
          expected,
        },
        { to: horizon, today }
      ),
    [accounts.data, transactions.data, templates.data, loans.data, purchases.data, book, usdPer, expected, horizon, today]
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
        counts: countExpected ? isExpected : undefined,
      }),
    [accounts.data, transactions.data, events, today, horizon, rates.data, countExpected]
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
