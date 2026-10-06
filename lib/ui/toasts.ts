import { useSyncExternalStore } from "react";
import { describeError, ErrorKind } from "@/lib/data/errors";

/**
 * Error toasts: what a failed save or load says to the person who tried it.
 * A module-level store, so React Query's caches (created outside any
 * component) can push to it and one <Toaster /> shows it.
 */

export interface ErrorToast {
  id: number;
  /** what was being attempted */
  action: "save" | "load";
  kind: ErrorKind;
  detail: string;
}

export const TOAST_MS = 10_000;
/** these need the person to do something, so they stay until dismissed */
const STICKY: ReadonlySet<ErrorKind> = new Set(["needsMigration", "sessionExpired"]);
const MAX_SHOWN = 3;

let toasts: ErrorToast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

export function showErrorToast(action: ErrorToast["action"], err: unknown): void {
  const { kind, detail } = describeError(err);
  // One cause often fails several requests at once: an expired session or a
  // missing migration breaks every list on the page. Say it once.
  const repeat = toasts.some((t) => t.kind === kind && (STICKY.has(kind) || (t.action === action && t.detail === detail)));
  if (repeat) return;
  const toast: ErrorToast = { id: nextId++, action, kind, detail };
  toasts = [...toasts, toast].slice(-MAX_SHOWN);
  emit();
  if (!STICKY.has(kind)) setTimeout(() => dismissToast(toast.id), TOAST_MS);
}

export function dismissToast(id: number): void {
  if (!toasts.some((t) => t.id === id)) return;
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function currentToasts(): readonly ErrorToast[] {
  return toasts;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const NONE: ErrorToast[] = [];

export function useErrorToasts(): readonly ErrorToast[] {
  return useSyncExternalStore(subscribe, currentToasts, () => NONE);
}
