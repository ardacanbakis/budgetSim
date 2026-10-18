/**
 * Dates as Pocket says them: "Today", "Tomorrow", "in 3 days", "2 days late",
 * and day headers like "Fri 16 Oct". Pure, over yyyy-mm-dd strings, and
 * counted in calendar days (UTC arithmetic), so a time zone or a DST change
 * never makes a day 23 hours long.
 */

export type RelativeKey = "today" | "tomorrow" | "yesterday" | "inDays" | "late";

function utc(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Whole calendar days from `from` to `to`: positive when `to` is later. */
export function daysBetween(from: string, to: string): number {
  return Math.round((utc(to) - utc(from)) / 86_400_000);
}

/**
 * How far a due date is from today, as a dictionary key and a count:
 * today, tomorrow, yesterday, "in {count} days" (2 or more ahead) or
 * "{count} days late" (2 or more behind). Read the count with the key's
 * One/Many pair.
 */
export function relativeDue(due: string, today: string): { key: RelativeKey; count: number } {
  const diff = daysBetween(today, due);
  if (diff === 0) return { key: "today", count: 0 };
  if (diff === 1) return { key: "tomorrow", count: 1 };
  if (diff === -1) return { key: "yesterday", count: 1 };
  return diff > 1 ? { key: "inDays", count: diff } : { key: "late", count: -diff };
}

export interface DayWords {
  today: string;
  yesterday: string;
  tomorrow: string;
}

/**
 * A day as a header or a chip says it: the word for today, yesterday or
 * tomorrow, else a short weekday and date ("Fri 16 Oct", "16 Eki Cum"), with
 * the year only when it isn't this year's.
 */
export function dayLabel(iso: string, today: string, locale: string, words: DayWords): string {
  const diff = daysBetween(today, iso);
  if (diff === 0) return words.today;
  if (diff === -1) return words.yesterday;
  if (diff === 1) return words.tomorrow;
  const sameYear = iso.slice(0, 4) === today.slice(0, 4);
  return new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: sameYear ? undefined : "numeric",
    timeZone: "UTC",
  }).format(new Date(utc(iso)));
}
