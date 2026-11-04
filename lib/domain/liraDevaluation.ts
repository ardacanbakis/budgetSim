/**
 * How fast the lira has actually been losing value against the dollar, from
 * the ECB's USD/TRY on today's date and the same date one to five years back
 * (/api/rate-history?devaluation=1). The Gadgets page shows it, and the Plan
 * can take one of the averages as its devaluation assumption.
 *
 * Measured the way the Plan models it (lib/domain/planner.ts): the share of
 * its dollar value the lira loses each year, compounding. If USD/TRY went
 * from 20 to 40 in two years, the lira kept half its value, so it lost
 * 1 − √0.5 ≈ 29.3% a year.
 */

export interface LiraPoint {
  /** 0 = the latest rate */
  yearsAgo: number;
  /** the business day the rate is from */
  date: string;
  /** how many lira one dollar bought */
  tryPerUsd: number;
}

export interface LiraHistory {
  points: LiraPoint[];
  fetchedAt: string;
}

/** The windows the averages are offered over. */
export const DEVALUATION_WINDOWS = [1, 3, 5] as const;

/** The yearly loss, in percent, that takes the lira from `thenRate` to `nowRate` lira a dollar in `years`. */
export function annualLossPct(thenRate: number, nowRate: number, years: number): number | null {
  if (!(thenRate > 0) || !(nowRate > 0) || !(years > 0)) return null;
  const retained = thenRate / nowRate;
  return (1 - Math.pow(retained, 1 / years)) * 100;
}

export interface WindowAverage {
  years: number;
  /** percent a year; negative if the lira gained */
  pct: number;
  from: LiraPoint;
  to: LiraPoint;
}

function byYearsAgo(history: Pick<LiraHistory, "points">): Map<number, LiraPoint> {
  // it arrives over the network: a malformed answer reads as no history rather than breaking the card
  const points = Array.isArray(history?.points) ? history.points : [];
  return new Map(points.filter((p) => p != null && p.tryPerUsd > 0).map((p) => [p.yearsAgo, p]));
}

/** The average yearly loss over each window both ends of which the sources had. */
export function windowAverages(history: Pick<LiraHistory, "points">, windows: readonly number[] = DEVALUATION_WINDOWS): WindowAverage[] {
  const points = byYearsAgo(history);
  const now = points.get(0);
  if (!now) return [];
  const out: WindowAverage[] = [];
  for (const years of windows) {
    const then = points.get(years);
    if (!then) continue;
    const pct = annualLossPct(then.tryPerUsd, now.tryPerUsd, years);
    if (pct != null) out.push({ years, pct, from: then, to: now });
  }
  return out;
}

/** Each single year's loss, most recent first: yearsAgo 1→0, 2→1, … */
export function yearByYear(history: Pick<LiraHistory, "points">): { from: LiraPoint; to: LiraPoint; pct: number }[] {
  const points = byYearsAgo(history);
  const out: { from: LiraPoint; to: LiraPoint; pct: number }[] = [];
  for (let y = 1; points.has(y) && points.has(y - 1); y++) {
    const from = points.get(y)!;
    const to = points.get(y - 1)!;
    out.push({ from, to, pct: annualLossPct(from.tryPerUsd, to.tryPerUsd, 1)! });
  }
  return out;
}

/** USD/TRY `years` from now if the lira keeps losing `pctPerYear` a year. */
export function projectTryPerUsd(nowRate: number, pctPerYear: number, years: number): number | null {
  if (!(nowRate > 0) || !(pctPerYear < 100)) return null;
  return nowRate / Math.pow(1 - pctPerYear / 100, years);
}

/** A window's average as the Plan's slider takes it: a whole percent within its 1–60 range. */
export function planRate(pct: number): number {
  return Math.min(60, Math.max(1, Math.round(pct)));
}
