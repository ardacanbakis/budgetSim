import { Currency } from "./currencies";
import { monthlyInstallment, ScheduleRow } from "./loan";
import { roundTo } from "./money";
import { addMonthsClamped } from "./recurrence";

/**
 * Loan repayment schedules, beyond the equal-installment case.
 *
 * A Turkish consumer loan is not just principal and interest. Two levies ride
 * on the interest portion of every payment — KKDF (Kaynak Kullanımını
 * Destekleme Fonu) and BSMV (Banka ve Sigorta Muameleleri Vergisi) — and they
 * are why the installment your bank quotes is always higher than a plain
 * annuity calculator says. Leaving them out does not make the model simpler,
 * it makes it wrong by about a quarter of the interest.
 *
 * Commercial loans pay BSMV but not KKDF, which is why both are parameters
 * rather than constants.
 */

export const SCHEDULE_KINDS = [
  "annuity",
  "equalPrincipal",
  "interestOnly",
  "zeroInterest",
  "custom",
] as const;
export type ScheduleKind = (typeof SCHEDULE_KINDS)[number];

/** Statutory rates as they stand for consumer loans; both are parameters. */
export const KKDF_CONSUMER_PCT = 15;
export const BSMV_CONSUMER_PCT = 10;

export interface ScheduleInput {
  kind: ScheduleKind;
  principal: number;
  /** monthly interest rate in percent, the way Turkish banks quote it */
  monthlyRatePct: number;
  termMonths: number;
  /**
   * yyyy-mm-dd the loan is drawn. The first installment falls one month later,
   * which is both the Turkish convention and what the existing annuity engine
   * already does — changing it would silently shift every tracked loan.
   */
  startDate: string;
  currency: Currency;
  /** percentage of the interest, not of the payment */
  kkdfPct: number;
  bsmvPct: number;
  /**
   * For `custom`: the installments you were actually given, in order. The
   * point of this kind is that some credit products do not follow any formula
   * worth reverse-engineering — you have the paper, so you type what it says.
   */
  customInstalments?: number[];
}

export interface TaxedScheduleRow extends ScheduleRow {
  /** KKDF + BSMV charged this period */
  taxes: number;
}

export interface ScheduleResult {
  rows: TaxedScheduleRow[];
  /** the first payment; equal to every payment only for level schedules */
  installment: number;
  totalPaid: number;
  totalInterest: number;
  totalTaxes: number;
  /** true when every installment is the same, which is what lets a loan be
   * represented as a single recurring template rather than dated rows */
  level: boolean;
}

/**
 * The multiplier taxes apply to interest. KKDF and BSMV are both levied on the
 * interest amount, not on each other, so they add rather than compound.
 */
export function taxMultiplier(kkdfPct: number, bsmvPct: number): number {
  return 1 + kkdfPct / 100 + bsmvPct / 100;
}

/**
 * The installment for a taxed annuity.
 *
 * Taxes ride on the interest, and the interest depends on the outstanding
 * balance, which depends on how much of each payment cleared principal — so
 * the rate that actually amortises the loan is the quoted rate grossed up by
 * the levies. That substitution is exact, not an approximation: a loan at
 * 2.89%/month with KKDF and BSMV amortises precisely as an untaxed loan at
 * 2.89 × 1.25 = 3.6125%/month.
 */
export function effectiveMonthlyRate(monthlyRatePct: number, kkdfPct: number, bsmvPct: number): number {
  return monthlyRatePct * taxMultiplier(kkdfPct, bsmvPct);
}

function emptyResult(): ScheduleResult {
  return { rows: [], installment: 0, totalPaid: 0, totalInterest: 0, totalTaxes: 0, level: true };
}

/**
 * Build the repayment schedule.
 *
 * Every kind shares the same bookkeeping: interest accrues on what is still
 * outstanding, taxes accrue on that interest, and whatever is left of the
 * payment clears principal. Only the rule for "how big is this payment"
 * differs, which is why they live in one function rather than five.
 */
export function buildSchedule(input: ScheduleInput): ScheduleResult {
  const term = Math.max(0, Math.floor(input.termMonths));
  const { currency, principal } = input;
  if (term <= 0 || !(principal > 0)) return emptyResult();

  const r = input.kind === "zeroInterest" ? 0 : input.monthlyRatePct / 100;
  const taxRate = input.kind === "zeroInterest" ? 0 : (input.kkdfPct + input.bsmvPct) / 100;

  // For an annuity the level payment has to be solved against the grossed-up
  // rate; every other kind derives its payment from the balance directly.
  const grossedRate = r * (1 + taxRate);
  const levelPayment =
    input.kind === "annuity"
      ? roundTo(monthlyInstallment(principal, grossedRate * 100, term), currency)
      : input.kind === "zeroInterest"
        ? roundTo(principal / term, currency)
        : 0;

  const rows: TaxedScheduleRow[] = [];
  let remaining = principal;
  let totalPaid = 0;
  let totalInterest = 0;
  let totalTaxes = 0;

  for (let n = 1; n <= term; n++) {
    const isLast = n === term;
    const interest = roundTo(remaining * r, currency);
    const taxes = roundTo(interest * taxRate, currency);

    let principalPart: number;
    if (input.kind === "custom") {
      const given = input.customInstalments?.[n - 1] ?? 0;
      // whatever the payment does not spend on interest and taxes reduces the
      // balance; a payment smaller than the carrying cost lets it grow, which
      // is a real thing some products do and worth showing rather than hiding
      principalPart = roundTo(given - interest - taxes, currency);
      if (isLast) principalPart = roundTo(remaining, currency);
    } else if (input.kind === "interestOnly") {
      principalPart = isLast ? roundTo(remaining, currency) : 0;
    } else if (input.kind === "equalPrincipal") {
      principalPart = isLast ? roundTo(remaining, currency) : roundTo(principal / term, currency);
    } else {
      // annuity and zero-interest both aim at a level payment; the final row
      // absorbs the rounding so the balance lands exactly on zero
      principalPart = isLast
        ? roundTo(remaining, currency)
        : roundTo(levelPayment - interest - taxes, currency);
    }

    const payment = roundTo(principalPart + interest + taxes, currency);
    remaining = roundTo(remaining - principalPart, currency);
    totalPaid = roundTo(totalPaid + payment, currency);
    totalInterest = roundTo(totalInterest + interest, currency);
    totalTaxes = roundTo(totalTaxes + taxes, currency);

    rows.push({
      n,
      date: addMonthsClamped(input.startDate, n),
      payment,
      interest,
      principalPart,
      remaining,
      taxes,
    });
  }

  const amounts = rows.map((row) => row.payment);
  const level = amounts.every((a) => a === amounts[0]);

  return {
    rows,
    installment: amounts[0] ?? 0,
    totalPaid,
    totalInterest,
    totalTaxes,
    level,
  };
}

/**
 * The all-in annual cost, compounded — what you would compare between offers.
 * Includes the levies, because a rate quoted before tax is not a price.
 */
export function effectiveAnnualPct(input: ScheduleInput): number {
  if (input.kind === "zeroInterest") return 0;
  const monthly = effectiveMonthlyRate(input.monthlyRatePct, input.kkdfPct, input.bsmvPct) / 100;
  return (Math.pow(1 + monthly, 12) - 1) * 100;
}
