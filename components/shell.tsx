"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Select, Spinner } from "@/components/ui";
import { useApp } from "@/lib/data/provider";
import { KEYS, useRates } from "@/lib/data/queries";
import { CURRENCIES, Currency } from "@/lib/domain/currencies";
import { snapshotFromTable } from "@/lib/domain/fx";
import { useI18n } from "@/lib/i18n";

const NAV = [
  { href: "/", key: "nav.dashboard", icon: "◧" },
  { href: "/accounts", key: "nav.accounts", icon: "▤" },
  { href: "/transactions", key: "nav.transactions", icon: "⇄" },
  { href: "/victvs", key: "nav.victvs", icon: "✓" },
  { href: "/recurring", key: "nav.recurring", icon: "↻" },
  { href: "/loans", key: "nav.loans", icon: "⌂" },
  { href: "/projections", key: "nav.projections", icon: "↗" },
  { href: "/settings", key: "nav.settings", icon: "⚙" },
] as const;

/**
 * Runs once per session when data is ready: seed default categories,
 * materialize recurring templates 12 months out, then auto-complete due
 * items with today's rates. Works identically in demo and Supabase modes.
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
    const snapshot = snapshotFromTable(rates.data);
    (async () => {
      try {
        await repo.seedDefaultCategories();
        const created = await repo.materializeTemplates(12);
        const completed = await repo.autoCompleteDue(snapshot);
        if (created || completed) {
          await queryClient.invalidateQueries({ queryKey: KEYS.transactions });
          await queryClient.invalidateQueries({ queryKey: KEYS.categories });
        }
      } catch (err) {
        console.warn("bootstrap failed", err);
      }
    })();
  }, [session, rates.data, queryClient]);

  return null;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { session, displayCurrency, setDisplayCurrency, signOut } = useApp();
  const { t } = useI18n();
  const pathname = usePathname();
  const router = useRouter();
  const rates = useRates();

  useEffect(() => {
    if (session.status === "signedOut") router.replace("/login");
  }, [session.status, router]);

  if (session.status !== "ready") {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Spinner />
      </main>
    );
  }

  const isDemo = session.repo.mode === "demo";
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

      <div className="mx-auto flex w-full max-w-[1800px]">
        {/* sidebar — desktop & ultrawide */}
        <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-zinc-200 px-3 py-4 md:flex dark:border-zinc-800">
          <Link href="/" className="mb-6 px-2 text-lg font-bold tracking-tight text-teal-700 dark:text-teal-400">
            Renovator
          </Link>
          <nav className="flex flex-1 flex-col gap-1">
            {NAV.map((item) => {
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
          {/* header */}
          <header className="sticky top-0 z-40 flex items-center justify-between gap-3 border-b border-zinc-200 bg-zinc-50/90 px-4 py-2.5 backdrop-blur md:px-6 dark:border-zinc-800 dark:bg-zinc-950/90">
            <div className="text-base font-semibold md:hidden">Renovator</div>
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

          <main className="px-4 py-4 pb-24 md:px-6 md:pb-8">{children}</main>
        </div>
      </div>

      {/* bottom nav — mobile */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex overflow-x-auto border-t border-zinc-200 bg-white/95 backdrop-blur md:hidden dark:border-zinc-800 dark:bg-zinc-900/95">
        {NAV.map((item) => {
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
