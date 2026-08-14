import { describe, expect, it } from "vitest";
import {
  buildSavingsPlan,
  DEFAULT_SAVINGS_INPUT,
  roundToDecikurus,
  SavingsFinanceInput,
  StepRatePct,
  toKurus,
} from "../savingsFinance";
import { floorCompliantInstalment, minCompliantInstalment } from "../savingsFinanceSolvers";

/**
 * Golden fixtures reverse-engineered from real Eminevim quotes. These match to
 * the kuruş, so they are asserted exactly — a tolerance here would let the
 * rounding rule drift and nobody would notice until a schedule disagreed with
 * the provider's paperwork.
 */

const base = (over: Partial<SavingsFinanceInput> = {}): SavingsFinanceInput => ({
  ...DEFAULT_SAVINGS_INPUT,
  startDate: "2026-08-12",
  orgFeePct: 8,
  ...over,
});

const fixtureA = () =>
  base({ contractValue: 3_000_000, downPayment: 0, firstInstalment: 150_000 });

const fixtureB = () =>
  base({ contractValue: 5_000_000, downPayment: 1_500_000, firstInstalment: 125_000 });

describe("roundToDecikurus", () => {
  it("rounds to the nearest 10 kuruş, halves up", () => {
    // the case the whole schedule hinges on: 165312.50 × 1.15
    expect(roundToDecikurus(16_531_250 * 1.15)).toBe(19_010_940);
    expect(roundToDecikurus(1_004)).toBe(1_000);
    expect(roundToDecikurus(1_005)).toBe(1_010);
    expect(roundToDecikurus(1_006)).toBe(1_010);
  });
});

describe("fixture A — ₺3,000,000, no down payment, ₺150,000 first instalment", () => {
  const plan = buildSavingsPlan(fixtureA());

  it("runs 17 instalments", () => {
    expect(plan.termMonths).toBe(17);
  });

  it("steps in the tiers the provider quotes", () => {
    for (let k = 1; k <= 6; k++) expect(plan.rows[k - 1].instalment).toBe(150_000);
    for (let k = 7; k <= 12; k++) expect(plan.rows[k - 1].instalment).toBe(172_500);
    for (let k = 13; k <= 16; k++) expect(plan.rows[k - 1].instalment).toBe(198_375);
  });

  it("ends on a balloon of ₺271,500.00", () => {
    const last = plan.rows.at(-1)!;
    expect(last.period).toBe(17);
    expect(last.instalment).toBe(271_500);
    expect(last.isBalloon).toBe(true);
  });

  it("delivers at period 9, on 2027-04-12, at 47.25% and 243 days", () => {
    expect(plan.deliveryPeriod).toBe(9);
    expect(plan.deliveryDate).toBe("2027-04-12");
    expect(plan.deliveryRatio).toBeCloseTo(0.4725, 12);
    expect(plan.rows[8].days).toBe(243);
  });

  it("skips period 8, which is still under the threshold at 41.50%", () => {
    expect(plan.rows[7].ratio).toBeCloseTo(0.415, 12);
    expect(plan.rows[7].ratio).toBeLessThan(0.45);
  });

  it("spreads 1.8100x and charges ₺240,000.00 in fees", () => {
    expect(plan.spreadRatio).toBeCloseTo(1.81, 10);
    expect(plan.orgFee).toBe(240_000);
  });
});

describe("fixture B — ₺5,000,000 with ₺1,500,000 down, ₺125,000 first instalment", () => {
  const plan = buildSavingsPlan(fixtureB());

  it("runs 22 instalments", () => {
    expect(plan.termMonths).toBe(22);
  });

  it("steps in the tiers the provider quotes", () => {
    for (let k = 1; k <= 6; k++) expect(plan.rows[k - 1].instalment).toBe(125_000);
    for (let k = 7; k <= 12; k++) expect(plan.rows[k - 1].instalment).toBe(143_750);
    for (let k = 13; k <= 18; k++) expect(plan.rows[k - 1].instalment).toBe(165_312.5);
    // 165312.50 × 1.15 = 190109.375 → 190109.40, not 190109.38
    for (let k = 19; k <= 21; k++) expect(plan.rows[k - 1].instalment).toBe(190_109.4);
  });

  it("ends on a balloon of ₺325,296.80", () => {
    const last = plan.rows.at(-1)!;
    expect(last.period).toBe(22);
    expect(last.instalment).toBe(325_296.8);
    expect(last.isBalloon).toBe(true);
  });

  it("accumulates exactly as the quote does", () => {
    const cum = (k: number) => plan.rows[k - 1].cumulative;
    expect(cum(6)).toBe(750_000);
    expect(cum(12)).toBe(1_612_500);
    expect(cum(18)).toBe(2_604_375);
    expect(cum(21)).toBe(3_174_703.2);
    expect(cum(22)).toBe(3_500_000);
  });

  it("delivers at period 7, on 2027-02-12, at 47.875% and 184 days", () => {
    expect(plan.deliveryPeriod).toBe(7);
    expect(plan.deliveryDate).toBe("2027-02-12");
    expect(plan.deliveryRatio).toBeCloseTo(0.47875, 12);
    expect(plan.rows[6].days).toBe(184);
  });

  /**
   * The test that matters most. At period 6 the ratio is exactly 45.00% — the
   * threshold, met to the kuruş — and the day count is 153. If the two gates
   * were ever collapsed into one, this period would wrongly deliver.
   */
  it("blocks period 6 even at exactly 45.00%, because only 153 days have passed", () => {
    expect(plan.rows[5].ratio).toBe(0.45);
    expect(plan.rows[5].days).toBe(153);
    expect(plan.deliveryIndex).toBe(6);
    expect(plan.deliveryIndex).not.toBe(5);
  });

  it("spreads 2.6024x and charges ₺400,000.00 in fees", () => {
    expect(plan.spreadRatio).toBeCloseTo(2.6024, 4);
    expect(plan.orgFee).toBe(400_000);
  });
});

