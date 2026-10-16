import { TxDirection } from "@/lib/data/types";
import { Currency } from "./currencies";
import { fromMinor, toMinor } from "./money";

/**
 * A balance adjustment brings an account in line with what the bank shows:
 * the transfer fee, the late-payment charge, the few lira of interest that
 * were never entered one by one. It is recorded as an ordinary completed
 * income or expense on the account, dated when it happened, so the history
 * shows it and every balance after it agrees with the bank. A flag on the
 * row (Transaction.adjustment) is what lets the screens label it.
 */
export interface AdjustmentPlan {
  direction: TxDirection;
  /** in the account's currency, always positive */
  amount: number;
}

/**
 * The entry that takes an account from `current` to `target`. Worked out in
 * the currency's minor units, so 0.1 + 0.2 never leaves a stray kuruş, and
 * null when the two already agree at the currency's precision.
 */
export function planAdjustment(current: number, target: number, currency: Currency): AdjustmentPlan | null {
  const diff = toMinor(target, currency) - toMinor(current, currency);
  if (diff === 0) return null;
  return { direction: diff > 0 ? "income" : "expense", amount: fromMinor(Math.abs(diff), currency) };
}

/** The same entry, from a change you already know ("take off 35"). */
export function planChange(amount: number, direction: TxDirection, currency: Currency): AdjustmentPlan | null {
  const minor = Math.abs(toMinor(amount, currency));
  if (!Number.isFinite(minor) || minor === 0) return null;
  return { direction, amount: fromMinor(minor, currency) };
}

/** Where the balance lands once the plan is recorded. */
export function balanceAfter(current: number, plan: AdjustmentPlan | null, currency: Currency): number {
  if (!plan) return current;
  const signed = (plan.direction === "income" ? 1 : -1) * toMinor(plan.amount, currency);
  return fromMinor(toMinor(current, currency) + signed, currency);
}
