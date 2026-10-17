/**
 * A budget against the calendar: how much of the month's limit is gone next
 * to how much of the month is gone, and what is left to spend per day. Pure,
 * over a yyyy-mm-dd `today`, so Home's pace bars can be checked by hand.
 *
 * pace({ spent, limit, today }) →
 * - pct: spent as a percentage of limit (uncapped; 0 when nothing is spent
 *   against a limit of 0, 100 when something is)
 * - elapsedPct: the share of the month gone, today included (day ÷ days in
 *   the month): where the bar's tick sits
 * - tone: "over" at 100% or more, "ahead" when spending runs ahead of the
 *   calendar, else "ok"
 * - daysLeft: days still to come, today included (31 Oct → 1)
 * - perDay: max(0, limit − spent) ÷ daysLeft
 * - over: max(0, spent − limit)
 * - fill: pct capped at 100, the bar's width
 */

export type PaceTone = "ok" | "ahead" | "over";

export interface Pace {
  pct: number;
  elapsedPct: number;
  tone: PaceTone;
  perDay: number;
  daysLeft: number;
  over: number;
  fill: number;
}

/** Days in the month of a yyyy-mm-dd date. */
export function daysInMonth(today: string): number {
  const [y, m] = today.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function pace({ spent, limit, today }: { spent: number; limit: number; today: string }): Pace {
  const total = daysInMonth(today);
  const day = Math.min(total, Math.max(1, Number(today.slice(8, 10))));
  const daysLeft = total - day + 1;
  const elapsedPct = (day / total) * 100;
  const pct = limit > 0 ? (spent / limit) * 100 : spent > 0 ? 100 : 0;
  const tone: PaceTone = pct >= 100 ? "over" : pct > elapsedPct ? "ahead" : "ok";
  return {
    pct,
    elapsedPct,
    tone,
    perDay: Math.max(0, limit - spent) / daysLeft,
    daysLeft,
    over: Math.max(0, spent - limit),
    fill: Math.min(100, Math.max(0, pct)),
  };
}