describe("the 180-day lock", () => {
  it("makes delivery before period 7 impossible whatever month you sign", () => {
    // five calendar months tops out at 153 days, so period 6 can never clear
    // 180 no matter how much has been paid
    for (let month = 1; month <= 12; month++) {
      const startDate = `2026-${String(month).padStart(2, "0")}-12`;
      const plan = buildSavingsPlan(base({ startDate, downPayment: 4_000_000, contractValue: 5_000_000 }));
      expect(plan.rows[5].days).toBeGreaterThanOrEqual(150);
      expect(plan.rows[5].days).toBeLessThanOrEqual(153);
      expect(plan.deliveryPeriod!).toBeGreaterThanOrEqual(7);
    }
  });
});

describe("the one-third rule is the binding constraint", () => {
  it("fails at ₺100,000: the term stretches, the balloon grows, the spread breaks", () => {
    const plan = buildSavingsPlan(base({ contractValue: 5_000_000, downPayment: 1_500_000, firstInstalment: 100_000 }));
    expect(plan.termMonths).toBe(26);
    expect(plan.rows.at(-1)!.instalment).toBe(329_074.4);
    expect(plan.spreadRatio).toBeCloseTo(3.291, 3);
    expect(plan.compliance.oneThirdRule.ok).toBe(false);
  });

  it("passes at ₺110,000", () => {
    const plan = buildSavingsPlan(base({ contractValue: 5_000_000, downPayment: 1_500_000, firstInstalment: 110_000 }));
    expect(plan.termMonths).toBe(25);
    expect(plan.spreadRatio).toBeCloseTo(1.858, 3);
    expect(plan.compliance.oneThirdRule.ok).toBe(true);
  });

  it("finds the fix between the two", () => {
    const violating = base({ contractValue: 5_000_000, downPayment: 1_500_000, firstInstalment: 100_000 });
    const found = minCompliantInstalment(violating);
    expect(found).toBe(101_000);
    expect(found!).toBeGreaterThan(100_000);
    expect(found!).toBeLessThanOrEqual(110_000);
    expect(buildSavingsPlan({ ...violating, firstInstalment: found! }).compliance.ok).toBe(true);
  });

  it("is not contiguous, which is why the fix is scanned and never searched", () => {
    // raising the instalment eventually drops a period from the term, which
    // moves the balloon and with it the spread — so passing at ₺104k says
    // nothing about ₺105k
    const ok = (firstInstalment: number) =>
      buildSavingsPlan(base({ contractValue: 5_000_000, downPayment: 1_500_000, firstInstalment })).compliance.ok;
    expect(ok(104_000)).toBe(true);
    expect(ok(105_000)).toBe(false);
    expect(ok(107_000)).toBe(true);
  });

  it("has a true floor far below, which is why the fix is anchored to your input", () => {
    // ₺43,750 complies on its own terms; offering it as the fix for a
    // ₺100,000 plan would be useless advice
    const floor = floorCompliantInstalment(base({ contractValue: 5_000_000, downPayment: 1_500_000, firstInstalment: 100_000 }));
    expect(floor).toBe(43_750);
    expect(floor!).toBeLessThan(100_000);
  });
});

describe("month-end clamping", () => {
  it("walks 31 Jan to 28 Feb and back out to 31 Mar", () => {
    const plan = buildSavingsPlan(base({ startDate: "2026-01-31" }));
    expect(plan.rows[0].date).toBe("2026-01-31");
    expect(plan.rows[1].date).toBe("2026-02-28");
    expect(plan.rows[2].date).toBe("2026-03-31");
  });
});

describe("the old BDDK regime", () => {
  it("delivers fixture B a month earlier at 40% / 150 days", () => {
    const plan = buildSavingsPlan(
      base({
        contractValue: 5_000_000,
        downPayment: 1_500_000,
        firstInstalment: 125_000,
        deliveryRatioPct: 40,
        minDeliveryDays: 150,
      })
    );
    expect(plan.deliveryPeriod).toBe(6);
    expect(plan.deliveryDate).toBe("2027-01-12");
  });
});

