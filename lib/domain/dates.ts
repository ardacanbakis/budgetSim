/**
 * Display formatting for plain yyyy-mm-dd date strings. Input/editing always
 * stays ISO (native date pickers); this only controls how stored dates are
 * shown, per the user's chosen format in Settings.
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
