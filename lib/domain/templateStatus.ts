import { RecurringTemplate, Transaction } from "@/lib/data/types";
import { addDays, occurrencesBetween, todayISO } from "./recurrence";

/**
 * Where a recurring template is in its life.
 *
 *   notStarted — its first date is still ahead
 *   active     — more items are still to come
 *   toConfirm  — the schedule has run out, but some due items were never
 *                completed (a template without auto-complete waits for a tap)
 *   completed  — the schedule has run out and every item is settled
 *
 * "Run out" is read from both the schedule and the ledger: a planned item
 * dated after today keeps a template active even if its end date was later
 * moved earlier, because that item is still going to show up on the sheet.
 */
export type TemplateStatus = "notStarted" | "active" | "toConfirm" | "completed";

export const TEMPLATE_STATUSES: TemplateStatus[] = ["active", "notStarted", "toConfirm", "completed"];

export interface TemplateProgress {
  status: TemplateStatus;
  /** completed items linked to this template */
  done: number;
  /** scheduled occurrences from start to end; null when it never ends */
  total: number | null;
  /** planned items due today or earlier — waiting to be confirmed */
  open: number;
  /** the next date something is due (today or later), if any */
  next: string | null;
  /** the schedule's final date, when it has one */
  last: string | null;
}

export function templateProgress(
  template: RecurringTemplate,
  transactions: Transaction[],
  today: string = todayISO()
): TemplateProgress {
  let done = 0;
  let open = 0;
  let nextPlanned: string | null = null;
  for (const t of transactions) {
    if (t.recurringTemplateId !== template.id) continue;
    if (t.status === "completed") {
      done++;
    } else if (t.dueDate <= today) {
      open++;
    } else if (nextPlanned == null || t.dueDate < nextPlanned) {
      nextPlanned = t.dueDate;
    }
  }

  const schedule = template.endDate
    ? occurrencesBetween(template, template.startDate, template.endDate)
    : null;
  const total = schedule ? schedule.length : null;
  const last = schedule && schedule.length ? schedule[schedule.length - 1] : null;

  // The next scheduled date after today. The ledger alone can't answer this:
  // materialization may not have run yet. 400 days covers a yearly gap, and
  // occurrencesBetween already stops at the end date.
  const nextScheduled = occurrencesBetween(template, addDays(today, 1), addDays(today, 400))[0] ?? null;
  const hasFuture = nextScheduled != null || nextPlanned != null;

  // An item due today is "next" until it's confirmed — then the one after it.
  const dueToday = transactions.some(
    (t) => t.recurringTemplateId === template.id && t.status === "planned" && t.dueDate === today
  );
  const candidates = [nextPlanned, nextScheduled].filter((d): d is string => d != null);
  const next = dueToday ? today : candidates.length ? candidates.sort()[0] : null;

  let status: TemplateStatus;
  if (template.startDate > today) status = "notStarted";
  else if (hasFuture) status = "active";
  else if (open > 0) status = "toConfirm";
  else status = "completed";

  return { status, done, total, open, next, last };
}
