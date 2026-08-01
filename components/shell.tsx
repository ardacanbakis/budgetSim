"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { RateTicker } from "@/components/rateTicker";
import { Select, Spinner } from "@/components/ui";
import { TransactionModal } from "@/components/transactionModal";
import { TransferModal } from "@/components/transferModal";
import { useApp } from "@/lib/data/provider";
import { KEYS, useRates, useUserSettings } from "@/lib/data/queries";
import { computeBalances, computeNetWorth } from "@/lib/domain/balances";
import { CURRENCIES, Currency } from "@/lib/domain/currencies";
import { snapshotFromTable } from "@/lib/domain/fx";
import { todayISO } from "@/lib/domain/recurrence";
import { useI18n } from "@/lib/i18n";

export const NAV = [
  { href: "/", key: "nav.dashboard", icon: "◧" },
  { href: "/accounts", key: "nav.accounts", icon: "▤" },
  { href: "/transactions", key: "nav.transactions", icon: "⇄" },
  { href: "/purchases", key: "nav.purchases", icon: "▣" },
  { href: "/victvs", key: "nav.victvs", icon: "✓" },
  { href: "/recurring", key: "nav.recurring", icon: "↻" },
  { href: "/loans", key: "nav.loans", icon: "⌂" },
  { href: "/reports", key: "nav.reports", icon: "◔" },
  { href: "/planner", key: "nav.planner", icon: "◈" },
  { href: "/settings", key: "nav.settings", icon: "⚙" },
] as const;

/** Apply the user's saved sidebar order; unknown ids dropped, missing appended. */
export function orderedNav(navOrder: string[] | null | undefined): (typeof NAV)[number][] {
  if (!navOrder?.length) return [...NAV];
  const byHref = new Map<string, (typeof NAV)[number]>(NAV.map((item) => [item.href, item]));
  const result: (typeof NAV)[number][] = [];
  for (const href of navOrder) {
    const item = byHref.get(href);
    if (item) {
      result.push(item);
      byHref.delete(href);
    }
  }
  return [...result, ...byHref.values()];
}

/**
 * Runs once per session when data is ready: seed default categories,
 * materialize recurring templates 12 months out, auto-complete due items
 * with today's rates, and take the monthly net-worth snapshot if this
 * month doesn't have one yet. Works identically in demo and Supabase modes.
 */
function Bootstrapper() {
  const { session } = useApp();
  const rates = useRates();
  const queryClient = useQueryClient();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current || session.status !== "ready" || !rates.data) return;
    ran.current = true;
    const repo = session.repo;
    const table = rates.data;
    const snapshot = snapshotFromTable(table);
    (async () => {
      try {
        await repo.seedDefaultCategories();
        const created = await repo.materializeTemplates(12);
        const completed = await repo.autoCompleteDue(snapshot);
        if (created || completed) {
          await queryClient.invalidateQueries({ queryKey: KEYS.transactions });
          await queryClient.invalidateQueries({ queryKey: KEYS.categories });
        }
        // monthly net-worth snapshot (skipped while on fallback rates — a
        // stale-rate snapshot would poison the history)
        const isStale =
          ("stale" in table && table.stale) || Object.values(table.sources).some((s) => s === "fallback");
        if (!isStale) {
          const today = todayISO();
          const existing = await repo.listSnapshots();
          if (!existing.some((s) => s.snapshotDate.slice(0, 7) === today.slice(0, 7))) {
            const [accounts, transactions] = await Promise.all([repo.listAccounts(), repo.listTransactions()]);
            const balances = computeBalances(accounts, transactions);
            const { total } = computeNetWorth(accounts, balances, table.usdPer, "USD");
            await repo.takeSnapshot({
              snapshotDate: today,
              balances: Object.fromEntries(balances),
              usdPer: table.usdPer,
              totalUsd: total,
            });
            await queryClient.invalidateQueries({ queryKey: KEYS.snapshots });
          }
        }
      } catch (err) {
        console.warn("bootstrap failed", err);
      }
    })();
  }, [session, rates.data, queryClient]);

  return null;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { session } = useApp();
  const router = useRouter();

  useEffect(() => {
    if (session.status === "signedOut") router.replace("/welcome");
  }, [session.status, router]);

  // repo-backed hooks (useUserSettings etc.) live in ShellChrome, which only
  // mounts once the session is ready — also keeps prerender repo-free
  if (session.status !== "ready") {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Spinner />
      </main>
    );
  }
  return <ShellChrome>{children}</ShellChrome>;
}

