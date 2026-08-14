import { addMonthsClamped, parseISODate } from "./recurrence";

/**
 * Tasarruf finansman ("evim sistemi") — the Turkish interest-free savings
 * finance product sold by Eminevim, Fuzul, Birevim and other BDDK-licensed
 * companies.
 *
 * You pick a contract value, optionally pay a down payment, then pay a monthly
 * instalment that steps up every few months. Once you have paid a required
 * share of the property price AND stayed in the system a required number of
 * days, the property is delivered; the remaining instalments carry on
 * afterwards. There is no interest and no profit share — the only cost line is
 * the organization fee.
 *
 * Everything here is exact integer arithmetic in kuruş (1 TRY = 100 kuruş).
 * Money never touches a float: the provider's own schedules are reproducible
 * to the kuruş only because the rounding rule below is applied at exactly one
 * point, and a float anywhere upstream would quietly break that.
 *
 * TRY only by construction. This product does not exist in another currency,
 * so there is no conversion here and no display-currency handling.
 */

/** The step-up rates a provider actually sells. Not a continuum. */
export type StepRatePct = 0 | 5 | 10 | 15;

export type AssetType = "housing" | "vehicle";

export interface SavingsFinanceInput {
  /** contract value K — the full property price, in TRY */
  contractValue: number;
  /** down payment P, in TRY */
  downPayment: number;
  /** first instalment T0, in TRY */
  firstInstalment: number;
  /** months between step-ups (n) */
  stepMonths: number;
  /** step-up rate g, one of 0 / 5 / 10 / 15 */
  stepRatePct: StepRatePct;
  /** yyyy-mm-dd, the signing date; period 1 falls on it */
  startDate: string;
  /** organization fee as a percentage of the contract value */
  orgFeePct: number;
  /** how much of the fee is paid at signing, as a percentage of the fee */
  orgFeeUpfrontPct: number;
  /** how many monthly instalments the rest of the fee is spread over */
  orgFeeInstalments: number;
  assetType: AssetType;
  /**
   * BDDK delivery gates. Parameters, never constants: they moved from
   * 40% / 150 days to 45% / 180 days on 2026-07-01, and a quote signed under
   * the old regime still has to reproduce exactly.
   */
  deliveryRatioPct: number;
  minDeliveryDays: number;
}

export const DEFAULT_SAVINGS_INPUT: Omit<SavingsFinanceInput, "startDate"> = {
  contractValue: 5_000_000,
  downPayment: 1_500_000,
  firstInstalment: 125_000,
  stepMonths: 6,
  stepRatePct: 15,
  orgFeePct: 7,
  orgFeeUpfrontPct: 50,
  orgFeeInstalments: 3,
  assetType: "housing",
  deliveryRatioPct: 45,
  minDeliveryDays: 180,
};

export interface SavingsRow {
  /** 1-based */
  period: number;
  date: string;
  /** TRY */
  instalment: number;
  /** everything paid in instalments up to and including this period, TRY */
  cumulative: number;
  /** (downPayment + cumulative) / contractValue, 0..1+ */
  ratio: number;
  /** calendar days from startDate to this row's date */
  days: number;
  /** first period of a new step tier */
  isTierStart: boolean;
  /** the final period, when it absorbs more than a regular instalment would */
  isBalloon: boolean;
  /** organization fee due this month, TRY */
  orgFeeInstalment: number;
  /** instalment + orgFeeInstalment — what actually leaves your account */
  cashOut: number;
}

export interface ComplianceRule {
  ok: boolean;
  actual: number;
  limit: number;
  message: string;
}

export interface SavingsCompliance {
  ok: boolean;
  deliveryThreshold: ComplianceRule;
  oneThirdRule: ComplianceRule;
  maxTerm: ComplianceRule;
  contractCap: ComplianceRule;
  /** contracts this large get extra scrutiny; not a failure */
  highValue: boolean;
}

