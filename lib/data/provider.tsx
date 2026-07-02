"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Currency, isCurrency } from "@/lib/domain/currencies";
import { getSupabase, supabaseConfigured } from "@/lib/supabase/client";
import { DemoRepo } from "./demoRepo";
import { Repo } from "./repo";
import { SupabaseRepo } from "./supabaseRepo";

const MODE_KEY = "renovator-mode";
const DISPLAY_KEY = "renovator-display-currency";

export type Session =
  | { status: "loading" }
  | { status: "signedOut"; supabaseAvailable: boolean }
  | { status: "ready"; repo: Repo; email: string | null };

interface AppContextValue {
  session: Session;
  enterDemo: () => void;
  signOut: () => Promise<void>;
  resetDemo: () => Promise<void>;
  displayCurrency: Currency;
  setDisplayCurrency: (c: Currency) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session>({ status: "loading" });
  const [displayCurrency, setDisplayCurrencyState] = useState<Currency>("USD");
  const queryClient = useQueryClient();

  useEffect(() => {
    // deferred: state is initialized from localStorage after hydration
    queueMicrotask(() => {
      const saved = window.localStorage.getItem(DISPLAY_KEY);
      if (saved && isCurrency(saved)) setDisplayCurrencyState(saved);
    });

    if (window.localStorage.getItem(MODE_KEY) === "demo") {
      queueMicrotask(() => setSession({ status: "ready", repo: new DemoRepo(), email: null }));
      return;
    }
    if (!supabaseConfigured()) {
      queueMicrotask(() => setSession({ status: "signedOut", supabaseAvailable: false }));
      return;
    }
    const supabase = getSupabase();
    const apply = (userId: string | undefined, email: string | null) => {
      if (userId) {
        setSession({ status: "ready", repo: new SupabaseRepo(supabase, userId), email });
      } else {
        setSession({ status: "signedOut", supabaseAvailable: true });
      }
    };
    supabase.auth.getSession().then(({ data }) => {
      apply(data.session?.user?.id, data.session?.user?.email ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      apply(s?.user?.id, s?.user?.email ?? null);
      queryClient.clear();
    });
    return () => sub.subscription.unsubscribe();
  }, [queryClient]);

  const enterDemo = useCallback(() => {
    window.localStorage.setItem(MODE_KEY, "demo");
    setSession({ status: "ready", repo: new DemoRepo(), email: null });
    queryClient.clear();
  }, [queryClient]);

  const signOut = useCallback(async () => {
    window.localStorage.removeItem(MODE_KEY);
    if (supabaseConfigured()) await getSupabase().auth.signOut();
    queryClient.clear();
    setSession({ status: "signedOut", supabaseAvailable: supabaseConfigured() });
  }, [queryClient]);

  const resetDemo = useCallback(async () => {
    if (session.status === "ready" && session.repo.mode === "demo") {
      await session.repo.deleteAllData();
      queryClient.clear();
      setSession({ status: "ready", repo: new DemoRepo(), email: null });
    }
  }, [session, queryClient]);

  const setDisplayCurrency = useCallback((c: Currency) => {
    setDisplayCurrencyState(c);
    window.localStorage.setItem(DISPLAY_KEY, c);
  }, []);

  const value = useMemo(
    () => ({ session, enterDemo, signOut, resetDemo, displayCurrency, setDisplayCurrency }),
    [session, enterDemo, signOut, resetDemo, displayCurrency, setDisplayCurrency]
  );
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp outside AppProvider");
  return ctx;
}

/** Only call from screens that render when session is ready. */
export function useRepo(): Repo {
  const { session } = useApp();
  if (session.status !== "ready") throw new Error("repo not ready");
  return session.repo;
}
