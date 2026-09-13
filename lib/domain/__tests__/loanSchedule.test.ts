import { describe, expect, it } from "vitest";
import { amortizationSchedule } from "../loan";
import {
  BSMV_CONSUMER_PCT,
  buildSchedule,
  effectiveAnnualPct,
  effectiveMonthlyRate,
  KKDF_CONSUMER_PCT,
  ScheduleInput,
  taxMultiplier,
} from "../loanSchedule";

const base = (over: Partial<ScheduleInput> = {}): ScheduleInput => ({
  kind: "annuity",
  principal: 100_000,
  monthlyRatePct: 2.89,
  termMonths: 12,
  startDate: "2026-09-13",
  currency: "TRY",
  kkdfPct: 0,
  bsmvPct: 0,
  ...over,
});

describe("taxes", () => {
  it("adds rather than compounds, because both are levied on the interest", () => {
    expect(taxMultiplier(KKDF_CONSUMER_PCT, BSMV_CONSUMER_PCT)).toBeCloseTo(1.25, 10);
  });

  it("grosses the quoted rate up by exactly the levies", () => {
    expect(effectiveMonthlyRate(2.89, 15, 10)).toBeCloseTo(3.6125, 10);
  });

  it("charges a commercial loan BSMV but not KKDF", () => {
    expect(taxMultiplier(0, 5)).toBeCloseTo(1.05, 10);
  });
});

describe("annuity", () => {
  it("reproduces the existing engine exactly when there are no taxes", () => {
    // the tracked loans already in the database were built by that engine, so
    // this is the test that says nobody's schedule moved
    const mine = buildSchedule(base());
    const theirs = amortizationSchedule(100_000, 2.89, 12, "2026-09-13", "TRY");
    expect(mine.installment).toBe(theirs.installment);
    expect(mine.rows.map((r) => r.payment)).toEqual(theirs.rows.map((r) => r.payment));
    expect(mine.rows.map((r) => r.date)).toEqual(theirs.rows.map((r) => r.date));
    expect(mine.totalPaid).toBe(theirs.totalPaid);
  });

  it("starts one month after the money is drawn", () => {
    expect(buildSchedule(base()).rows[0].date).toBe("2026-10-13");
  });

  it("costs more once KKDF and BSMV are on it", () => {
    const clean = buildSchedule(base());
    const taxed = buildSchedule(base({ kkdfPct: 15, bsmvPct: 10 }));
    expect(taxed.installment).toBeGreaterThan(clean.installment);
    expect(taxed.totalTaxes).toBeGreaterThan(0);
    // the levies are a quarter of the interest, so they land near a quarter
    expect(taxed.totalTaxes / taxed.totalInterest).toBeCloseTo(0.25, 2);
  });

  it("pays a level installment and lands the balance on zero", () => {
    const s = buildSchedule(base({ kkdfPct: 15, bsmvPct: 10 }));
    expect(s.level).toBe(true);
    expect(new Set(s.rows.map((r) => r.payment)).size).toBeLessThanOrEqual(2); // last row absorbs rounding
    expect(s.rows.at(-1)!.remaining).toBe(0);
  });
});

describe("equal principal", () => {
  const s = buildSchedule(base({ kind: "equalPrincipal", kkdfPct: 15, bsmvPct: 10 }));

  it("clears the same principal every month", () => {
    const parts = s.rows.slice(0, -1).map((r) => r.principalPart);
    expect(new Set(parts).size).toBe(1);
    expect(parts[0]).toBeCloseTo(100_000 / 12, 2);
  });

  it("shrinks the payment as the balance falls", () => {
    expect(s.level).toBe(false);
    expect(s.rows[0].payment).toBeGreaterThan(s.rows.at(-1)!.payment);
  });

  it("costs less overall than an annuity, because the balance falls faster", () => {
    const annuity = buildSchedule(base({ kkdfPct: 15, bsmvPct: 10 }));
    expect(s.totalInterest).toBeLessThan(annuity.totalInterest);
  });

  it("still lands on zero", () => {
    expect(s.rows.at(-1)!.remaining).toBe(0);
  });
});

