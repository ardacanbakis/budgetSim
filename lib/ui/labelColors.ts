"use client";

import { useSyncExternalStore } from "react";

/**
 * The colour of a status label — "Completed" on a recurring item, and the two
 * labels next to it.
 *
 * Device-local like the rest of the view settings: it's how you like to read
 * the screen, not account data. Every badge and picker reads the same stored
 * value through useSyncExternalStore, so changing it in one place repaints
 * the others immediately, including other open tabs (via the storage event).
 */

export const LABEL_COLORS = ["green", "teal", "sky", "violet", "yellow", "amber", "red", "zinc"] as const;
export type LabelColor = (typeof LABEL_COLORS)[number];

export const LABELED_STATUSES = ["completed", "notStarted", "toConfirm"] as const;
export type LabeledStatus = (typeof LABELED_STATUSES)[number];

export const DEFAULT_LABEL_COLORS: Record<LabeledStatus, LabelColor> = {
  completed: "green",
  notStarted: "violet",
  toConfirm: "amber",
};

/** Swatch fill for the picker; spelled out because Tailwind can't see computed names. */
export const SWATCH_CLASS: Record<LabelColor, string> = {
  green: "bg-emerald-500",
  teal: "bg-teal-500",
  sky: "bg-sky-500",
  violet: "bg-violet-500",
  yellow: "bg-yellow-400",
  amber: "bg-amber-500",
  red: "bg-red-500",
  zinc: "bg-zinc-400",
};

export const labelColorKey = (status: LabeledStatus) => `renovator-label-${status}`;

export function isLabelColor(v: unknown): v is LabelColor {
  return typeof v === "string" && (LABEL_COLORS as readonly string[]).includes(v);
}

const CHANGE_EVENT = "renovator-label-colors";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

function read(status: LabeledStatus): LabelColor {
  try {
    const saved = window.localStorage.getItem(labelColorKey(status));
    if (isLabelColor(saved)) return saved;
  } catch {
    // storage blocked (private mode) — fall through to the default
  }
  return DEFAULT_LABEL_COLORS[status];
}

export function useLabelColor(status: LabeledStatus): [LabelColor, (next: LabelColor) => void] {
  const color = useSyncExternalStore(
    subscribe,
    () => read(status),
    // prerender has no storage; hydration starts from the default
    () => DEFAULT_LABEL_COLORS[status]
  );
  const setColor = (next: LabelColor) => {
    try {
      window.localStorage.setItem(labelColorKey(status), next);
    } catch {
      // can't persist; the event below still repaints this tab
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  };
  return [color, setColor];
}
