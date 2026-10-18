import { Account, Frequency, RecurringTemplate, Transaction, TxDirection } from "@/lib/data/types";
import { Currency } from "@/lib/domain/currencies";
import { convert, UsdPerMap } from "@/lib/domain/fx";
import { TemplateProgress, TemplateStatus } from "@/lib/domain/templateStatus";

/**
 * Pocket's Recurring screen, as pure functions over the templates and their
 * templateProgress (lib/domain/templateStatus.ts), so the figures and the
 * order can be checked without a screen.
 *
 * - monthlyCommitments({ templates, progressById, accountsById, usdPer, display })
 *   → { out, in, next, missing }: what the recurring items take and bring in
 *   a month, in the display currency. Each template that isn't finished
 *   ('completed') counts its amount converted at today's rates, times how
 *   often it falls in a month (weekly 52/12, monthly 1, yearly 1/12). `next`
 *   is the soonest progress.next among them. `missing` counts templates left
 *   out because their account is unknown or a rate is missing.
 * - scaleCommitments(c, "yearly"): the same × 12, so Yearly is always
 *   exactly twelve Monthlies.
 * - recurringList(templates, progressById, { status, direction }): the
 *   Classic filters (the same device-kept choices as the Classic tab),
 *   their counts, and the order: templates with items to confirm first, then
 *   by next due date (none last), then by name; finished ones apart.
 * - dueOccurrences(template, transactions, today): its planned rows dated
 *   today or earlier, oldest first: what the row's sheet offers to confirm.
 */

export const PER_MONTH: Record<Frequency, number> = { weekly: 52 / 12, monthly: 1, yearly: 1 / 12 };

export interface Commitments {
  out: number;
  in: number;
  next: { name: string; due: string } | null;
  missing: number;
}

export interface CommitmentParams {
  templates: readonly RecurringTemplate[];
  progressById: ReadonlyMap<string, TemplateProgress>;
  accountsById: ReadonlyMap<string, Account>;
  usdPer: UsdPerMap | null | undefined;
  display: Currency;
}

export function monthlyCommitments({ templates, progressById, accountsById, usdPer, display }: CommitmentParams): Commitments {
  const result: Commitments = { out: 0, in: 0, next: null, missing: 0 };
  for (const tpl of templates) {
    const progress = progressById.get(tpl.id);
    if (progress?.status === "completed") continue;
    if (progress?.next && (!result.next || progress.next < result.next.due)) {
      result.next = { name: tpl.name, due: progress.next };
    }
    const account = accountsById.get(tpl.accountId);
    const converted = !account
      ? null
      : account.currency === display
        ? tpl.amount
        : usdPer
          ? convert(tpl.amount, account.currency, display, usdPer)
          : null;
    if (converted == null) {
      result.missing += 1;
      continue;
    }
    const monthly = converted * PER_MONTH[tpl.frequency];
    if (tpl.direction === "income") result.in += monthly;
    else result.out += monthly;
  }
  return result;
}

export type CommitmentPeriod = "monthly" | "yearly";

export function scaleCommitments(c: Commitments, period: CommitmentPeriod): Commitments {
  return period === "yearly" ? { ...c, out: c.out * 12, in: c.in * 12 } : c;
}

/** The Classic tab's status filter values (lib/prefs RECURRING_STATUS_FILTER_KEY). */
export type StatusFilter = "all" | TemplateStatus;
export const STATUS_FILTERS: readonly StatusFilter[] = ["all", "active", "notStarted", "toConfirm", "completed"];
export type DirectionFilter = "all" | TxDirection;
export const DIRECTION_FILTERS: readonly DirectionFilter[] = ["all", "income", "expense"];

export interface RecurringList {
  /** under the filters, still running: to confirm first, then by next date */
  live: RecurringTemplate[];
  /** under the filters, finished */
  finished: RecurringTemplate[];
  /** per status, among the templates the direction filter keeps (as the Classic chips count) */
  counts: Record<StatusFilter, number>;
}

const statusOf = (progressById: ReadonlyMap<string, TemplateProgress>, tpl: RecurringTemplate): TemplateStatus =>
  progressById.get(tpl.id)?.status ?? "active";

export function recurringList(
  templates: readonly RecurringTemplate[],
  progressById: ReadonlyMap<string, TemplateProgress>,
  filters: { status: StatusFilter; direction: DirectionFilter }
): RecurringList {
  const byDirection = templates.filter((tpl) => filters.direction === "all" || tpl.direction === filters.direction);
  const counts: Record<StatusFilter, number> = { all: byDirection.length, active: 0, notStarted: 0, toConfirm: 0, completed: 0 };
  for (const tpl of byDirection) counts[statusOf(progressById, tpl)] += 1;

  const shown = byDirection.filter((tpl) => filters.status === "all" || statusOf(progressById, tpl) === filters.status);
  const open = (tpl: RecurringTemplate) => progressById.get(tpl.id)?.open ?? 0;
  const next = (tpl: RecurringTemplate) => progressById.get(tpl.id)?.next ?? null;
  const order = (a: RecurringTemplate, b: RecurringTemplate) => {
    const oa = open(a) > 0;
    const ob = open(b) > 0;
    if (oa !== ob) return oa ? -1 : 1;
    const na = next(a);
    const nb = next(b);
    if (na !== nb) {
      if (na == null) return 1;
      if (nb == null) return -1;
      return na < nb ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  };
  const live = shown.filter((tpl) => statusOf(progressById, tpl) !== "completed").sort(order);
  const finished = shown.filter((tpl) => statusOf(progressById, tpl) === "completed").sort(order);
  return { live, finished, counts };
}

export function dueOccurrences(template: RecurringTemplate, transactions: readonly Transaction[], today: string): Transaction[] {
  return transactions
    .filter((tx) => tx.recurringTemplateId === template.id && tx.status === "planned" && tx.dueDate <= today)
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : a.id < b.id ? -1 : 1));
}