describe("interest only", () => {
  const s = buildSchedule(base({ kind: "interestOnly", kkdfPct: 15, bsmvPct: 10 }));

  it("pays nothing off until the end", () => {
    expect(s.rows.slice(0, -1).every((r) => r.principalPart === 0)).toBe(true);
    expect(s.rows[0].remaining).toBe(100_000);
  });

  it("repays the whole principal in the final payment", () => {
    const last = s.rows.at(-1)!;
    expect(last.principalPart).toBe(100_000);
    expect(last.payment).toBeGreaterThan(100_000);
    expect(last.remaining).toBe(0);
  });

  it("charges the most interest of any kind, since nothing amortises", () => {
    const annuity = buildSchedule(base({ kkdfPct: 15, bsmvPct: 10 }));
    expect(s.totalInterest).toBeGreaterThan(annuity.totalInterest);
  });
});

describe("zero interest", () => {
  const s = buildSchedule(base({ kind: "zeroInterest", termMonths: 10, kkdfPct: 15, bsmvPct: 10 }));

  it("splits the principal evenly and charges nothing else", () => {
    expect(s.rows.every((r) => r.payment === 10_000)).toBe(true);
    expect(s.totalInterest).toBe(0);
    // no interest means no levies either — they ride on interest, not principal
    expect(s.totalTaxes).toBe(0);
    expect(s.totalPaid).toBe(100_000);
  });

  it("is level, so it can be tracked as one repeating payment", () => {
    expect(s.level).toBe(true);
  });

  it("has no effective rate to quote", () => {
    expect(effectiveAnnualPct(base({ kind: "zeroInterest" }))).toBe(0);
  });
});

describe("custom", () => {
  it("takes the payments you were actually given", () => {
    const given = [10_000, 10_000, 20_000, 20_000, 50_000];
    const s = buildSchedule(
      base({ kind: "custom", termMonths: 5, customInstalments: given, kkdfPct: 15, bsmvPct: 10 })
    );
    expect(s.rows.slice(0, -1).map((r) => r.payment)).toEqual(given.slice(0, -1));
    expect(s.level).toBe(false);
    expect(s.rows.at(-1)!.remaining).toBe(0);
  });

  it("shows a balance growing when a payment doesn't cover the carrying cost", () => {
    // some products really do this; hiding it would be the wrong kindness
    const s = buildSchedule(
      base({ kind: "custom", termMonths: 3, customInstalments: [100, 100, 0], kkdfPct: 15, bsmvPct: 10 })
    );
    expect(s.rows[0].remaining).toBeGreaterThan(100_000);
  });

  it("treats a missing entry as nothing paid rather than throwing", () => {
    const s = buildSchedule(base({ kind: "custom", termMonths: 3, customInstalments: [5_000] }));
    expect(s.rows).toHaveLength(3);
    expect(s.rows[1].payment).toBeLessThanOrEqual(s.rows[1].interest);
  });
});

describe("effectiveAnnualPct", () => {
  it("compounds the grossed-up monthly rate", () => {
    // 2.89%/mo before tax is 3.6125%/mo after, which is ~53%/yr compounded
    expect(effectiveAnnualPct(base({ kkdfPct: 15, bsmvPct: 10 }))).toBeCloseTo(53.06, 1);
  });

  it("is lower without the levies", () => {
    expect(effectiveAnnualPct(base())).toBeLessThan(effectiveAnnualPct(base({ kkdfPct: 15, bsmvPct: 10 })));
  });
});

describe("degenerate input", () => {
  it("gives an empty schedule rather than NaN", () => {
    expect(buildSchedule(base({ termMonths: 0 })).rows).toEqual([]);
    expect(buildSchedule(base({ principal: 0 })).rows).toEqual([]);
    expect(buildSchedule(base({ termMonths: 0 })).installment).toBe(0);
  });

  it("handles a zero rate without dividing by zero", () => {
    const s = buildSchedule(base({ monthlyRatePct: 0, termMonths: 4 }));
    expect(s.totalInterest).toBe(0);
    expect(s.totalPaid).toBe(100_000);
  });
});
