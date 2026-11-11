"use client";

import { useEffect, useState } from "react";

/**
 * A yes/no preference stored on the device rather than the account — how a
 * list opens on this screen, not something worth syncing.
 *
 * `loaded` is false until the first effect runs, because localStorage can't be
 * read while prerendering. Anything that must not act on the default before
 * the real value arrives should wait on it.
 */
export function useLocalToggle(key: string, fallback: boolean) {
  const [value, setValue] = useState(fallback);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // after paint: reading storage during the effect body would cascade renders
    queueMicrotask(() => {
      const saved = window.localStorage.getItem(key);
      if (saved === "on" || saved === "off") setValue(saved === "on");
      setLoaded(true);
    });
  }, [key]);

  function update(next: boolean) {
    setValue(next);
    window.localStorage.setItem(key, next ? "on" : "off");
  }

  return { value, setValue: update, loaded };
}

/**
 * A number kept on the device — a display threshold, not shared data.
 * `loaded` works the same way as for a toggle.
 */
export function useLocalNumber(key: string, fallback: number) {
  const [value, setValue] = useState(fallback);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    queueMicrotask(() => {
      const saved = Number(window.localStorage.getItem(key));
      if (Number.isFinite(saved) && saved >= 0) setValue(saved);
      setLoaded(true);
    });
  }, [key]);

  function update(next: number) {
    setValue(next);
    window.localStorage.setItem(key, String(next));
  }

  return { value, setValue: update, loaded };
}

/**
 * One of a fixed set of choices kept on the device — which filter a list
 * opens on. A stored value that is no longer one of the options is ignored.
 * `loaded` works the same way as for a toggle.
 */
export function useLocalChoice<T extends string>(key: string, options: readonly T[], fallback: T) {
  const [value, setValue] = useState<T>(fallback);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    queueMicrotask(() => {
      const saved = window.localStorage.getItem(key);
      if (saved != null && (options as readonly string[]).includes(saved)) setValue(saved as T);
      setLoaded(true);
    });
  }, [key, options]);

  function update(next: T) {
    setValue(next);
    window.localStorage.setItem(key, next);
  }

  return { value, setValue: update, loaded };
}

/** Which recurring items the Recurring screen shows: by status, and by direction. */
/**
 * A choice remembered as the one last used, with a default that can be
 * pinned on top of it — the same bargain lib/ui/useViews.ts strikes for a
 * screen's shape. Picking one applies it now; pinning it means the card
 * opens that way from then on, whatever was looked at last. Nothing is
 * pinned until asked, so a card nobody pins behaves as useLocalChoice does.
 */
export function usePinnedChoice<T extends string>(key: string, options: readonly T[], fallback: T) {
  const [value, setValue] = useState<T>(fallback);
  const [pinned, setPinned] = useState<T | null>(null);
  const [loaded, setLoaded] = useState(false);
  const defaultKey = `${key}-default`;

  useEffect(() => {
    queueMicrotask(() => {
      const known = (v: string | null): v is T => v != null && (options as readonly string[]).includes(v);
      const saved = window.localStorage.getItem(key);
      const asked = window.localStorage.getItem(`${key}-default`);
      const pin = known(asked) ? asked : null;
      setPinned(pin);
      if (pin) setValue(pin);
      else if (known(saved)) setValue(saved);
      setLoaded(true);
    });
  }, [key, options]);

  return {
    value,
    loaded,
    pinned,
    isDefault: pinned === value,
    setValue: (next: T) => {
      setValue(next);
      window.localStorage.setItem(key, next);
    },
    setDefault: () => {
      setPinned(value);
      window.localStorage.setItem(defaultKey, value);
    },
    clearDefault: () => {
      setPinned(null);
      window.localStorage.removeItem(defaultKey);
    },
  };
}

/** The Plan's cash-flow card: which of its three views is on screen. */
export const FLOW_VIEW_KEY = "renovator-plan-flow-view";

export const RECURRING_STATUS_FILTER_KEY = "renovator-recurring-status";
/** the Cards page's open tab: the cards, or the big purchases on them */
export const CARDS_TAB_KEY = "renovator-cards-tab";
export const RECURRING_DIRECTION_FILTER_KEY = "renovator-recurring-direction";

/** Below this many lira, a month's shortfall is rounding rather than trouble. */
export const SHORT_THRESHOLD_KEY = "renovator-short-threshold";

/**
 * Count legacy rows in the monthly figures (Reports, the dashboard's monthly
 * cashflow). They never touch balances, but they're money that really came in
 * and went out on those dates, so reading the past includes them by default.
 */
export const REPORT_LEGACY_KEY = "renovator-report-legacy";

/** Collapse every year but the current one when a history list first opens. */
export const COLLAPSE_HISTORY_KEY = "renovator-collapse-history";
