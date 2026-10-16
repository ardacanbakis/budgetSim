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

/** numeric(20,8) holds 12 integer digits; anything from here on can't be stored. */
const MAX_AMOUNT = 1e12;
const CURRENCY_MARK = /^(?:₺|\$|€|₿|tl|try|usd|eur|btc|gr|g)+|(?:₺|\$|€|₿|tl|try|usd|eur|btc|gr|g)+$/gi;

/**
 * An amount as a person types or pastes it, in Turkish or English style:
 * "12.465,50", "12,465.50", "12465,50", "₺12.465,50", "1 234,5", "-35".
 * NaN when it isn't one, or is too big for the database's numeric(20,8).
 *
 * A number field can't be trusted with this: Chrome turns "12.465,50" into
 * 12.4655 and "35,5" into 355, depending on the browser's language, without
 * reporting an error. So the field is text and this reads it:
 * - both separators: the last one is the decimal mark
 * - one kind repeated: thousands ("1.250.000", "1,250,000")
 * - a single one: the decimal mark, unless exactly three digits follow it in
 *   a currency with fewer decimals than that and it doesn't start with 0
 *   ("12.465" lira is twelve thousand; "0,465" is under one)
 */
export function parseTypedAmount(text: string, decimals = 2): number {
  let s = text.replace(/[\s  ']/g, "").replace(CURRENCY_MARK, "");
  let negative = false;
  if (/^[-−]/.test(s)) {
    negative = true;
    s = s.slice(1).replace(CURRENCY_MARK, "");
  }
  if (!/^[\d.,]+$/.test(s)) return Number.NaN;

  const dots = s.split(".").length - 1;
  const commas = s.split(",").length - 1;
  let plain: string;
  if (dots > 0 && commas > 0) {
    const mark = s.lastIndexOf(".") > s.lastIndexOf(",") ? "." : ",";
    if ((mark === "." ? dots : commas) !== 1) return Number.NaN;
    plain = s.split(mark === "." ? "," : ".").join("").replace(mark, ".");
  } else if (dots + commas === 0) {
    plain = s;
  } else {
    const sep = dots > 0 ? "." : ",";
    const count = dots + commas;
    const after = s.length - s.lastIndexOf(sep) - 1;
    const whole = s.slice(0, s.indexOf(sep));
    // "0,465" can't be a thousands group, whatever the currency
    const thousands = count > 1 || (after === 3 && decimals < 3 && /^[1-9]/.test(whole));
    plain = thousands ? s.split(sep).join("") : s.replace(sep, ".");
  }
  if (!/^\d+(\.\d+)?$/.test(plain)) return Number.NaN;
  const value = Number(plain);
  if (!Number.isFinite(value) || value >= MAX_AMOUNT) return Number.NaN;
  return negative ? -value : value;
}

/**
 * An amount written out for editing: no thousands separators, the currency's
 * own decimals, and a comma for the decimal mark in Turkish. parseTypedAmount
 * reads it back exactly. Never in exponent form, even for 0.0000005 BTC.
 */
export function amountForEditing(amount: number, currency: Currency, locale: string): string {
  const fixed = roundTo(amount, currency).toFixed(CURRENCY_META[currency].decimals);
  return locale === "tr" ? fixed.replace(".", ",") : fixed;
}
