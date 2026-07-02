import { Frequency } from "@/lib/data/types";

/**
 * Date math on plain yyyy-mm-dd strings (no timezones — a bill due "2026-07-15"
 * is due that calendar day everywhere).
 */

export function parseISODate(s: string): { y: number; m: number; d: number } {
  const [y, m, d] = s.split("-").map(Number);
  return { y, m, d };
}

export function toISODate(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Add n months, clamping the day (Jan 31 + 1mo → Feb 28/29). */
export function addMonthsClamped(date: string, n: number): string {
  const { y, m, d } = parseISODate(date);
  const totalMonths = y * 12 + (m - 1) + n;
  const ny = Math.floor(totalMonths / 12);
  const nm = (totalMonths % 12) + 1;
  return toISODate(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

export function addDays(date: string, n: number): string {
  const { y, m, d } = parseISODate(date);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return toISODate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export interface RecurrenceSpec {
  frequency: Frequency;
  startDate: string;
  endDate: string | null;
}

/**
 * All occurrence dates of a recurrence within [from, to] inclusive.
 * Monthly recurs on startDate's day-of-month (clamped); weekly every 7 days;
 * yearly on the same month/day (clamped for Feb 29).
 */
export function occurrencesBetween(spec: RecurrenceSpec, from: string, to: string): string[] {
  const result: string[] = [];
  const end = spec.endDate && spec.endDate < to ? spec.endDate : to;
  let i = 0;
  // Hard cap to avoid infinite loops on bad input (10y of weekly ≈ 522).
  for (; i < 1000; i++) {
    const date =
      spec.frequency === "weekly"
        ? addDays(spec.startDate, i * 7)
        : spec.frequency === "monthly"
          ? addMonthsClamped(spec.startDate, i)
          : addMonthsClamped(spec.startDate, i * 12);
    if (date > end) break;
    if (date >= from) result.push(date);
  }
  return result;
}

export function todayISO(): string {
  const now = new Date();
  return toISODate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}
