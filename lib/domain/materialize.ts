import { RecurringTemplate, Transaction } from "@/lib/data/types";
import { addMonthsClamped, occurrencesBetween, todayISO } from "./recurrence";

export interface MissingOccurrence {
  template: RecurringTemplate;
  dueDate: string;
}

/**
 * Occurrences in [template.startDate, today + monthsAhead] that have no
 * transaction yet (neither planned nor already completed) for their
 * template+date. Occurrences from the template's start date up to the horizon
 * are all materialized — including ones already in the past — so a template
 * that began before today (e.g. a salary starting March 5 viewed in July)
 * still gets its earlier items instead of only future ones. Past items are
 * created as planned/overdue; auto-complete templates then settle them via
 * findAutoCompletable. Both repos run this same algorithm, so materialization
 * is identical in demo and Supabase modes.
 */
export function computeMissingOccurrences(
  templates: RecurringTemplate[],
  transactions: Transaction[],
  monthsAhead: number,
  today: string = todayISO()
): MissingOccurrence[] {
  const horizon = addMonthsClamped(today, monthsAhead);
  const existing = new Set<string>();
  for (const t of transactions) {
    if (t.recurringTemplateId) existing.add(`${t.recurringTemplateId}|${t.dueDate}`);
  }
  const missing: MissingOccurrence[] = [];
  for (const template of templates) {
    for (const dueDate of occurrencesBetween(template, template.startDate, horizon)) {
      if (!existing.has(`${template.id}|${dueDate}`)) missing.push({ template, dueDate });
    }
  }
  return missing;
}

/** Planned transactions that are due and belong to an auto-complete template. */
export function findAutoCompletable(
  templates: RecurringTemplate[],
  transactions: Transaction[],
  today: string = todayISO()
): Transaction[] {
  const autoIds = new Set(templates.filter((t) => t.autoComplete).map((t) => t.id));
  return transactions.filter(
    (t) =>
      t.status === "planned" &&
      t.recurringTemplateId != null &&
      autoIds.has(t.recurringTemplateId) &&
      t.dueDate <= today
  );
}
