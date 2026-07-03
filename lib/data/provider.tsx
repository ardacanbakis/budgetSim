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
const THEME_KEY = "renovator-theme";
const COMPACT_KEY = "renovator-compact";

export type Theme = "system" | "light" | "dark" | "slate" | "ocean" | "forest" | "mocha";

export const THEMES: Array<{ id: Theme; preview: { bg: string; accent: string } }> = [
  { id: "system", preview: { bg: "#ffffff", accent: "#0d9488" } },
  { id: "light", preview: { bg: "#ffffff", accent: "#0d9488" } },
  { id: "dark", preview: { bg: "#09090b", accent: "#2dd4bf" } },
  { id: "slate", preview: { bg: "#1e293b", accent: "#38bdf8" } },
  { id: "ocean", preview: { bg: "#0c1e3e", accent: "#60a5fa" } },
  { id: "forest", preview: { bg: "#0f2920", accent: "#34d399" } },
  { id: "mocha", preview: { bg: "#1c1410", accent: "#d4a574" } },
];

const CUSTOM_THEMES: Theme[] = ["slate", "ocean", "forest", "mocha"];

export function isTheme(value: string): value is Theme {
  return THEMES.some((t) => t.id === value);
}

function applyTheme(theme: Theme): void {
  const dark =
    theme === "dark" ||
    CUSTOM_THEMES.includes(theme) ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  if (CUSTOM_THEMES.includes(theme)) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

function applyCompact(compact: boolean): void {
  document.documentElement.dataset.compact = compact ? "true" : "false";
}

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
  theme: Theme;
  setTheme: (t: Theme) => void;
  compact: boolean;
  setCompact: (c: boolean) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session>({ status: "loading" });
  const [displayCurrency, setDisplayCurrencyState] = useState<Currency>("USD");
  const [theme, setThemeState] = useState<Theme>("system");
  const [compact, setCompactState] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    // deferred: state is initialized from localStorage after hydration
    queueMicrotask(() => {
      const saved = window.localStorage.getItem(DISPLAY_KEY);
      if (saved && isCurrency(saved)) setDisplayCurrencyState(saved);
      const savedTheme = window.localStorage.getItem(THEME_KEY);
      const theme: Theme = savedTheme && isTheme(savedTheme) ? savedTheme : "system";
      setThemeState(theme);
      applyTheme(theme);
      const savedCompact = window.localStorage.getItem(COMPACT_KEY) === "true";
      setCompactState(savedCompact);
      applyCompact(savedCompact);
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

  // theme follows the OS while set to "system"
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  const setTheme = useCallback(
    (t: Theme) => {
      setThemeState(t);
      window.localStorage.setItem(THEME_KEY, t);
      applyTheme(t);
      if (session.status === "ready") session.repo.saveUserSettings({ theme: t }).catch(() => undefined);
    },
    [session]
  );

  const setCompact = useCallback(
    (c: boolean) => {
      setCompactState(c);
      window.localStorage.setItem(COMPACT_KEY, String(c));
      applyCompact(c);
      if (session.status === "ready") session.repo.saveUserSettings({ compact: c }).catch(() => undefined);
    },
    [session]
  );

  const value = useMemo(
    () => ({ session, enterDemo, signOut, resetDemo, displayCurrency, setDisplayCurrency, theme, setTheme, compact, setCompact }),
    [session, enterDemo, signOut, resetDemo, displayCurrency, setDisplayCurrency, theme, setTheme, compact, setCompact]
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
