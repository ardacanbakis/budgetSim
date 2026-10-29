"use client";

import { useMemo } from "react";
import { useAccounts, usePurchases, useTransactions } from "@/lib/data/queries";
import { buildCardBook } from "@/lib/domain/cards";
import { ViaCard } from "@/lib/domain/debt";

/** What a debt repaid through a card reads its progress from (lib/domain/debt.ts loanProgress); undefined while loading. */
export function useViaCard(): ViaCard | undefined {
  const accounts = useAccounts();
  const transactions = useTransactions();
  const purchases = usePurchases();
  return useMemo(
    () =>
      accounts.data && transactions.data && purchases.data
        ? { purchases: purchases.data, book: buildCardBook(accounts.data, transactions.data) }
        : undefined,
    [accounts.data, transactions.data, purchases.data]
  );
}