describe("no drift", () => {
  it("sums the instalments back to the financed amount exactly", () => {
    for (const plan of [buildSavingsPlan(fixtureA()), buildSavingsPlan(fixtureB())]) {
      const sum = plan.rows.reduce((total, r) => total + toKurus(r.instalment), 0);
      expect(sum).toBe(toKurus(plan.financedAmount));
    }
  });
});

describe("every step rate the provider sells", () => {
  const cases: Array<{
    g: StepRatePct;
    term: number;
    final: number;
    spread: number;
    ratio: number;
  }> = [
    { g: 0, term: 28, final: 125_000, spread: 1.0, ratio: 0.475 },
    { g: 5, term: 25, final: 267_406.4, spread: 2.1393, ratio: 0.47625 },
    { g: 10, term: 24, final: 185_625, spread: 1.485, ratio: 0.4775 },
    { g: 15, term: 22, final: 325_296.8, spread: 2.6024, ratio: 0.47875 },
  ];

  for (const c of cases) {
    it(`at ${c.g}% runs ${c.term} instalments and spreads ${c.spread}x`, () => {
      const plan = buildSavingsPlan(
        base({ contractValue: 5_000_000, downPayment: 1_500_000, firstInstalment: 125_000, stepRatePct: c.g })
      );
      expect(plan.termMonths).toBe(c.term);
      expect(plan.rows.at(-1)!.instalment).toBe(c.final);
      expect(plan.spreadRatio).toBeCloseTo(c.spread, 4);
      // the day gate binds in every case, so delivery lands in the same month
      expect(plan.deliveryPeriod).toBe(7);
      expect(plan.deliveryDate).toBe("2027-02-12");
      expect(plan.deliveryRatio).toBeCloseTo(c.ratio, 12);
    });
  }

  it("finishes flat at 0% with no balloon, because it divides exactly", () => {
    const plan = buildSavingsPlan(
      base({ contractValue: 5_000_000, downPayment: 1_500_000, firstInstalment: 125_000, stepRatePct: 0 })
    );
    expect(plan.rows.every((r) => r.instalment === 125_000)).toBe(true);
    expect(plan.rows.some((r) => r.isBalloon)).toBe(false);
    expect(plan.rows.some((r) => r.isTierStart && r.instalment !== 125_000)).toBe(false);
  });

  it("does not move monotonically with the step rate", () => {
    // 5% spreads worse than 10%, because the balloon depends on where the term
    // happens to land — so compliance must always be read off a built plan,
    // never inferred from the rate
    const spread = (g: StepRatePct) =>
      buildSavingsPlan(
        base({ contractValue: 5_000_000, downPayment: 1_500_000, firstInstalment: 125_000, stepRatePct: g })
      ).spreadRatio;
    expect(spread(5)).toBeGreaterThan(spread(10));
  });
});

describe("organization fee", () => {
  const plan = buildSavingsPlan(fixtureB());

  it("is charged on the full property price, half at signing", () => {
    expect(plan.orgFee).toBe(400_000);
    expect(plan.orgFeeUpfront).toBe(200_000);
    // three equal thirds don't exist in whole decikuruş, so the last one takes
    // the remainder and the three still sum to the fee exactly
    expect(plan.orgFeeMonthly).toBe(66_666.7);
    expect(plan.rows[0].orgFeeInstalment + plan.rows[1].orgFeeInstalment + plan.rows[2].orgFeeInstalment).toBe(
      200_000
    );
  });

  it("hits cashflow for the first three months only", () => {
    expect(plan.rows[0].cashOut).toBeGreaterThan(plan.rows[0].instalment);
    expect(plan.rows[2].orgFeeInstalment).toBeGreaterThan(0);
    expect(plan.rows[3].orgFeeInstalment).toBe(0);
    expect(plan.rows[3].cashOut).toBe(plan.rows[3].instalment);
  });

  it("stays out of the delivery ratio", () => {
    // the ratio counts the down payment and the instalments, nothing else
    expect(plan.rows[5].ratio).toBe(0.45);
  });

  it("is due in full at signing alongside the down payment", () => {
    expect(plan.cashAtSigning).toBe(1_500_000 + 200_000);
  });
});

describe("compliance", () => {
  it("caps housing at 120 months and vehicles at 60", () => {
    const long = base({
      contractValue: 5_000_000,
      downPayment: 0,
      firstInstalment: 60_000,
      stepRatePct: 0,
      assetType: "vehicle",
    });
    expect(buildSavingsPlan(long).compliance.maxTerm.ok).toBe(false);
    expect(buildSavingsPlan({ ...long, assetType: "housing" }).compliance.maxTerm.ok).toBe(true);
  });

  it("rejects a contract over ₺62,500,000 and flags one over ₺12,500,000", () => {
    const over = buildSavingsPlan(base({ contractValue: 70_000_000, downPayment: 0, firstInstalment: 2_000_000 }));
    expect(over.compliance.contractCap.ok).toBe(false);
    expect(over.compliance.highValue).toBe(true);
    expect(buildSavingsPlan(fixtureB()).compliance.highValue).toBe(false);
  });

  it("passes fixture B on every rule", () => {
    expect(buildSavingsPlan(fixtureB()).compliance.ok).toBe(true);
  });
});
