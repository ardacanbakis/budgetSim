"use client";

import { useMemo } from "react";
import { useAccounts, useCardEstimates, useTransactions, useUserSettings } from "@/lib/data/queries";
import { CardBook } from "@/lib/domain/cards";
import {
  buildPlanningBook,
  CardSpendSettings,
  DEFAULT_CARD_SPEND,
  normalizeCardSpend,
  TypicalSpend,
  typicalSpendRows,
} from "@/lib/domain/cardSpend";
import { todayISO } from "@/lib/domain/recurrence";

/**
 * The typical-card-spend setting, and the card book the forward-looking
 * screens read.
 *
 * The setting is stored (and so synced across devices), because it is an
 * assumption about your plan rather than a preference about this screen.
 * Off until turned on: a book built from these while it is off is the same
 * book every screen has always had.
 */
export function useCardSpendSettings(): CardSpendSettings {
  const settings = useUserSettings();
  return useMemo(() => (settings.data ? normalizeCardSpend(settings.data.cardSpend) : DEFAULT_CARD_SPEND), [settings.data]);
}

/** Each open card's typical spend: what was measured, what was set, what counts. */
export function useTypicalSpend(): TypicalSpend[] {
  const accounts = useAccounts();
  const transactions = useTransactions();
  const estimates = useCardEstimates();
  const settings = useCardSpendSettings();
  const today = todayISO();
  return useMemo(() => {
    if (!accounts.data || !transactions.data) return [];
    // measured from the plain book: what a statement was, and the taksit it
    // covered, neither of which typical spend takes part in
    const book = buildPlanningBook({ accounts: accounts.data, transactions: transactions.data, estimates: estimates.data, settings: DEFAULT_CARD_SPEND, today });
    return typicalSpendRows({ accounts: accounts.data, book, transactions: transactions.data, today, settings });
  }, [accounts.data, transactions.data, estimates.data, settings, today]);
}

/**
 * The card book for anything that looks ahead: statements, schedules, the
 * plan. Carries typical spend when the setting asks for it.
 */
export function usePlanningBook(): CardBook | null {
  const accounts = useAccounts();
  const transactions = useTransactions();
  const estimates = useCardEstimates();
  const settings = useCardSpendSettings();
  const today = todayISO();
  return useMemo(() => {
    if (!accounts.data || !transactions.data) return null;
    return buildPlanningBook({ accounts: accounts.data, transactions: transactions.data, estimates: estimates.data, settings, today });
  }, [accounts.data, transactions.data, estimates.data, settings, today]);
}
