"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Dictionary, en, tr } from "./dictionaries";

export type Locale = "en" | "tr";

const DICTS: Record<Locale, Dictionary> = { en, tr };
const STORAGE_KEY = "renovator-locale";

interface I18nContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  /** t("victvs.saveSessions", { count: 3 }) */
  t: (key: string, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");

  useEffect(() => {
    // deferred so the initial (server-rendered) tree hydrates before locale swaps in
    queueMicrotask(() => {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved === "tr" || saved === "en") setLocaleState(saved);
    });
  }, []);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    window.localStorage.setItem(STORAGE_KEY, l);
  }, []);

  const t = useCallback(
    (key: string, params?: Record<string, string | number>) => {
      let node: unknown = DICTS[locale];
      for (const part of key.split(".")) {
        node = (node as Record<string, unknown>)?.[part];
      }
      let text = typeof node === "string" ? node : key;
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          text = text.replaceAll(`{${k}}`, String(v));
        }
      }
      return text;
    },
    [locale]
  );

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n outside I18nProvider");
  return ctx;
}
