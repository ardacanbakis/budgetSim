"use client";

import { useSyncExternalStore } from "react";

/**
 * Pocket's own preferences, kept on the device like the phone layout itself:
 * how a phone shows the app is a property of the phone. Nothing here is
 * written to the account (user_settings), so Pocket never changes what a
 * Standard device sees.
 *
 * Every read is wrapped: storage can be blocked (private mode) and a stored
 * value can be from an older version. One change event keeps every reader in
 * this tab in step; the storage event covers other tabs.
 */

export const POCKET_KEYS = {
  /** href of the tab between + and More */
  tab: "renovator-pocket-tab",
  /** "net" | "safe": what Home leads with */
  hero: "renovator-pocket-hero",
  /** "on" | "off" */
  hideAmounts: "renovator-pocket-hide-amounts",
  lastExpenseAccount: "renovator-pocket-last-account-expense",
  lastIncomeAccount: "renovator-pocket-last-account-income",
  /** "7" | "30": how far ahead Home's "Coming up" looks */
  upcomingRange: "renovator-pocket-upcoming-range",
  /** a desk page's "easier on a larger screen" note, dismissed: + route */
  note: "renovator-pocket-note-",
} as const;

const CHANGE = "renovator-pocket-prefs";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE, onChange);
  };
}

export function readPocketPref(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writePocketPref(key: string, value: string | null): void {
  try {
    if (value == null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // can't persist; the event still updates this tab
  }
  window.dispatchEvent(new Event(CHANGE));
}

/**
 * A stored string, or `fallback` when it's missing or `valid` rejects it.
 * While prerendering it is the fallback, and hydration starts from there.
 */
export function usePocketPref(key: string, fallback: string, valid?: (v: string) => boolean): [string, (v: string) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => {
      const saved = readPocketPref(key);
      return saved != null && (!valid || valid(saved)) ? saved : fallback;
    },
    () => fallback
  );
  return [value, (v: string) => writePocketPref(key, v)];
}

export function usePocketFlag(key: string, fallback = false): [boolean, (v: boolean) => void] {
  const [raw, set] = usePocketPref(key, fallback ? "on" : "off", (v) => v === "on" || v === "off");
  return [raw === "on", (v: boolean) => set(v ? "on" : "off")];
}

export type HeroFigure = "net" | "safe";
export const isHeroFigure = (v: string): v is HeroFigure => v === "net" || v === "safe";
