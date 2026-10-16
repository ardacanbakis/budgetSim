import { useSyncExternalStore } from "react";

/**
 * Pocket's snackbar: one short message at a time at the foot of the screen,
 * with an optional action — "Expense added · −₺120.00 · Undo". A module store
 * like lib/ui/toasts.ts, so anything (a mutation's onSuccess, an action
 * sheet) can show one without threading props. Errors stay on the Toaster.
 */

export interface Snack {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
}

export const SNACK_MS = 6_000;

let current: Snack | null = null;
let nextId = 1;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function showSnack(text: string, action?: Snack["action"]): void {
  if (timer) clearTimeout(timer);
  const snack: Snack = { id: nextId++, text, action };
  current = snack;
  emit();
  timer = setTimeout(() => dismissSnack(snack.id), SNACK_MS);
}

export function dismissSnack(id?: number): void {
  if (!current || (id != null && current.id !== id)) return;
  current = null;
  emit();
}

export function currentSnack(): Snack | null {
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSnack(): Snack | null {
  return useSyncExternalStore(subscribe, currentSnack, () => null);
}
