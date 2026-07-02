import { Currency } from "./currencies";
import { roundTo } from "./money";
import { addMonthsClamped } from "./recurrence";

/**
 * Annuity (equal-installment) loan math. Rates use the Turkish bank
 * convention of a MONTHLY interest percentage (e.g. 2.89%/month).
 */

export function monthlyInstallment(
  principal: number,
  monthlyRatePct: number,
  termMonths: number
): number {
  if (termMonths <= 0) return 0;
  const r = monthlyRatePct / 100;
  if (r === 0) return principal / termMonths;
  const factor = Math.pow(1 + r, termMonths);
  return (principal * r * factor) / (factor - 1);
}

export interface ScheduleRow {
  n: number;
  date: string;
  payment: number;
  interest: number;
  principalPart: number;
  remaining: number;
}

export interface AmortizationResult {
  installment: number;
  rows: ScheduleRow[];
  totalPaid: number;
  totalInterest: number;
}

export function amortizationSchedule(
  principal: number,
  monthlyRatePct: number,
  termMonths: number,
  startDate: string,
  currency: Currency
): AmortizationResult {
  const r = monthlyRatePct / 100;
  const rawInstallment = monthlyInstallment(principal, monthlyRatePct, termMonths);
  const installment = roundTo(rawInstallment, currency);
  const rows: ScheduleRow[] = [];
  let remaining = principal;
  let totalPaid = 0;
  let totalInterest = 0;
  for (let n = 1; n <= termMonths; n++) {
    const interest = roundTo(remaining * r, currency);
    // Final payment clears rounding drift exactly.
    const isLast = n === termMonths;
    const principalPart = isLast ? roundTo(remaining, currency) : roundTo(installment - interest, currency);
    const payment = roundTo(principalPart + interest, currency);
    remaining = roundTo(remaining - principalPart, currency);
    totalPaid = roundTo(totalPaid + payment, currency);
    totalInterest = roundTo(totalInterest + interest, currency);
    rows.push({ n, date: addMonthsClamped(startDate, n), payment, interest, principalPart, remaining });
  }
  return { installment, rows, totalPaid, totalInterest };
}

/** Remaining principal after payments made up to (and including) a given date. */
export function remainingPrincipal(result: AmortizationResult, onDate: string, principal: number): number {
  let remaining = principal;
  for (const row of result.rows) {
    if (row.date <= onDate) remaining = row.remaining;
    else break;
  }
  return remaining;
}
