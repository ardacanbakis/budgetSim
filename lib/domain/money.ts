import { Currency, CURRENCY_META } from "./currencies";

/**
 * Decimal-safe money arithmetic. Amounts are stored as plain decimal numbers
 * (matching Postgres `numeric` serialized over JSON), but all arithmetic goes
 * through integer minor units so sums never accumulate float error.
 */

export function toMinor(amount: number, currency: Currency): number {
  const factor = 10 ** CURRENCY_META[currency].decimals;
  // toPrecision strips float representation error (1.005 * 100 = 100.49999...)
  // before rounding, so half-values round up as expected.
  return Math.round(Number((amount * factor).toPrecision(12)));
}

export function fromMinor(minor: number, currency: Currency): number {
  const factor = 10 ** CURRENCY_META[currency].decimals;
  return minor / factor;
}

/** Round a raw number to the currency's precision (e.g. after FX multiplication). */
export function roundTo(amount: number, currency: Currency): number {
  return fromMinor(toMinor(amount, currency), currency);
}

/** Decimal-safe sum of amounts in the same currency. */
export function sumAmounts(currency: Currency, amounts: number[]): number {
  let total = 0;
  for (const a of amounts) total += toMinor(a, currency);
  return fromMinor(total, currency);
}

/** a - b, decimal-safe. */
export function subtractAmounts(currency: Currency, a: number, b: number): number {
  return fromMinor(toMinor(a, currency) - toMinor(b, currency), currency);
}