export interface SavingsPlan {
  input: SavingsFinanceInput;
  rows: SavingsRow[];
  financedAmount: number;
  termMonths: number;
  /**
   * 0-based index into `rows` of the delivery period, or null if the plan
   * never reaches the threshold. Use `deliveryPeriod` for anything shown to a
   * human — that one is the 1-based period number on the row.
   */
  deliveryIndex: number | null;
  deliveryPeriod: number | null;
  deliveryDate: string | null;
  deliveryRatio: number | null;
  /** what you still pay each month after the keys are handed over */
  postDeliveryInstalment: number | null;
  minInstalment: number;
  maxInstalment: number;
  /** max / min — the BDDK one-third rule is this staying at or under 3 */
  spreadRatio: number;
  orgFee: number;
  orgFeeUpfront: number;
  orgFeeMonthly: number;
  /** every instalment plus the whole organization fee */
  totalCost: number;
  /** down payment + the upfront half of the fee, due on signing day */
  cashAtSigning: number;
  /** everything paid from signing up to and including the delivery period */
  cashUntilDelivery: number | null;
  compliance: SavingsCompliance;
}

/** BDDK contract ceiling, TRY. */
export const CONTRACT_CAP_TRY = 62_500_000;
/** Above this a contract is "high value" and gets extra scrutiny. */
export const HIGH_VALUE_TRY = 12_500_000;
export const MAX_TERM_MONTHS: Record<AssetType, number> = { housing: 120, vehicle: 60 };
/** min instalment must be at least max / 3 */
export const SPREAD_LIMIT = 3;

const KURUS = 100;

export const toKurus = (try_: number): number => Math.round(Number((try_ * KURUS).toPrecision(15)));
export const fromKurus = (kurus: number): number => kurus / KURUS;

/**
 * Round to the nearest 10 kuruş, halves up.
 *
 * This is not cosmetic tidying — it is the provider's own rule, and it is what
 * makes 165312.50 × 1.15 = 190109.375 come out as 190109.40 rather than
 * 190109.38. Applied at exactly one place (the regular instalment) so the
 * schedule reproduces a real quote to the kuruş.
 */
export function roundToDecikurus(kurus: number): number {
  return Math.round(kurus / 10) * 10;
}

/**
 * The regular instalment for 1-based period k, in kuruş.
 *
 * Always computed from T0 rather than by compounding the previous tier, so a
 * rounding step can never accumulate across tiers.
 */
export function regularInstalmentKurus(
  firstInstalmentKurus: number,
  period: number,
  stepMonths: number,
  stepRatePct: number
): number {
  const tier = Math.floor((period - 1) / Math.max(1, stepMonths));
  const factor = Math.pow(1 + stepRatePct / 100, tier);
  return roundToDecikurus(firstInstalmentKurus * factor);
}

/** Exact calendar days between two yyyy-mm-dd dates (UTC, date-only). */
export function daysBetween(from: string, to: string): number {
  const a = parseISODate(from);
  const b = parseISODate(to);
  const ms = Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d);
  return Math.round(ms / 86_400_000);
}

/**
 * Build the whole schedule.
 *
 * Term is not "divide and dump the remainder in the last row". The provider's
 * rule is: if what's left is less than this period's and the next period's
 * regular instalments together, this period is the last and swallows the lot.
 * That is why a real quote ends on an instalment *larger* than a regular one,
 * and never leaves a stub smaller than one.
 */
