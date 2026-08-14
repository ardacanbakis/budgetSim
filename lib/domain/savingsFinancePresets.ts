import { SavingsFinanceInput, StepRatePct } from "./savingsFinance";

/**
 * Provider presets.
 *
 * The allowed step rates live here rather than in the engine on purpose: they
 * are a commercial choice, not arithmetic. Eminevim sells 0/5/10/15; another
 * company may sell a different ladder, and the engine must not have to change
 * for that. Same for the fee split and the step period.
 *
 * The BDDK thresholds are *not* preset properties — they are the law, the same
 * for every provider, and they belong to the plan so an old quote signed under
 * the old regime still reproduces.
 */
export interface SavingsProviderPreset {
  id: string;
  name: string;
  /** null on the blank preset — nothing is prescribed */
  orgFeePct: number | null;
  orgFeeUpfrontPct: number | null;
  orgFeeInstalments: number | null;
  stepMonths: number | null;
  /** the step ladder this company actually sells */
  stepRates: StepRatePct[];
}

export const ALL_STEP_RATES: StepRatePct[] = [0, 5, 10, 15];

export const SAVINGS_PRESETS: SavingsProviderPreset[] = [
  {
    id: "eminevim",
    name: "Eminevim",
    orgFeePct: 7,
    orgFeeUpfrontPct: 50,
    orgFeeInstalments: 3,
    stepMonths: 6,
    stepRates: [0, 5, 10, 15],
  },
  {
    id: "custom",
    name: "Custom",
    orgFeePct: null,
    orgFeeUpfrontPct: null,
    orgFeeInstalments: null,
    stepMonths: null,
    stepRates: [0, 5, 10, 15],
  },
];

export const DEFAULT_PRESET_ID = "eminevim";

export function presetById(id: string): SavingsProviderPreset {
  return SAVINGS_PRESETS.find((p) => p.id === id) ?? SAVINGS_PRESETS[SAVINGS_PRESETS.length - 1];
}

/** Apply a preset's commercial terms, leaving everything else as it was. */
export function applyPreset(input: SavingsFinanceInput, presetId: string): SavingsFinanceInput {
  const preset = presetById(presetId);
  const next = { ...input };
  if (preset.orgFeePct != null) next.orgFeePct = preset.orgFeePct;
  if (preset.orgFeeUpfrontPct != null) next.orgFeeUpfrontPct = preset.orgFeeUpfrontPct;
  if (preset.orgFeeInstalments != null) next.orgFeeInstalments = preset.orgFeeInstalments;
  if (preset.stepMonths != null) next.stepMonths = preset.stepMonths;
  // a preset that doesn't sell your current step rate moves you to the nearest
  // one it does, rather than leaving an unsellable plan on screen
  if (!preset.stepRates.includes(next.stepRatePct)) {
    next.stepRatePct = preset.stepRates.reduce((best, r) =>
      Math.abs(r - next.stepRatePct) < Math.abs(best - next.stepRatePct) ? r : best
    );
  }
  return next;
}
