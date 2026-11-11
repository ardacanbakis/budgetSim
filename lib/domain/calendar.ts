import { Account } from "@/lib/data/types";
import { Currency, formatAmount } from "./currencies";
import { TimelineEvent } from "./timeline";

/**
 * The payment days as a calendar file (RFC 5545), so a phone can do the
 * reminding.
 *
 * A browser cannot wake itself on the 16th. Web push needs a server and a
 * subscription, and the scheduling APIs that would do it without one are
 * either behind a flag or absent on iOS — so an app that only notifies you
 * while you have it open is no reminder at all.
 *
 * A calendar is the part of a phone whose whole job is this. One file, no
 * server, no permission dance, and it works the same on both platforms:
 * each payment becomes an all-day event with an alarm, and the phone
 * carries it from there.
 *
 * All-day events are deliberate. They float — no timezone, no VTIMEZONE
 * block, no hour that shifts when the clocks change — and an alarm relative
 * to midnight puts the reminder where it's wanted: PT9H is nine in the
 * morning on the day, -PT15H is nine the morning before.
 */

export type CalendarAlarm = "onDay" | "dayBefore" | "both" | "none";

const TRIGGERS: Record<Exclude<CalendarAlarm, "none">, string[]> = {
  // from midnight on the day the payment falls
  onDay: ["PT9H"],
  dayBefore: ["-PT15H"],
  both: ["-PT15H", "PT9H"],
};

export interface CalendarEntry {
  /** stable across exports, so re-importing updates rather than duplicates */
  uid: string;
  /** yyyy-mm-dd */
  date: string;
  summary: string;
  description: string;
}

/** RFC 5545 TEXT escaping: backslash, semicolon, comma and newlines. */
export function escapeText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/**
 * Fold a line to 75 octets, continuations starting with one space. Counted
 * in UTF-8 bytes, not characters: "İş Bankası" is longer than it looks, and
 * a fold that splits a multi-byte character corrupts the file.
 */
export function foldLine(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let current = "";
  let width = 0;
  const limit = () => (out.length === 0 ? 75 : 74); // a continuation spends one octet on its space
  for (const char of line) {
    const size = new TextEncoder().encode(char).length;
    if (width + size > limit()) {
      out.push(current);
      current = "";
      width = 0;
    }
    current += char;
    width += size;
  }
  out.push(current);
  return out.join("\r\n ");
}

const stamp = (iso: string) => iso.replace(/-/g, "");

/** The day after `date`: an all-day event's DTEND is exclusive. */
function nextDay(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

/**
 * An iCalendar document for `entries`. CRLF throughout, as the format
 * requires: a file with bare newlines is rejected by some calendars and
 * silently half-read by others.
 */
export function buildIcs(params: { entries: readonly CalendarEntry[]; name: string; alarm: CalendarAlarm; now: string }): string {
  const { entries, name, alarm, now } = params;
  const dtstamp = `${stamp(now)}T000000Z`;
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//BudgetSim//Payments//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(name)}`,
  ];
  for (const entry of entries) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${entry.uid}`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;VALUE=DATE:${stamp(entry.date)}`,
      `DTEND;VALUE=DATE:${stamp(nextDay(entry.date))}`,
      `SUMMARY:${escapeText(entry.summary)}`,
      `DESCRIPTION:${escapeText(entry.description)}`,
      "TRANSP:TRANSPARENT"
    );
    if (alarm !== "none") {
      for (const trigger of TRIGGERS[alarm]) {
        lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `TRIGGER:${trigger}`, `DESCRIPTION:${escapeText(entry.summary)}`, "END:VALARM");
      }
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

export type CalendarInclude = "cards" | "debts" | "other";

/**
 * The payments between today and `to`, as calendar entries: a card's
 * statement on its payment day, a loan instalment on its own, and anything
 * else planned, each named and priced in the currency it leaves.
 *
 * The same timeline every other screen reads, so the calendar can't drift
 * from the app; and only money going out, because a reminder to receive
 * your salary helps nobody.
 */
export function paymentEntries(params: {
  events: readonly TimelineEvent[];
  accounts: readonly Account[];
  today: string;
  to: string;
  include: ReadonlySet<CalendarInclude>;
  locale: string;
}): CalendarEntry[] {
  const { events, accounts, today, to, include, locale } = params;
  const byId = new Map(accounts.map((a) => [a.id, a] as const));
  const entries: CalendarEntry[] = [];

  for (const e of events) {
    if (e.status !== "planned" && e.status !== "overdue") continue;
    const date = e.effectiveDate;
    if (date < today || date > to) continue;
    for (const leg of e.legs) {
      const account = byId.get(leg.accountId);
      if (!account || leg.delta >= -0.005) continue;
      const kind: CalendarInclude = e.kind === "statement" ? "cards" : e.tx?.loanId != null ? "debts" : "other";
      if (!include.has(kind)) continue;
      const card = e.kind === "statement" && e.cardId ? byId.get(e.cardId) : undefined;
      const what = card?.name ?? e.tx?.description ?? account.name;
      const amount = formatAmount(-leg.delta, account.currency as Currency, locale);
      entries.push({
        // the event's own key plus the account: stable between exports, so a
        // calendar that already has it updates rather than doubling up
        uid: `${e.key}:${leg.accountId}@budgetsim`.replace(/\s+/g, "-"),
        date,
        summary: `${what} — ${amount}`,
        description: `${what}\n${amount}\n${account.name}`,
      });
    }
  }
  entries.sort((a, b) => a.date.localeCompare(b.date) || a.summary.localeCompare(b.summary));
  return entries;
}
