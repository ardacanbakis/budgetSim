"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RateTable } from "@/lib/domain/fx";
import { FALLBACK_SOURCE, FALLBACK_USD_PER } from "@/lib/rates/fallback";
import { useRepo } from "./provider";

export const KEYS = {
  accounts: ["accounts"] as const,
  categories: ["categories"] as const,
  transactions: ["transactions"] as const,
  templates: ["templates"] as const,
  victvsSessions: ["victvs-sessions"] as const,
  victvsPayouts: ["victvs-payouts"] as const,
  loans: ["loans"] as const,
  purchases: ["purchases"] as const,
  rates: ["rates"] as const,
};

export function useAccounts() {
  const repo = useRepo();
  return useQuery({ queryKey: KEYS.accounts, queryFn: () => repo.listAccounts() });
}

export function useCategories() {
  const repo = useRepo();
  return useQuery({ queryKey: KEYS.categories, queryFn: () => repo.listCategories() });
}

export function useTransactions() {
  const repo = useRepo();
  return useQuery({ queryKey: KEYS.transactions, queryFn: () => repo.listTransactions() });
}

export function useTemplates() {
  const repo = useRepo();
  return useQuery({ queryKey: KEYS.templates, queryFn: () => repo.listTemplates() });
}

export function useVictvsSessions() {
  const repo = useRepo();
  return useQuery({ queryKey: KEYS.victvsSessions, queryFn: () => repo.listVictvsSessions() });
}

export function useVictvsPayouts() {
  const repo = useRepo();
  return useQuery({ queryKey: KEYS.victvsPayouts, queryFn: () => repo.listVictvsPayouts() });
}

export function useLoans() {
  const repo = useRepo();
  return useQuery({ queryKey: KEYS.loans, queryFn: () => repo.listLoans() });
}

export function usePurchases() {
  const repo = useRepo();
  return useQuery({ queryKey: KEYS.purchases, queryFn: () => repo.listPurchases() });
}

/** Live rates from our server (single shared source). Falls back to static rates, flagged stale. */
export function useRates() {
  return useQuery<RateTable & { stale?: boolean }>({
    queryKey: KEYS.rates,
    queryFn: async () => {
      try {
        const res = await fetch("/api/rates");
        if (!res.ok) throw new Error(`rates ${res.status}`);
        return (await res.json()) as RateTable;
      } catch {
        return {
          usdPer: FALLBACK_USD_PER,
          fetchedAt: new Date().toISOString(),
          sources: { USD: FALLBACK_SOURCE },
          stale: true,
        };
      }
    },
    staleTime: 5 * 60_000,
    refetchInterval: 15 * 60_000,
  });
}

/** Mutation helper that invalidates the affected query keys on success. */
export function useAppMutation<TInput>(
  fn: (input: TInput) => Promise<unknown>,
  keys: ReadonlyArray<readonly string[]>
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      await Promise.all(keys.map((key) => queryClient.invalidateQueries({ queryKey: key })));
    },
  });
}
