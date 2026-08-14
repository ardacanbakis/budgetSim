import { describe, expect, it } from "vitest";
import { buildSavingsPlan, DEFAULT_SAVINGS_INPUT, SavingsFinanceInput } from "../savingsFinance";
import {
  instalmentForTargetDelivery,
  latestStartForDelivery,
  maxCompliantStepRate,
  maxContractValue,
  stepFactor,
} from "../savingsFinanceSolvers";

const base = (over: Partial<SavingsFinanceInput> = {}): SavingsFinanceInput => ({
  ...DEFAULT_SAVINGS_INPUT,
  startDate: "2026-08-12",
  orgFeePct: 8,
  ...over,
});

describe("stepFactor", () => {
  it("counts flat periods at face value", () => {
    expect(stepFactor(12, 6, 0)).toBe(12);
  });

  it("sums the tier multipliers", () => {
    // six at 1x plus six at 1.15x
    expect(stepFactor(12, 6, 15)).toBeCloseTo(6 + 6 * 1.15, 10);
  });

  it("is zero over no periods", () => {
    expect(stepFactor(0, 6, 15)).toBe(0);
  });
});

describe("maxContractValue", () => {
  it("finds a compliant contract and stops before the first failure", () => {
    const result = maxContractValue({
      ...base(),
      monthlyBudget: 125_000,
      downPayment: 1_500_000,
    } as never);
    expect(result).not.toBeNull();
    expect(result!.plan.compliance.ok).toBe(true);
    expect(result!.contractValue).toBeGreaterThan(0);
  });

  it("scales the down payment with the price when it's locked as a ratio", () => {
    const result = maxContractValue({
      ...base(),
      monthlyBudget: 125_000,
      downPayment: 0,
      lockDownPaymentAsRatio: true,
      downPaymentRatioPct: 30,
    } as never);
    expect(result).not.toBeNull();
    expect(result!.plan.input.downPayment).toBeCloseTo(result!.contractValue * 0.3, 6);
  });

  it("buys more house with a bigger budget", () => {
    const at = (monthlyBudget: number) =>
      maxContractValue({ ...base(), monthlyBudget, downPayment: 1_500_000 } as never)!.contractValue;
    expect(at(200_000)).toBeGreaterThan(at(125_000));
  });

  it("says nothing rather than guessing when there's no budget", () => {
    expect(maxContractValue({ ...base(), monthlyBudget: 0, downPayment: 0 } as never)).toBeNull();
  });
});

describe("maxCompliantStepRate", () => {
  it("prefers the highest rate that still passes", () => {
    // fixture B complies at 15%, so there's nothing to give up
    expect(maxCompliantStepRate(base({ contractValue: 5_000_000, downPayment: 1_500_000, firstInstalment: 125_000 }))).toBe(15);
  });

  it("drops down the ladder when the top rate breaks the spread", () => {
    const rate = maxCompliantStepRate(
      base({ contractValue: 5_000_000, downPayment: 1_500_000, firstInstalment: 100_000 })
    );
    expect(rate).not.toBeNull();
    // whatever it picks must be one of the four the provider sells, and it
    // must actually pass when built
    expect([0, 5, 10, 15]).toContain(rate);
    expect(
      buildSavingsPlan(
        base({ contractValue: 5_000_000, downPayment: 1_500_000, firstInstalment: 100_000, stepRatePct: rate! })
      ).compliance.ok
    ).toBe(true);
  });

  it("returns null when even a flat schedule fails", () => {
    // no delivery is possible at all: the whole thing is paid off in a month
    expect(
      maxCompliantStepRate(base({ contractValue: 5_000_000, downPayment: 4_900_000, firstInstalment: 100_000 }))
    ).toBeNull();
  });
});

describe("instalmentForTargetDelivery", () => {
  const input = base({ contractValue: 5_000_000, downPayment: 1_500_000, firstInstalment: 125_000 });

  it("lands delivery on or before the date asked for", () => {
    const result = instalmentForTargetDelivery(input, "2027-04-12");
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.plan.deliveryDate! <= "2027-04-12").toBe(true);
    expect(result.firstInstalment % 100).toBe(0);
  });

  it("asks for more money when the date is sooner", () => {
    const later = instalmentForTargetDelivery(input, "2027-08-12");
    const sooner = instalmentForTargetDelivery(input, "2027-02-12");
    if ("error" in later || "error" in sooner) throw new Error("both should solve");
    expect(sooner.firstInstalment).toBeGreaterThanOrEqual(later.firstInstalment);
  });

  it("refuses a target before the start date", () => {
    expect(instalmentForTargetDelivery(input, "2026-01-01")).toEqual({ error: "target-before-start" });
  });

  it("refuses a target inside the day lock, however much you pay", () => {
    // four months out — no amount of money clears 180 days
    expect(instalmentForTargetDelivery(input, "2026-12-12")).toEqual({ error: "below-min-days" });
  });
});

describe("latestStartForDelivery", () => {
  it("is six months back, because the day gate can't be outspent", () => {
    expect(latestStartForDelivery("2027-06-15")).toBe("2026-12-15");
  });

  it("clamps a month-end target", () => {
    expect(latestStartForDelivery("2027-08-31")).toBe("2027-02-28");
  });
});
