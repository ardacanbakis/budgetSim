import { RecurringTemplate } from "@/lib/data/types";
import { addDays } from "./recurrence";

/**
 * One income over time: a salary that got raises is several recurring
 * templates, one per period, each ending the day before the next begins,
 * sharing a `series` (the first period's id). Every period stays an ordinary
 * template, so the projection, the planner, the timeline and auto-complete
 * read it as they always have.
 *
 * - seriesKey(template): the series it belongs to (its own id when alone).
 * - incomeSeries(templates, today): income templates as series, each with
 *   the period that's current (running today, else the next to start, else
 *   the last), the ones before it and any after it.
 * - raise(template, amount, from): ending this period the day before
 *   `from` and the next one from `from`, in the same series.
 * - combineSuggestions(templates): income items that look like one income
 *   entered year by year ("WBL 2024", "WBL 2025", "WBL 2026": the same name
 *   once its numbers are gone, the same account, one after the other), not
 *   yet one series.
 */

export function seriesKey(template: Pick<RecurringTemplate, "id" | "series">): string {
  return template.series ?? template.id;
}

export interface IncomeSeries {
  key: string;
  /** the period running today, else the next to start, else the last */
  current: RecurringTemplate;
  /** every period, earliest first */
  periods: RecurringTemplate[];
  /** the periods before the current one, latest first */
  earlier: RecurringTemplate[];
  /** the periods after it (a raise that hasn't started yet), earliest first */
  later: RecurringTemplate[];
  /** the last period: where the next raise starts from */
  latest: RecurringTemplate;
}

const byStart = (a: RecurringTemplate, b: RecurringTemplate) => a.startDate.localeCompare(b.startDate) || a.createdAt.localeCompare(b.createdAt);

export function incomeSeries(templates: readonly RecurringTemplate[], today: string): IncomeSeries[] {
  const groups = new Map<string, RecurringTemplate[]>();
  for (const t of templates) {
    if (t.direction !== "income") continue;
    const key = seriesKey(t);
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  return [...groups.entries()].map(([key, list]) => {
    const periods = [...list].sort(byStart);
    const running = periods.filter((p) => p.startDate <= today && (p.endDate == null || p.endDate >= today)).at(-1);
    const next = periods.find((p) => p.startDate > today);
    const current = running ?? next ?? periods[periods.length - 1];
    const earlier = periods.filter((p) => p !== current && p.startDate < current.startDate).reverse();
    const later = periods.filter((p) => p !== current && p.startDate > current.startDate);
    return { key, current, periods, earlier, later, latest: periods[periods.length - 1] };
  });
}

export interface RaisePlan {
  /** the period that ends: its new end date */
  end: { id: string; endDate: string; series: string };
  /** the period that starts on `from`, everything else as before */
  next: Omit<RecurringTemplate, "id" | "createdAt">;
}

/** A raise from `from` on: null when `from` isn't after the period's start, or the amount isn't new and positive. */
export function raise(template: RecurringTemplate, amount: number, from: string): RaisePlan | null {
  if (!(amount > 0) || amount === template.amount || from <= template.startDate) return null;
  if (template.endDate != null && from > addDays(template.endDate, 1)) return null;
  const series = seriesKey(template);
  return {
    end: { id: template.id, endDate: addDays(from, -1), series },
    next: {
      name: template.name,
      accountId: template.accountId,
      direction: template.direction,
      categoryId: template.categoryId,
      amount,
      frequency: template.frequency,
      startDate: from,
      endDate: template.endDate,
      autoComplete: template.autoComplete,
      loanId: template.loanId,
      series,
    },
  };
}

/** A name without its numbers and punctuation: "WBL 2024" and "WBL – 2025" both read "wbl". */
export function nameStem(name: string): string {
  return name
    .toLocaleLowerCase("tr")
    .replace(/[\p{N}]+/gu, " ")
    .replace(/[^\p{L}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export interface CombineSuggestion {
  /** the series they'd share: the earliest one's */
  key: string;
  stem: string;
  /** earliest first */
  templates: RecurringTemplate[];
}

export function combineSuggestions(templates: readonly RecurringTemplate[]): CombineSuggestion[] {
  const groups = new Map<string, RecurringTemplate[]>();
  for (const t of templates) {
    if (t.direction !== "income" || t.frequency !== "monthly") continue;
    const stem = nameStem(t.name);
    if (!stem) continue;
    const key = `${t.accountId}|${stem}`;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  const out: CombineSuggestion[] = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const sorted = [...list].sort(byStart);
    // already one series: nothing to suggest
    if (new Set(sorted.map(seriesKey)).size === 1) continue;
    // one after the other: each ends before the next starts
    const inTurn = sorted.every((t, i) => i === sorted.length - 1 || (t.endDate != null && t.endDate < sorted[i + 1].startDate));
    if (!inTurn) continue;
    out.push({ key: seriesKey(sorted[0]), stem: nameStem(sorted[0].name), templates: sorted });
  }
  return out;
}
