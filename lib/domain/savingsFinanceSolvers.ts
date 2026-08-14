import { addMonthsClamped } from "./recurrence";
import {
  buildSavingsPlan,
  CONTRACT_CAP_TRY,
  daysBetween,
  SavingsFinanceInput,
  SavingsPlan,
  StepRatePct,
} from "./savingsFinance";

/**
 * The three questions people actually arrive with: what can I afford, what is
 * the least I can pay, and what do I need to pay to have the keys by a date.
 *
 * Every solver answers by *building a plan and checking it*, never by
 * inverting the formula. The term, the balloon and therefore the one-third
 * spread all depend on where the schedule happens to land, and that is not
 * monotonic in any of the inputs — a 5% step rate spreads worse than a 10%
 * one. Anything cleverer than "propose, build, verify" would be wrong in
 * exactly the cases that matter.
 */

/** Allowed step rates, in the order a solver should prefer them. */
export const STEP_RATES: StepRatePct[] = [15, 10, 5, 0];

/**
 * Sum of the step multipliers over t periods — how many "first instalments"
 * a term is worth. Used to get a starting guess before the search takes over.
 */
export function stepFactor(t: number, stepMonths: number, stepRatePct: number): number {
  const n = Math.max(1, stepMonths);
  let total = 0;
  for (let k = 1; k <= t; k++) total += Math.pow(1 + stepRatePct / 100, Math.floor((k - 1) / n));
  return total;
}

export interface MaxContractInput extends Omit<SavingsFinanceInput, "contractValue" | "firstInstalment"> {
  /** what you can pay a month, as the opening instalment */
  monthlyBudget: number;
  /**
   * When true the down payment scales with the contract value instead of
   * staying a fixed pile of cash — "I have 30% to put down", not "I have ₺1.5m".
   * `downPaymentRatioPct` is then the one that counts.
   */
  lockDownPaymentAsRatio?: boolean;
  downPaymentRatioPct?: number;
}

export interface MaxContractResult {
  contractValue: number;
  plan: SavingsPlan;
}

/**
 * The largest contract this budget can carry.
 *
 * Coarse to fine — ₺250k, then ₺50k, ₺10k, ₺1k — building a full plan and
 * checking compliance at every candidate and stopping at the first failure.
 * A binary search would be faster and wrong: compliance is not monotonic in
 * contract value, so the first failure walking up is the honest answer.
 */
export function maxContractValue(input: MaxContractInput): MaxContractResult | null {
  const { monthlyBudget, lockDownPaymentAsRatio, downPaymentRatioPct, downPayment, ...rest } = input;
  if (!(monthlyBudget > 0)) return null;

  const downRatio = (downPaymentRatioPct ?? 0) / 100;
  const downFor = (contractValue: number) =>
    lockDownPaymentAsRatio ? contractValue * downRatio : downPayment;

  const at = (contractValue: number): SavingsPlan =>
    buildSavingsPlan({
      ...rest,
      contractValue,
      downPayment: downFor(contractValue),
      firstInstalment: monthlyBudget,
    });

  let best: MaxContractResult | null = null;
  let candidate = 0;
  for (const step of [250_000, 50_000, 10_000, 1_000]) {
    let value = candidate + step;
    let entered = best != null;
    while (value <= CONTRACT_CAP_TRY) {
      // below the down payment there is nothing to finance — not a compliance
      // failure, so it must not end the scan
      if (value - downFor(value) <= 0) {
        value += step;
        continue;
      }
      const plan = at(value);
      if (plan.compliance.ok) {
        best = { contractValue: value, plan };
        candidate = value;
        entered = true;
      } else if (entered) {
        // the ceiling: walking up from a compliant contract, the first failure
        // is the answer's edge
        break;
      }
      // small contracts fail too — they pay off before the day gate opens — so
      // the scan has to walk through the floor before it can find the ceiling
      value += step;
    }
  }
  return best;
}

