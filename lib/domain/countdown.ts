/**
 * Date timers for the Gadgets page: a countdown to a moment ahead ("until"),
 * or a count of the time gone by since one ("since"). Only the moment and its
 * kind are stored (the timers table, migration 0024); what's left or what's
 * passed is worked out from the clock every time it's shown.
 *
 * A moment is a full timestamp, so a countdown to 18:30 reaches zero at 18:30
 * wherever the phone or laptop showing it is.
 */

export type TimerKind = "until" | "since";

export interface Span {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** The time between two instants, whichever comes first, in whole units. */
export function spanBetween(aMs: number, bMs: number): Span {
  let left = Math.floor(Math.abs(bMs - aMs) / SECOND) * SECOND;
  const days = Math.floor(left / DAY);
  left -= days * DAY;
  const hours = Math.floor(left / HOUR);
  left -= hours * HOUR;
  const minutes = Math.floor(left / MINUTE);
  left -= minutes * MINUTE;
  return { days, hours, minutes, seconds: Math.floor(left / SECOND) };
}

export type TimerPhase =
  /** a countdown still running */
  | "counting"
  /** a countdown whose moment has come: the span is how long ago */
  | "reached"
  /** a count since a moment that's gone by: the span is how long it's been */
  | "elapsed"
  /** a count since a moment still ahead: the span is how long until it starts */
  | "pending";

export interface TimerState {
  phase: TimerPhase;
  span: Span;
  /** whole calendar years, months and days, for spans long enough to read that way */
  calendar: { years: number; months: number; days: number } | null;
}

/** Where a timer stands at `nowMs`. */
export function timerState(kind: TimerKind, targetAt: string, nowMs: number): TimerState {
  const target = Date.parse(targetAt);
  const ahead = target > nowMs;
  const phase: TimerPhase = kind === "until" ? (ahead ? "counting" : "reached") : ahead ? "pending" : "elapsed";
  const span = spanBetween(nowMs, target);
  return { phase, span, calendar: span.days >= 31 ? calendarSpan(Math.min(nowMs, target), Math.max(nowMs, target)) : null };
}

/**
 * Whole years, months and days from one instant to a later one, by the local
 * calendar: 15 Mar → 14 May is 1 month 29 days. A month that's too short for
 * the start's day counts as reached on its last day.
 */
export function calendarSpan(fromMs: number, toMs: number): { years: number; months: number; days: number } {
  const from = new Date(fromMs);
  const to = new Date(toMs);
  let months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  const stepped = (n: number) => {
    const d = new Date(from);
    const day = from.getDate();
    d.setDate(1);
    d.setMonth(from.getMonth() + n);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, last));
    return d;
  };
  if (stepped(months).getTime() > toMs) months -= 1;
  const anchor = stepped(months);
  // whole days by the calendar, so a daylight-saving change doesn't cost one
  const days = Math.round(
    (Date.UTC(to.getFullYear(), to.getMonth(), to.getDate()) - Date.UTC(anchor.getFullYear(), anchor.getMonth(), anchor.getDate())) / DAY
  );
  const timeOfDay = (d: Date) => d.getHours() * HOUR + d.getMinutes() * MINUTE + d.getSeconds() * SECOND + d.getMilliseconds();
  const wholeDays = timeOfDay(to) < timeOfDay(anchor) ? days - 1 : days;
  return { years: Math.floor(months / 12), months: months % 12, days: Math.max(0, wholeDays) };
}

/** The local date (yyyy-mm-dd) and time (HH:MM) as one stored instant. Null when they don't read as one. */
export function localMoment(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const hm = time.trim() === "" ? "00:00" : time.trim();
  if (!/^\d{2}:\d{2}$/.test(hm)) return null;
  const at = new Date(`${date}T${hm}:00`);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

/** A stored instant back as the local date and time a form shows. */
export function momentParts(targetAt: string): { date: string; time: string } {
  const at = new Date(targetAt);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`,
    time: `${pad(at.getHours())}:${pad(at.getMinutes())}`,
  };
}

/**
 * The order they're shown in: countdowns still running, soonest first; then
 * the counts since a moment, most recent first; countdowns already reached,
 * and counts that haven't started, last.
 */
export function sortTimers<T extends { kind: TimerKind; targetAt: string; name: string }>(timers: T[], nowMs: number): T[] {
  const rank = (t: T) => {
    const phase = timerState(t.kind, t.targetAt, nowMs).phase;
    return phase === "counting" ? 0 : phase === "elapsed" ? 1 : phase === "reached" ? 2 : 3;
  };
  return [...timers].sort((a, b) => {
    const byRank = rank(a) - rank(b);
    if (byRank) return byRank;
    const ta = Date.parse(a.targetAt);
    const tb = Date.parse(b.targetAt);
    // nearest to now first, in every group
    const byTime = Math.abs(ta - nowMs) - Math.abs(tb - nowMs);
    return byTime || a.name.localeCompare(b.name);
  });
}
