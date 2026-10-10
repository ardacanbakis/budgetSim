"use client";

import { useSyncExternalStore } from "react";
import { useApp } from "@/lib/data/provider";
import { PHONE_QUERY } from "./phone";

function subscribe(onChange: () => void): () => void {
  const mq = window.matchMedia(PHONE_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/** Whether the viewport is phone-width. False while prerendering. */
export function useIsPhone(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(PHONE_QUERY).matches,
    () => false
  );
}

/**
 * True only when this device has the Pocket phone layout switched on AND the
 * screen is phone-width right now. Screens branch on this; with the setting
 * off it is always false, so the default design renders exactly as before.
 */
export function usePocket(): boolean {
  const { phoneLayout } = useApp();
  const phone = useIsPhone();
  return phoneLayout === "pocket" && phone;
}
