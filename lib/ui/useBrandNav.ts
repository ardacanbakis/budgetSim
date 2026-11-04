"use client";

import { useCallback, useSyncExternalStore } from "react";
import { BRAND_NAV_EVENT, BRAND_TARGET_KEY, BrandNav, BrandTarget, HIDE_DASHBOARD_KEY, readBrandNav } from "./brandNav";
import { PHONE_QUERY } from "./phone";

function subscribe(onChange: () => void): () => void {
  const mq = window.matchMedia(PHONE_QUERY);
  mq.addEventListener("change", onChange);
  window.addEventListener(BRAND_NAV_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    mq.removeEventListener("change", onChange);
    window.removeEventListener(BRAND_NAV_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** a string, so the snapshot compares equal while nothing changed */
const snapshot = () =>
  JSON.stringify(
    readBrandNav({ target: read(BRAND_TARGET_KEY), hide: read(HIDE_DASHBOARD_KEY) }, window.matchMedia(PHONE_QUERY).matches)
  );
// prerendering knows neither the device nor its choice: the wide-screen default, as the app was
const serverSnapshot = () => JSON.stringify(readBrandNav({ target: null, hide: null }, false));

/** The device's choice for the "BudgetSim" name (lib/ui/brandNav.ts), and setters that save it. */
export function useBrandNav(): BrandNav & { setTarget: (t: BrandTarget) => void; setHideDashboard: (on: boolean) => void } {
  const nav = JSON.parse(useSyncExternalStore(subscribe, snapshot, serverSnapshot)) as BrandNav;
  const save = useCallback((key: string, value: string) => {
    window.localStorage.setItem(key, value);
    window.dispatchEvent(new Event(BRAND_NAV_EVENT));
  }, []);
  const setTarget = useCallback((t: BrandTarget) => save(BRAND_TARGET_KEY, t), [save]);
  const setHideDashboard = useCallback((on: boolean) => save(HIDE_DASHBOARD_KEY, on ? "on" : "off"), [save]);
  return { ...nav, setTarget, setHideDashboard };
}
