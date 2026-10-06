import { Frequency, RecurringTemplate, Transaction } from "@/lib/data/types";
import { addDays, addMonthsClamped, localDateOf, occurrencesBetween, todayISO } from "./recurrence";

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