/**
 * The smallest compliant opening instalment at or above the one you have now.
 *
 * Anchored to the current input rather than searched globally, because that is
 * the question being asked: "this violates — what do I raise it to?" A global
 * minimum would answer something useless. On fixture B's terms ₺43,750 is
 * perfectly compliant (a long, gently-stepping term keeps the spread under 3),
 * and offering that as the fix for a ₺100,000 plan would be absurd.
 *
 * Scanned exhaustively in ₺250 steps, never searched. Compliance is neither
 * monotonic nor contiguous: ₺101k–₺104k pass, ₺105k–₺106k fail, ₺107k upward
 * passes again — because raising the instalment eventually drops a period from
 * the term, which moves the balloon and with it the one-third spread. A binary
 * search would confidently return ₺106,250 and be wrong by six thousand lira.
 *
 * It is a band, not a half-line: pay too much and the schedule finishes before
 * day 180, so delivery never triggers at all.
 */
export function minCompliantInstalment(input: SavingsFinanceInput): number | null {
  const passes = (firstInstalment: number) =>
    buildSavingsPlan({ ...input, firstInstalment }).compliance.ok;

  const financed = Math.max(0, input.contractValue - input.downPayment);
  if (financed <= 0) return null;
  // above roughly a quarter of the financed amount the term is too short to
  // clear the day gate, so there is nothing compliant further up to find
  const ceiling = financed / 4;

  const STEP = 250;
  const from = Math.max(STEP, Math.ceil((input.firstInstalment || STEP) / STEP) * STEP);
  for (let value = from; value <= ceiling; value += STEP) {
    if (passes(value)) return value;
  }
  return null;
}

/**
 * The smallest compliant instalment anywhere — the true floor the one-third
 * rule imposes for a given contract size. Useful as a hint on an empty form,
 * where there is no current value to anchor to.
 */
export function floorCompliantInstalment(input: SavingsFinanceInput): number | null {
  return minCompliantInstalment({ ...input, firstInstalment: 0 });
}

/**
 * The highest step rate that still complies, or null if even a flat schedule
 * fails. Walks the four rates the provider sells — no interpolation, because
 * a 7.5% step is not something you can buy.
 */
export function maxCompliantStepRate(input: SavingsFinanceInput): StepRatePct | null {
  for (const stepRatePct of STEP_RATES) {
    if (buildSavingsPlan({ ...input, stepRatePct }).compliance.ok) return stepRatePct;
  }
  return null;
}

export type TargetDeliveryError = "target-before-start" | "below-min-days";

export interface TargetDeliveryResult {
  firstInstalment: number;
  plan: SavingsPlan;
  /** the period delivery actually lands on */
  period: number;
}

/**
 * What opening instalment gets the keys by a date.
 *
 * Estimate from the step factor, round up to a round ₺100, then build and
 * verify — nudging up ₺100 at a time until delivery really lands on or before
 * the target period. The estimate ignores the term rule and the balloon, so it
 * is a starting point rather than an answer.
 */
export function instalmentForTargetDelivery(
  input: SavingsFinanceInput,
  targetDate: string
): TargetDeliveryResult | { error: TargetDeliveryError } {
  if (targetDate < input.startDate) return { error: "target-before-start" };
  if (daysBetween(input.startDate, targetDate) < input.minDeliveryDays) return { error: "below-min-days" };

  // last period whose date still falls on or before the target
  let t = 0;
  while (t < 240 && addMonthsClamped(input.startDate, t) <= targetDate) t += 1;
  if (t === 0) return { error: "target-before-start" };

  const needed = (input.deliveryRatioPct / 100) * input.contractValue - input.downPayment;
  const factor = stepFactor(t, input.stepMonths, input.stepRatePct);
  const guess = factor > 0 ? needed / factor : 0;
  let firstInstalment = Math.max(100, Math.ceil(guess / 100) * 100);

  for (let i = 0; i < 2000; i++) {
    const plan = buildSavingsPlan({ ...input, firstInstalment });
    if (plan.deliveryPeriod != null && plan.deliveryPeriod <= t) {
      return { firstInstalment, plan, period: plan.deliveryPeriod };
    }
    firstInstalment += 100;
  }
  return { error: "below-min-days" };
}

/**
 * The last day you could sign and still be delivered by a target date. Six
 * months is the floor the 180-day gate imposes; paying faster cannot beat it.
 */
export function latestStartForDelivery(targetDate: string): string {
  return addMonthsClamped(targetDate, -6);
}