function ShellChrome({ children }: { children: React.ReactNode }) {
  const { session, displayCurrency, setDisplayCurrency, signOut } = useApp();
  const { t } = useI18n();
  const pathname = usePathname();
  const router = useRouter();
  const rates = useRates();
  const settings = useUserSettings();
  const nav = orderedNav(settings.data?.navOrder);
  const [quickTx, setQuickTx] = useState(false);
  const [quickTransfer, setQuickTransfer] = useState(false);

  // desktop shortcuts: n = new transaction, t = transfer (unless typing)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;
      if (e.key === "n") {
        e.preventDefault();
        setQuickTx(true);
      } else if (e.key === "t") {
        e.preventDefault();
        setQuickTransfer(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const isDemo = session.status === "ready" && session.repo.mode === "demo";
  // floating quick-add is shown unless the user turned it off in Settings (null = shown)
  const showQuickAdd = settings.data?.showQuickAdd ?? true;
  // rate ticker is opt-in (null = hidden)
  const showRateTicker = settings.data?.showRateTicker ?? false;
  // stale = the whole fetch fell back client-side, or any live source degraded to the static fallback
  const ratesStale = Boolean(
    rates.data &&
      (("stale" in rates.data && rates.data.stale) ||
        Object.values(rates.data.sources).some((s) => s === "fallback"))
  );

  return (
    <div className="min-h-screen">
      <Bootstrapper />
      {isDemo ? (
        <div className="flex items-center justify-center gap-3 bg-amber-100 px-4 py-1.5 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <span>{t("auth.demoBanner")}</span>
          <button className="font-semibold underline" onClick={() => signOut().then(() => router.replace("/login"))}>
            {t("auth.exitDemo")}
          </button>
        </div>
      ) : null}

      <div className="flex w-full">
        {/* sidebar — desktop & ultrawide */}
        <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-[var(--edge)] px-3 py-4 md:flex">
          <Link href="/welcome" className="mb-6 px-2 text-lg font-bold tracking-tight text-teal-700 dark:text-teal-400">
            BudgetSim
          </Link>
          <nav className="flex flex-1 flex-col gap-1">
            {nav.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors ${
                    active
                      ? "bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-300"
                      : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  }`}
                >
                  <span className="w-4 text-center">{item.icon}</span>
                  {t(item.key)}
                </Link>
              );
            })}
          </nav>
          <button
            onClick={() => signOut().then(() => router.replace("/login"))}
            className="rounded-lg px-2.5 py-2 text-left text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            {t("nav.logout")}
          </button>
        </aside>

        <div className="min-w-0 flex-1">
          {/* header (+ optional market ticker) stay pinned together */}
          <div className="sticky top-0 z-40">
          <header className="flex items-center justify-between gap-3 border-b border-[var(--edge)] bg-[var(--page)]/90 px-4 pb-2.5 pt-[max(0.625rem,env(safe-area-inset-top))] backdrop-blur md:px-6">
            <Link href="/welcome" className="text-base font-semibold md:hidden">BudgetSim</Link>
            <div className="flex flex-1 items-center justify-end gap-3">
              {rates.data ? (
                <span
                  className={`hidden text-xs sm:block ${ratesStale ? "text-amber-600" : "text-zinc-400"}`}
                  title={new Date(rates.data.fetchedAt).toLocaleString()}
                >
                  {t("common.ratesUpdated")}{" "}
                  {new Date(rates.data.fetchedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  {ratesStale ? ` (${t("common.stale")})` : ""}
                </span>
              ) : null}
              <Select
                aria-label={t("settings.displayCurrency")}
                className="!w-auto"
                value={displayCurrency}
                onChange={(e) => setDisplayCurrency(e.target.value as Currency)}
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c === "XAU_G" ? "GOLD g" : c}
                  </option>
                ))}
              </Select>
            </div>
          </header>
          {showRateTicker ? <RateTicker /> : null}
          </div>

          <main className="px-4 py-4 pb-24 md:px-6 md:pb-8">{children}</main>
        </div>
      </div>

      {showQuickAdd ? (
        <button
          onClick={() => setQuickTx(true)}
          aria-label={t("tx.newTransaction")}
          title={`${t("tx.newTransaction")} (n)`}
          className="no-print fixed right-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-40 flex h-13 w-13 items-center justify-center rounded-full bg-teal-600 text-2xl text-white shadow-lg transition-transform hover:scale-105 hover:bg-teal-700 md:bottom-6 dark:bg-teal-500 dark:text-zinc-950"
        >
          +
        </button>
      ) : null}
      <TransactionModal open={quickTx} onClose={() => setQuickTx(false)} />
      <TransferModal open={quickTransfer} onClose={() => setQuickTransfer(false)} />

      {/* bottom nav — mobile */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex overflow-x-auto border-t border-[var(--edge)] bg-[var(--surface)]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        {nav.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex min-w-[4.4rem] flex-1 flex-col items-center gap-0.5 px-1 py-2 text-[10px] font-medium ${
                active ? "text-teal-600 dark:text-teal-400" : "text-zinc-500 dark:text-zinc-400"
              }`}
            >
              <span className="text-base leading-none">{item.icon}</span>
              {t(item.key)}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
