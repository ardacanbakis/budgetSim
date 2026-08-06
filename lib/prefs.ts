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

/** Below this many lira, a month's shortfall is rounding rather than trouble. */
export const SHORT_THRESHOLD_KEY = "renovator-short-threshold";

/** Collapse every year but the current one when a history list first opens. */
export const COLLAPSE_HISTORY_KEY = "renovator-collapse-history";
