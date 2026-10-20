"use client";

import { useCallback, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { visibleNav } from "@/components/shell.nav";
import { useRepo } from "@/lib/data/provider";
import { KEYS, useAccounts, useUserSettings } from "@/lib/data/queries";
import { Account, UserSettings } from "@/lib/data/types";
import { NormalizedLayout, normalizeLayout } from "./dashboardLayout";

/** A change to the layout: pure, since it may run twice (see below). */
export type LayoutChange = (layout: NormalizedLayout) => NormalizedLayout;

// One key and scope for every save of the layout, wherever it's made from:
// React Query runs mutations that share a scope one after another.
const MUTATION_KEY = ["dashboard-layout"];
const SCOPE = { id: "dashboard-layout" };

/**
 * The dashboard layout (lib/ui/dashboardLayout.ts) as every screen that
 * changes it reads it: Classic's edit mode, Settings, Pocket's account rows.
 *
 * - layout: the saved layout normalised, or null while settings load.
 *   Reading never writes: a layout nobody has changed stays null in storage.
 * - navHrefs: the pages the menus show, for the cards that follow a page.
 * - update(change): shows `change` at once on what this device has, then
 *   re-reads the saved settings, normalises them, applies `change` to that
 *   and saves the whole layout. saveUserSettings replaces dashboardLayout
 *   whole, so without the re-read a phone with an hour-old cache would put
 *   back what the desktop changed since. Saves run one at a time, so two
 *   quick clicks don't each start from what was there before both. A failed
 *   save shows the error toast (the QueryClient's MutationCache) and puts
 *   back what the server has.
 */
export function useDashboardLayout() {
  const repo = useRepo();
  const queryClient = useQueryClient();
  const settings = useUserSettings();
  const accounts = useAccounts();

  const layout = useMemo(
    () => (settings.data ? normalizeLayout(settings.data.dashboardLayout, accounts.data?.map((a) => a.id)) : null),
    [settings.data, accounts.data]
  );
  const navOrder = settings.data?.navOrder;
  const navHrefs = useMemo(() => visibleNav(navOrder).map((item) => item.href), [navOrder]);

  const save = useMutation({
    mutationKey: MUTATION_KEY,
    scope: SCOPE,
    onMutate: async (change: LayoutChange) => {
      const accountIds = queryClient.getQueryData<Account[]>(KEYS.accounts)?.map((a) => a.id);
      // a settings fetch still in flight would land on top of the change
      await queryClient.cancelQueries({ queryKey: KEYS.userSettings });
      queryClient.setQueryData<UserSettings>(KEYS.userSettings, (current) =>
        current ? { ...current, dashboardLayout: change(normalizeLayout(current.dashboardLayout, accountIds)) } : current
      );
    },
    mutationFn: async (change: LayoutChange) => {
      const fresh = await repo.getUserSettings();
      const accountIds = queryClient.getQueryData<Account[]>(KEYS.accounts)?.map((a) => a.id);
      const next = change(normalizeLayout(fresh.dashboardLayout, accountIds));
      // A change queued behind this one has already shown itself on top of
      // it; the screen waits for that one rather than stepping back a beat.
      if (queryClient.isMutating({ mutationKey: MUTATION_KEY }) <= 1) {
        await queryClient.cancelQueries({ queryKey: KEYS.userSettings });
        queryClient.setQueryData<UserSettings>(KEYS.userSettings, (current) => ({
          ...(current ?? fresh),
          dashboardLayout: next,
        }));
      }
      await repo.saveUserSettings({ dashboardLayout: next });
    },
    onError: () => queryClient.invalidateQueries({ queryKey: KEYS.userSettings }),
  });

  const { mutate } = save;
  const update = useCallback((change: LayoutChange) => mutate(change), [mutate]);

  return { layout, navHrefs, update };
}
