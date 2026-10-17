/**
 * Display formatting for plain yyyy-mm-dd date strings, per the user's chosen
 * format in Settings, and reading a date back from what a person types into a
 * date field (parseTypedDate). Stored dates are always ISO.
 */

export const DATE_FORMATS = ["iso", "dmy", "mdy", "dmy-dot", "long"] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

export const DEFAULT_DATE_FORMAT: DateFormat = "iso";

/** A concrete sample date used to preview each format in Settings. */
export const DATE_FORMAT_SAMPLE = "2026-03-09";

export function isDateFormat(value: string): value is DateFormat {
  return (DATE_FORMATS as readonly string[]).includes(value);
}

/**
 * Render an ISO date in the chosen format. Non-ISO input (empty, partial, or
 * already-formatted) is returned unchanged so callers can pass through freely.
 */
export function formatDate(iso: string | null | undefined, format: DateFormat = DEFAULT_DATE_FORMAT, locale = "en"): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso ?? "";
  const [y, m, d] = iso.split("-");
  switch (format) {
    case "dmy":
      return `${d}/${m}/${y}`;
    case "mdy":
      return `${m}/${d}/${y}`;
    case "dmy-dot":
      return `${d}.${m}.${y}`;
    case "long":
      return new Date(`${iso}T00:00:00`).toLocaleDateString(locale === "tr" ? "tr-TR" : "en-US", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
    case "iso":
    default:
      return iso;
  }
}

/*
 * Typing a date.
 *
 * Date fields take text, so a date can be typed the way people say it:
 * "17", "17 oct", "17 eki", "oct 17", "17 Ekim 2026", "17.10", "17/10/26",
 * "2026-10-17", "today" / "bugün", "yesterday" / "dün", "tomorrow" / "yarın".
 * Months match English or Turkish names by any unambiguous start ("eki",
 * "oct", "sept", "şub", "sub"), with or without Turkish letters. What isn't
 * typed comes from `base` (the field's current date, or today): "17" is the
 * 17th of that month, "17 oct" is in that year.
 *
 * All-number dates read day first, as in Turkey ("5.6" is 5 June), unless
 * the first number can't be a month and the second can ("10/17" is 17
 * October). A four-digit first number reads year-month-day.
 */

const MONTH_NAMES: ReadonlyArray<readonly string[]> = [
  ["january", "ocak"],
  ["february", "subat"],
  ["march", "mart"],
  ["april", "nisan"],
  ["may", "mayis"],
  ["june", "haziran"],
  ["july", "temmuz"],
  ["august", "agustos"],
  ["september", "eylul"],
  ["october", "ekim"],
  ["november", "kasim"],
  ["december", "aralik"],
];

const WEEKDAYS = [
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "pazartesi", "sali", "carsamba", "persembe", "cuma", "cumartesi", "pazar",
];

const RELATIVE: Record<string, number> = {
  today: 0, bugun: 0, now: 0,
  yesterday: -1, dun: -1,
  tomorrow: 1, yarin: 1,
};

/** Lower case with Turkish letters folded to plain ones: "Şubat" → "subat", "AYLIK" → "aylik". */
function fold(text: string): string {
  return text
    .replace(/İ/g, "i")
    .replace(/I/g, "ı")
    .toLowerCase()
    .replace(/ı/g, "i")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** The month a word starts, when only one month starts that way; null otherwise. */
function monthOf(word: string): number | null {
  if (word.length < 2) return null;
  const hits = new Set<number>();
  MONTH_NAMES.forEach((names, i) => {
    if (names.some((n) => n.startsWith(word) || (word.length > n.length && word.startsWith(n)))) hits.add(i + 1);
  });
  // "sept" and "sep" are both September; "ma" could be March or May
  return hits.size === 1 ? [...hits][0] : null;
}

function isWeekday(word: string): boolean {
  return word.length >= 2 && WEEKDAYS.some((d) => d.startsWith(word));
}

function daysIn(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function iso(y: number, m: number, d: number): string | null {
  if (!Number.isInteger(y) || y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > daysIn(y, m)) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const fullYear = (n: number, digits: number) => (digits <= 2 ? 2000 + n : n);

/**
 * A yyyy-mm-dd date from typed text, or null when it can't be read. `base`
 * (yyyy-mm-dd) fills in what wasn't typed and anchors today/yesterday.
 */
export function parseTypedDate(text: string, base: string): string | null {
  const s = fold(text.trim());
  if (!s) return null;
  const [by, bm, bd] = base.split("-").map(Number);
  if (s in RELATIVE) {
    const dt = new Date(Date.UTC(by, bm - 1, bd + RELATIVE[s]));
    return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  }
  const isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (isoMatch) return iso(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));

  // "17oct" and "oct17" split into their parts; separators are anything else
  const tokens = s.match(/\d+|[a-z]+/g) ?? [];
  if (s.replace(/[\d a-z.,/\-]/g, "") !== "") return null;
  const numbers: Array<{ n: number; digits: number }> = [];
  let month: number | null = null;
  for (const token of tokens) {
    if (/^\d+$/.test(token)) {
      numbers.push({ n: Number(token), digits: token.length });
    } else {
      const m = monthOf(token);
      if (m != null && month == null) month = m;
      else if (!isWeekday(token)) return null;
    }
  }

  if (month != null) {
    // "17 oct", "oct 17", "17 oct 2026", "17 oct 26"
    const yearAt = numbers.findIndex((x) => x.digits === 4);
    const year = yearAt >= 0 ? numbers[yearAt].n : null;
    const rest = numbers.filter((_, i) => i !== yearAt);
    if (rest.length === 0 || rest.length > 2) return null;
    const day = rest[0].n;
    const y = year ?? (rest[1] ? fullYear(rest[1].n, rest[1].digits) : by);
    return iso(y, month, day);
  }

  if (numbers.length === 0 || numbers.length > 3) return null;
  if (numbers.length === 1) {
    return numbers[0].digits <= 2 ? iso(by, bm, numbers[0].n) : null;
  }
  const [a, b, c] = numbers;
  if (a.digits === 4) {
    return c ? iso(a.n, b.n, c.n) : null;
  }
  // day first, unless only month-first makes sense ("10/17")
  const monthFirst = a.n <= 12 && b.n > 12;
  const day = monthFirst ? b.n : a.n;
  const m = monthFirst ? a.n : b.n;
  const y = c ? fullYear(c.n, c.digits) : by;
  return iso(y, m, day);
}

/** How a date field shows its date: "17 Oct 2026" / "17 Eki 2026", easy to read and to type over. */
export function formatForField(iso: string, locale: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  return new Date(`${iso}T00:00:00`).toLocaleDateString(locale === "tr" ? "tr-TR" : "en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
