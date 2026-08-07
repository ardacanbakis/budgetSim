"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { RateTicker } from "@/components/rateTicker";
import { CardDueBanner } from "@/components/cardDueBanner";
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

const SIDEBAR_KEY = "renovator-sidebar";

export const NAV = [
  { href: "/", key: "nav.dashboard", icon: "◧" },
  { href: "/accounts", key: "nav.accounts", icon: "▤" },
  { href: "/transactions", key: "nav.transactions", icon: "⇄" },
  { href: "/cards", key: "nav.cards", icon: "💳" },
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
  // phone bar: the first four, plus More — except that the page you're on is
  // always one of the four, so you can see where you are without opening it
  const primaryNav = nav.slice(0, 4);
  const overflowNav = nav.slice(4);
  const activeOverflow = overflowNav.find((item) => item.href === pathname);
  const barItems = activeOverflow ? [...primaryNav.slice(0, 3), activeOverflow] : primaryNav;
  const [moreOpen, setMoreOpen] = useState(false);
  const [quickTx, setQuickTx] = useState(false);
  const [quickTransfer, setQuickTransfer] = useState(false);
  // icons-only sidebar: a property of the screen you're at, so device-local
  const [railed, setRailed] = useState(false);

  useEffect(() => {
    queueMicrotask(() => setRailed(window.localStorage.getItem(SIDEBAR_KEY) === "rail"));
  }, []);

  function toggleRail() {
    setRailed((prev) => {
      window.localStorage.setItem(SIDEBAR_KEY, prev ? "full" : "rail");
      return !prev;
    });
  }

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
        <aside
          className={`sticky top-0 hidden h-screen shrink-0 flex-col border-r border-[var(--edge)] py-4 md:flex ${
            railed ? "w-16 px-2" : "w-56 px-3"
          }`}
        >
          <Link
            href="/welcome"
            className={`mb-6 text-lg font-bold tracking-tight text-teal-700 dark:text-teal-400 ${
              railed ? "text-center" : "px-2"
            }`}
            title="BudgetSim"
          >
            {railed ? "B" : "BudgetSim"}
          </Link>
          <nav className="flex flex-1 flex-col gap-1">
            {nav.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={railed ? t(item.key) : undefined}
                  className={`flex items-center rounded-lg py-2 text-sm font-medium transition-colors ${
                    railed ? "justify-center px-0" : "gap-2.5 px-2.5"
                  } ${
                    active
                      ? "bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-300"
                      : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  }`}
                >
                  <span className="w-4 text-center">{item.icon}</span>
                  {railed ? <span className="sr-only">{t(item.key)}</span> : t(item.key)}
                </Link>
              );
            })}
          </nav>
          <button
            onClick={toggleRail}
            aria-label={railed ? t("nav.expandSidebar") : t("nav.collapseSidebar")}
            title={railed ? t("nav.expandSidebar") : t("nav.collapseSidebar")}
            className={`rounded-lg py-2 text-sm text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
              railed ? "text-center" : "px-2.5 text-left"
            }`}
          >
            {railed ? "»" : `« ${t("nav.collapseSidebar")}`}
          </button>
          <button
            onClick={() => signOut().then(() => router.replace("/login"))}
            title={railed ? t("nav.logout") : undefined}
            className={`rounded-lg py-2 text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
              railed ? "text-center" : "px-2.5 text-left"
            }`}
          >
            {railed ? "⏻" : t("nav.logout")}
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
          <CardDueBanner />
          </div>

          <main className="px-4 py-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:px-6 md:pb-8">{children}</main>
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

      {/* bottom nav — mobile. Four fixed destinations plus More: a row that
          scrolls sideways hides half its own targets, and a phone thumb wants
          buttons it can hit without aiming. */}
      <nav className="no-print fixed inset-x-0 bottom-0 z-40 flex border-t border-[var(--edge)] bg-[var(--surface)]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        {barItems.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-11 flex-1 basis-0 flex-col items-center justify-center gap-0.5 px-1 py-2 text-[10px] font-medium ${
                active ? "text-teal-600 dark:text-teal-400" : "text-zinc-500 dark:text-zinc-400"
              }`}
            >
              <span className="text-base leading-none">{item.icon}</span>
              <span className="w-full truncate text-center">{t(item.key)}</span>
            </Link>
          );
        })}
        {overflowNav.length > 0 ? (
          <button
            onClick={() => setMoreOpen(true)}
            aria-expanded={moreOpen}
            className={`flex min-h-11 flex-1 basis-0 flex-col items-center justify-center gap-0.5 px-1 py-2 text-[10px] font-medium ${
              moreOpen ? "text-teal-600 dark:text-teal-400" : "text-zinc-500 dark:text-zinc-400"
            }`}
          >
            <span className="text-base leading-none">⋯</span>
            <span className="w-full truncate text-center">{t("nav.more")}</span>
          </button>
        ) : null}
      </nav>

      {/* the rest of the nav, as a sheet */}
      {moreOpen ? (
        <div className="no-print fixed inset-0 z-50 flex items-end bg-black/40 md:hidden" onClick={() => setMoreOpen(false)}>
          <div
            className="w-full rounded-t-2xl bg-[var(--surface)] p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-semibold">{t("nav.more")}</h3>
              <button onClick={() => setMoreOpen(false)} aria-label={t("common.close")} className="rounded-md p-1 text-zinc-400">
                ✕
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {overflowNav.map((item) => {
                const active = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMoreOpen(false)}
                    aria-current={active ? "page" : undefined}
                    className={`flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-xl border border-[var(--edge)] px-2 py-3 text-xs font-medium ${
                      active
                        ? "bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-300"
                        : "text-zinc-600 dark:text-zinc-300"
                    }`}
                  >
                    <span className="text-lg leading-none">{item.icon}</span>
                    <span className="text-center">{t(item.key)}</span>
                  </Link>
                );
              })}
              <button
                onClick={() => signOut().then(() => router.replace("/login"))}
                className="flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-xl border border-[var(--edge)] px-2 py-3 text-xs font-medium text-zinc-500"
              >
                <span className="text-lg leading-none">⏻</span>
                <span className="text-center">{t("nav.logout")}</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
