"use client";

import { useCallback, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRepo } from "@/lib/data/provider";
import { KEYS, useUserSettings } from "@/lib/data/queries";
import { UserSettings, VictvsForecastSettings } from "@/lib/data/types";
import { todayISO } from "@/lib/domain/recurrence";
import { cleanVictvsOverrides } from "@/lib/domain/victvsForecast";

/** A change to your figures: pure, since it may run twice (see below). */
export type OverridesChange = (overrides: Record<string, number>) => Record<string, number>;

// One key and scope for every save of the figures, wherever it's made from:
// React Query runs mutations that share a scope one after another.
const MUTATION_KEY = ["victvs-forecast-overrides"];
const SCOPE = { id: "victvs-forecast-overrides" };

/** `change` applied to the stored figures, as they're stored again: null once none are left. */
function applied(raw: unknown, change: OverridesChange): VictvsForecastSettings | null {
  const thisMonth = todayISO().slice(0, 7);
  const overrides = cleanVictvsOverrides(change(cleanVictvsOverrides(raw, thisMonth)), thisMonth);
  return Object.keys(overrides).length ? { overrides } : null;
}

/**
 * Your own figures in the VICTVS forecast, cleaned (cleanVictvsOverrides):
 * this month and later only. Empty while settings load, and on a database
 * without migration 0017. The figures are what forecastVictvs takes as
 * `overrides`, so every screen that reads them shows the same forecast.
 */
export function useVictvsOverrides(): Record<string, number> {
  const settings = useUserSettings();
  const raw = settings.data?.victvsForecast?.overrides;
  const thisMonth = todayISO().slice(0, 7);
  return useMemo(() => cleanVictvsOverrides(raw, thisMonth), [raw, thisMonth]);
}

/**
 * Editing those figures, from the VICTVS page and the Planner.
 *
 * update(change) shows `change` at once on what this device has, then
 * re-reads the saved settings, applies `change` to the figures there and
 * saves the result: saveUserSettings replaces victvsForecast whole, so
 * without the re-read a phone with an hour-old cache would put back a month
 * the desktop has reverted since. Saves run one at a time, so two quick
 * edits don't each start from what was there before both. A failed save
 * (a database without 0017 says which file to run) shows the error toast
 * and puts back what the server has. Months already over are dropped on
 * every save; they no longer change anything.
 */
export function useVictvsForecastOverrides() {
  const repo = useRepo();
  const queryClient = useQueryClient();
  const overrides = useVictvsOverrides();

  const save = useMutation({
    mutationKey: MUTATION_KEY,
    scope: SCOPE,
    mutationFn: async (change: OverridesChange) => {
      const fresh = await repo.getUserSettings();
      const next = applied(fresh.victvsForecast?.overrides, change);
      // A change queued behind this one has already shown itself on top of
      // it; the screen waits for that one rather than stepping back a beat.
      if (queryClient.isMutating({ mutationKey: MUTATION_KEY }) <= 1) {
        await queryClient.cancelQueries({ queryKey: KEYS.userSettings });
        queryClient.setQueryData<UserSettings>(KEYS.userSettings, (current) => ({ ...(current ?? fresh), victvsForecast: next }));
      }
      await repo.saveUserSettings({ victvsForecast: next });
    },
    onError: () => queryClient.invalidateQueries({ queryKey: KEYS.userSettings }),
  });

  const { mutate } = save;
  const update = useCallback(
    (change: OverridesChange) => {
      // shown in the same tick; a settings fetch still in flight is stopped
      // first, or it would land on top of the change
      void queryClient.cancelQueries({ queryKey: KEYS.userSettings });
      queryClient.setQueryData<UserSettings>(KEYS.userSettings, (current) =>
        current ? { ...current, victvsForecast: applied(current.victvsForecast?.overrides, change) } : current
      );
      mutate(change);
    },
    [mutate, queryClient]
  );

  const set = useCallback((month: string, amount: number) => update((o) => ({ ...o, [month]: amount })), [update]);
  const revert = useCallback(
    (month: string) =>
      update((o) => {
        const next = { ...o };
        delete next[month];
        return next;
      }),
    [update]
  );
  const revertAll = useCallback(() => update(() => ({})), [update]);

  return { overrides, set, revert, revertAll };
}
