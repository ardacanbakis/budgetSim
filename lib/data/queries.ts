"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RateTable } from "@/lib/domain/fx";
import { isStaleTable } from "@/lib/rates/fallback";
import { loadRateTable } from "@/lib/rates/loadRateTable";
import { useApp, useRepo } from "./provider";

export const KEYS = {
  accounts: ["accounts"] as const,
  categories: ["categories"] as const,
  transactions: ["transactions"] as const,
  templates: ["templates"] as const,
  victvsSessions: ["victvs-sessions"] as const,
  victvsPayouts: ["victvs-payouts"] as const,
  loans: ["loans"] as const,
  purchases: ["purchases"] as const,
  budgets: ["budgets"] as const,
  goals: ["goals"] as const,
  userSettings: ["user-settings"] as const,
  snapshots: ["snapshots"] as const,
  plans: ["plans"] as const,
  savingsPlans: ["savingsPlans"] as const,
  rates: ["rates"] as const,
};

export function useAccounts() {
  const repo = useRepo();
  return useQuery({ queryKey: KEYS.accounts, queryFn: () => repo.listAccounts() });
}

export function usePlans() {
  const repo = useRepo();
  return useQuery({ queryKey: KEYS.plans, queryFn: () => repo.listPlans() });
}

export function useSavingsPlans() {
  const repo = useRepo();
  return useQuery({ queryKey: KEYS.savingsPlans, queryFn: () => repo.listSavingsPlans() });
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

export function useBudgets() {
  const repo = useRepo();
  return useQuery({ queryKey: KEYS.budgets, queryFn: () => repo.listBudgets() });
}

export function useGoals() {
  const repo = useRepo();
  return useQuery({ queryKey: KEYS.goals, queryFn: () => repo.listGoals() });
}

export function useUserSettings() {
  const repo = useRepo();
  return useQuery({ queryKey: KEYS.userSettings, queryFn: () => repo.getUserSettings() });
}

export function useSnapshots() {
  const repo = useRepo();
  return useQuery({ queryKey: KEYS.snapshots, queryFn: () => repo.listSnapshots() });
}

/**
 * Live rates from our server (single shared source). A failed refetch keeps
 * the last good table; the static fallback, flagged stale, only stands in
 * when none has arrived yet (see loadRateTable).
 */
export function useRates() {
  // The chosen providers are part of the identity of the answer: switching
  // gold from Truncgil to GenelPara has to refetch, not hand back the cached
  // numbers from the other one.
  const { ratePrefs } = useApp();
  const queryClient = useQueryClient();
  return useQuery<RateTable>({
    queryKey: [...KEYS.rates, ratePrefs.gold, ratePrefs.fx],
    queryFn: ({ queryKey }) =>
      loadRateTable(async () => {
        const params = new URLSearchParams({ gold: ratePrefs.gold, fx: ratePrefs.fx });
        const res = await fetch(`/api/rates?${params}`);
        if (!res.ok) throw new Error(`rates ${res.status}`);
        return (await res.json()) as RateTable;
      }, queryClient.getQueryData<RateTable>(queryKey)),
    // a stale table holds back auto-complete and the net-worth snapshot (see
    // the Bootstrapper), so it's retried on the next focus and every minute
    // rather than sitting there for the usual 5 to 15
    staleTime: (query) => (query.state.data && isStaleTable(query.state.data) ? 0 : 5 * 60_000),
    refetchInterval: (query) => (query.state.data && isStaleTable(query.state.data) ? 60_000 : 15 * 60_000),
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