export function buildSavingsPlan(input: SavingsFinanceInput): SavingsPlan {
  const contractK = toKurus(input.contractValue);
  const downK = toKurus(input.downPayment);
  const financedK = contractK - downK;
  const t0K = toKurus(input.firstInstalment);
  const stepMonths = Math.max(1, Math.floor(input.stepMonths));

  const regular = (k: number) => regularInstalmentKurus(t0K, k, stepMonths, input.stepRatePct);

  const orgFeeK = roundToDecikurus((contractK * input.orgFeePct) / 100);
  const orgFeeUpfrontK = roundToDecikurus((orgFeeK * input.orgFeeUpfrontPct) / 100);
  const feeInstalments = Math.max(0, Math.floor(input.orgFeeInstalments));
  const orgFeeMonthlyK =
    feeInstalments > 0 ? roundToDecikurus((orgFeeK - orgFeeUpfrontK) / feeInstalments) : 0;
  // the last fee instalment absorbs the rounding, the same way the balloon
  // absorbs it on the schedule — otherwise three equal thirds of ₺200,000 add
  // up to ₺200,000.10 and the cashflow no longer reconciles
  const orgFeeFinalK =
    feeInstalments > 0 ? orgFeeK - orgFeeUpfrontK - orgFeeMonthlyK * (feeInstalments - 1) : 0;
  const feeAt = (k: number): number =>
    k > feeInstalments ? 0 : k === feeInstalments ? orgFeeFinalK : orgFeeMonthlyK;

  const rows: SavingsRow[] = [];
  let cumK = 0;
  let k = 0;
  // guard: a term this long is already non-compliant, and an instalment of
  // zero would otherwise spin forever
  const HARD_CAP = 1000;
  while (cumK < financedK && k < HARD_CAP && t0K > 0) {
    k += 1;
    const remaining = financedK - cumK;
    const reg = regular(k);
    const isLast = remaining < reg + regular(k + 1);
    const amountK = isLast ? remaining : reg;
    cumK += amountK;

    const date = addMonthsClamped(input.startDate, k - 1);
    rows.push({
      period: k,
      date,
      instalment: fromKurus(amountK),
      cumulative: fromKurus(cumK),
      ratio: (downK + cumK) / contractK,
      days: daysBetween(input.startDate, date),
      isTierStart: k > 1 && (k - 1) % stepMonths === 0,
      // at g=0 the last row lands exactly on a regular instalment; that is a
      // clean finish, not a balloon
      isBalloon: isLast && amountK > reg,
      orgFeeInstalment: fromKurus(feeAt(k)),
      cashOut: fromKurus(amountK + feeAt(k)),
    });
  }

  // Two gates, evaluated independently: paying the share early does not buy
  // you the keys early, and sitting out the days does not help if you haven't
  // paid enough. The epsilon makes an exact 45.00% qualify rather than losing
  // to a division that landed a hair low.
  const threshold = input.deliveryRatioPct / 100 - 1e-9;
  const deliveryIndex = rows.findIndex((r) => r.ratio >= threshold && r.days >= input.minDeliveryDays);
  const delivery = deliveryIndex >= 0 ? rows[deliveryIndex] : null;

  const instalments = rows.map((r) => r.instalment);
  const minInstalment = instalments.length ? Math.min(...instalments) : 0;
  const maxInstalment = instalments.length ? Math.max(...instalments) : 0;
  const spreadRatio = minInstalment > 0 ? maxInstalment / minInstalment : Infinity;

  const totalInstalmentsK = rows.reduce((sum, r) => sum + toKurus(r.instalment), 0);
  const cashAtSigningK = downK + orgFeeUpfrontK;
  const cashUntilDeliveryK =
    delivery == null
      ? null
      : cashAtSigningK +
        rows.slice(0, deliveryIndex + 1).reduce((sum, r) => sum + toKurus(r.cashOut), 0);

  const maxTerm = MAX_TERM_MONTHS[input.assetType];
  const compliance: SavingsCompliance = {
    ok: false,
    deliveryThreshold: {
      ok: delivery != null,
      actual: delivery?.period ?? 0,
      limit: rows.length,
      message: "deliveryThreshold",
    },
    oneThirdRule: {
      // the down payment is excluded and the balloon is included: the rule is
      // about the spread of the instalments themselves
      ok: minInstalment > 0 && maxInstalment <= minInstalment * SPREAD_LIMIT,
      actual: spreadRatio,
      limit: SPREAD_LIMIT,
      message: "oneThirdRule",
    },
    maxTerm: {
      ok: rows.length > 0 && rows.length <= maxTerm,
      actual: rows.length,
      limit: maxTerm,
      message: "maxTerm",
    },
    contractCap: {
      ok: input.contractValue <= CONTRACT_CAP_TRY,
      actual: input.contractValue,
      limit: CONTRACT_CAP_TRY,
      message: "contractCap",
    },
    highValue: input.contractValue >= HIGH_VALUE_TRY,
  };
  compliance.ok =
    compliance.deliveryThreshold.ok &&
    compliance.oneThirdRule.ok &&
    compliance.maxTerm.ok &&
    compliance.contractCap.ok;

  return {
    input,
    rows,
    financedAmount: fromKurus(financedK),
    termMonths: rows.length,
    deliveryIndex: deliveryIndex >= 0 ? deliveryIndex : null,
    deliveryPeriod: delivery?.period ?? null,
    deliveryDate: delivery?.date ?? null,
    deliveryRatio: delivery?.ratio ?? null,
    postDeliveryInstalment:
      delivery != null && deliveryIndex + 1 < rows.length ? rows[deliveryIndex + 1].instalment : null,
    minInstalment,
    maxInstalment,
    spreadRatio,
    orgFee: fromKurus(orgFeeK),
    orgFeeUpfront: fromKurus(orgFeeUpfrontK),
    orgFeeMonthly: fromKurus(orgFeeMonthlyK),
    totalCost: fromKurus(totalInstalmentsK + orgFeeK),
    cashAtSigning: fromKurus(cashAtSigningK),
    cashUntilDelivery: cashUntilDeliveryK == null ? null : fromKurus(cashUntilDeliveryK),
    compliance,
  };
}

