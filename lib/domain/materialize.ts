import { Frequency, RecurringTemplate, Transaction } from "@/lib/data/types";
import { addDays, addMonthsClamped, localDateOf, occurrencesBetween, RecurrenceSpec, todayISO } from "./recurrence";

/** How far ahead recurring items are created, on app open and after an edit. */
export const MATERIALIZE_MONTHS_AHEAD = 12;

export interface MissingOccurrence {
  template: RecurringTemplate;
  dueDate: string;
}

/**
 * Whether two dates fall in the same slot of a schedule: the same calendar
 * month for a monthly one, the same year for a yearly one, and within three
 * days of each other for a weekly one (half the gap between two dates).
 */
function samePeriod(frequency: Frequency, a: string, b: string): boolean {
  if (frequency === "monthly") return a.slice(0, 7) === b.slice(0, 7);
  if (frequency === "yearly") return a.slice(0, 4) === b.slice(0, 4);
  const [early, late] = a < b ? [a, b] : [b, a];
  return addDays(early, 3) >= late;
}

/**
 * Occurrences up to today + monthsAhead that still need a planned row.
 *
 * A template with no rows yet is filled from its start date, past dates
 * included, so one that began before today (a salary from March 5 entered in
 * July) gets its earlier items too. Past items arrive as planned; whether they
 * then settle is up to findAutoCompletable.
 *
 * Once a template has rows, filling only moves forward from the latest one.
 * The ledger is the record of what was decided: a deleted occurrence ("skip
 * this month") stays deleted, a moved one doesn't come back on its old date,
 * and an edit that changes the day or the frequency doesn't fill the past in
 * again under the new schedule. A date in the same period as that latest row
 * is skipped too, so moving rent from the 15th to the 20th after paying on the
 * 15th doesn't charge it twice that month.
 *
 * Both repos run this same algorithm, so materialization is identical in demo
 * and Supabase modes.
 */
export function computeMissingOccurrences(
  templates: RecurringTemplate[],
  transactions: Transaction[],
  monthsAhead: number,
  today: string = todayISO()
): MissingOccurrence[] {
  const horizon = addMonthsClamped(today, monthsAhead);
  const latest = new Map<string, string>();
  for (const t of transactions) {
    if (!t.recurringTemplateId) continue;
    const seen = latest.get(t.recurringTemplateId);
    if (seen == null || t.dueDate > seen) latest.set(t.recurringTemplateId, t.dueDate);
  }
  const missing: MissingOccurrence[] = [];
  for (const template of templates) {
    const last = latest.get(template.id);
    const from = last ? addDays(last, 1) : template.startDate;
    for (const dueDate of occurrencesBetween(template, from, horizon)) {
      if (last && samePeriod(template.frequency, last, dueDate)) continue;
      missing.push({ template, dueDate });
    }
  }
  return missing;
}

/**
 * Planned items that are due and belong to an auto-complete template.
 *
 * Auto-complete settles dates as they arrive. Items dated before the template
 * existed never arrived under it: they were backfilled for a schedule entered
 * late, like a loan already a year in, and posting them all on the next app
 * open would take a year of payments from the account at once. Those wait for
 * a tap instead.
 */
export function findAutoCompletable(
  templates: RecurringTemplate[],
  transactions: Transaction[],
  today: string = todayISO()
): Transaction[] {
  const createdOn = new Map(templates.filter((t) => t.autoComplete).map((t) => [t.id, localDateOf(t.createdAt)] as const));
  return transactions.filter((t) => {
    if (t.status !== "planned" || t.recurringTemplateId == null || t.dueDate > today) return false;
    const since = createdOn.get(t.recurringTemplateId);
    return since != null && t.dueDate >= since;
  });
}

/**
 * The rows an edit to a template replaces: its planned items from today on,
 * and any planned item after its end date, overdue ones included, so a
 * shortened schedule leaves nothing behind to auto-complete. Completed items
 * are history and stay as they were; items already due but not yet confirmed
 * keep what they said when they fell due. SupabaseRepo states the same filter
 * as a query.
 */
export function rowsReplacedByEdit(
  templateId: string,
  endDate: string | null,
  transactions: Transaction[],
  today: string = todayISO()
): Transaction[] {
  return transactions.filter(
    (t) =>
      t.recurringTemplateId === templateId &&
      t.status === "planned" &&
      (t.dueDate >= today || (endDate != null && t.dueDate > endDate))
  );
}

/** What to do with the dates a new template's schedule has already passed. */
export type BackfillMode =
  /** they happened and the balances already show it: record them as history */
  | "paid"
  /** create them as planned items that wait for a tap */
  | "confirm"
  /** leave them out: the schedule starts at its next date */
  | "fromToday";

export interface BackfillRow {
  dueDate: string;
  status: "planned" | "completed";
  /** true = history that never moves balances (see 0007_legacy.sql) */
  legacy: boolean;
}

export interface BackfillPlan {
  /** the start date to save; only "fromToday" moves it */
  startDate: string;
  /** rows to create now, all dated before today */
  rows: BackfillRow[];
}

/** A schedule's dates before today: what a template entered late would backfill. */
export function pastOccurrences(spec: RecurrenceSpec, today: string): string[] {
  if (spec.startDate >= today) return [];
  return occurrencesBetween(spec, spec.startDate, addDays(today, -1));
}

/** A schedule's first date on or after today, or null once it has ended. */
export function firstOccurrenceFrom(spec: RecurrenceSpec, today: string): string | null {
  // 13 months reaches the next date of a yearly schedule wherever today falls
  return occurrencesBetween(spec, today, addMonthsClamped(today, 13))[0] ?? null;
}

/**
 * The rows and start date a new template is saved with.
 *
 * "fromToday" moves the start date to the next scheduled date, because that
 * is what keeps the past out: materialization fills a template without rows
 * from its start date. Monthly and yearly schedules repeat on the start date's
 * day, so when the next date is a clamped one (Feb 28 for a schedule on the
 * 31st) the day moves with it. Better a few days early than a missing month.
 * With no date ahead the schedule has ended and the start stays put; the form
 * doesn't offer the choice then.
 */
export function planBackfill(spec: RecurrenceSpec, mode: BackfillMode, today: string): BackfillPlan {
  if (mode === "fromToday") {
    return { startDate: firstOccurrenceFrom(spec, today) ?? spec.startDate, rows: [] };
  }
  const paid = mode === "paid";
  return {
    startDate: spec.startDate,
    rows: pastOccurrences(spec, today).map((dueDate) => ({
      dueDate,
      status: paid ? ("completed" as const) : ("planned" as const),
      legacy: paid,
    })),
  };
}