/** What a saved scenario carries. Inputs only — the schedule is derived. */
export interface SavingsPlanBody {
  input: SavingsFinanceInput;
  presetId: string;
}

const STEP_RATE_VALUES: StepRatePct[] = [0, 5, 10, 15];

/**
 * Coerce a stored body back into a usable input. Anything missing or out of
 * range falls back to the default rather than reaching the engine, because a
 * malformed row should open as a sane plan you can fix, not a blank page or a
 * schedule of NaN.
 */
export function normalizeSavingsBody(raw: unknown, today: string): SavingsPlanBody {
  const saved = (raw ?? {}) as Partial<SavingsPlanBody>;
  const input = (saved.input ?? {}) as Partial<SavingsFinanceInput>;
  const num = (value: unknown, fallback: number, min = 0): number =>
    typeof value === "number" && Number.isFinite(value) && value >= min ? value : fallback;
  const stepRate = STEP_RATE_VALUES.includes(input.stepRatePct as StepRatePct)
    ? (input.stepRatePct as StepRatePct)
    : DEFAULT_SAVINGS_INPUT.stepRatePct;
  return {
    presetId: typeof saved.presetId === "string" ? saved.presetId : "eminevim",
    input: {
      contractValue: num(input.contractValue, DEFAULT_SAVINGS_INPUT.contractValue, 1),
      downPayment: num(input.downPayment, DEFAULT_SAVINGS_INPUT.downPayment),
      firstInstalment: num(input.firstInstalment, DEFAULT_SAVINGS_INPUT.firstInstalment, 1),
      stepMonths: num(input.stepMonths, DEFAULT_SAVINGS_INPUT.stepMonths, 1),
      stepRatePct: stepRate,
      startDate: typeof input.startDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.startDate)
        ? input.startDate
        : today,
      orgFeePct: num(input.orgFeePct, DEFAULT_SAVINGS_INPUT.orgFeePct),
      orgFeeUpfrontPct: num(input.orgFeeUpfrontPct, DEFAULT_SAVINGS_INPUT.orgFeeUpfrontPct),
      orgFeeInstalments: num(input.orgFeeInstalments, DEFAULT_SAVINGS_INPUT.orgFeeInstalments),
      assetType: input.assetType === "vehicle" ? "vehicle" : "housing",
      // thresholds are stored per plan so an old quote still reproduces under
      // the regime it was signed under
      deliveryRatioPct: num(input.deliveryRatioPct, DEFAULT_SAVINGS_INPUT.deliveryRatioPct, 1),
      minDeliveryDays: num(input.minDeliveryDays, DEFAULT_SAVINGS_INPUT.minDeliveryDays, 0),
    },
  };
}
