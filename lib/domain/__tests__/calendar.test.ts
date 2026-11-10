import { describe, expect, it } from "vitest";
import { Account } from "@/lib/data/types";
import { buildIcs, escapeText, foldLine, paymentEntries } from "../calendar";
import { TimelineEvent } from "../timeline";

const account = (id: string, o: Partial<Account> = {}): Account => ({
  id,
  name: id,
  currency: "TRY",
  kind: "fiat",
  openingBalance: 0,
  archived: false,
  paymentAccountId: null,
  paymentDay: null,
  creditLimit: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  ...o,
});

const bank = account("bank", { name: "EnPara TRY" });
const akbank = account("akbank", { name: "CC Akbank", kind: "credit_card", paymentAccountId: "bank", paymentDay: 16 });
const accounts = [bank, akbank];
const today = "2026-11-06";

const event = (o: Partial<TimelineEvent> & Pick<TimelineEvent, "key" | "date">): TimelineEvent => ({
  kind: "tx",
  status: "planned",
  effectiveDate: o.date,
  legs: [],
  accountId: "bank",
  amount: 0,
  currency: "TRY",
  direction: "expense",
  ...o,
});

describe("escapeText", () => {
  it("escapes what RFC 5545 reserves, in the right order", () => {
    expect(escapeText("a,b;c\\d")).toBe("a\\,b\;c\\\\d");
    expect(escapeText("one\ntwo")).toBe("one\\ntwo");
    // the backslash goes first, or the escapes escape each other
    expect(escapeText("\\,")).toBe("\\\\\\,");
  });
});

describe("foldLine", () => {
  it("leaves a short line alone", () => {
    expect(foldLine("SUMMARY:short")).toBe("SUMMARY:short");
  });

  it("folds past 75 octets, continuations starting with a space", () => {
    const folded = foldLine("SUMMARY:" + "x".repeat(200));
    const parts = folded.split("\r\n");
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.slice(1).every((p) => p.startsWith(" "))).toBe(true);
    expect(parts.map((p, i) => (i === 0 ? p : p.slice(1))).join("")).toBe("SUMMARY:" + "x".repeat(200));
  });

  it("counts octets, never splitting a multi-byte character", () => {
    const line = "SUMMARY:" + "İş".repeat(60);
    const folded = foldLine(line);
    for (const part of folded.split("\r\n")) {
      expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
    }
    expect(folded.split("\r\n").map((p, i) => (i === 0 ? p : p.slice(1))).join("")).toBe(line);
  });
});

describe("paymentEntries", () => {
  const events = [
    event({
      key: "stmt:akbank:2026-11",
      date: "2026-11-16",
      kind: "statement",
      cardId: "akbank",
      legs: [{ accountId: "bank", delta: -41511 }],
    }),
    event({
      key: "loan1",
      date: "2026-11-26",
      legs: [{ accountId: "bank", delta: -9046.8 }],
      tx: { loanId: "l1", description: "Tansu Akbank 100k Kredi" } as never,
    }),
    event({ key: "rent", date: "2026-11-10", legs: [{ accountId: "bank", delta: -27500 }], tx: { description: "Rent" } as never }),
    // money coming in needs no reminder
    event({ key: "pay", date: "2026-11-05", legs: [{ accountId: "bank", delta: 63000 }], tx: { description: "Maaş" } as never }),
  ];
  const all = new Set(["cards", "debts", "other"] as const);

  it("names a statement after its card and dates it on the payment day", () => {
    const entries = paymentEntries({ events, accounts, today, to: "2026-12-31", include: all, locale: "en" });
    const stmt = entries.find((e) => e.date === "2026-11-16")!;
    expect(stmt.summary).toContain("CC Akbank");
    expect(stmt.uid).toContain("stmt:akbank:2026-11");
  });

  it("reminds you about money going out, never about money coming in", () => {
    const entries = paymentEntries({ events, accounts, today, to: "2026-12-31", include: all, locale: "en" });
    expect(entries.map((e) => e.date)).toEqual(["2026-11-10", "2026-11-16", "2026-11-26"]);
  });

  it("takes only the kinds asked for", () => {
    const cards = paymentEntries({ events, accounts, today, to: "2026-12-31", include: new Set(["cards"] as const), locale: "en" });
    expect(cards).toHaveLength(1);
    const debts = paymentEntries({ events, accounts, today, to: "2026-12-31", include: new Set(["debts"] as const), locale: "en" });
    expect(debts[0].summary).toContain("Tansu Akbank 100k Kredi");
  });

  it("gives every payment a uid that survives the next export", () => {
    const once = paymentEntries({ events, accounts, today, to: "2026-12-31", include: all, locale: "en" });
    const again = paymentEntries({ events, accounts, today, to: "2026-12-31", include: all, locale: "en" });
    expect(once.map((e) => e.uid)).toEqual(again.map((e) => e.uid));
    expect(new Set(once.map((e) => e.uid)).size).toBe(once.length);
  });

  it("leaves out what falls outside the window", () => {
    expect(paymentEntries({ events, accounts, today, to: "2026-11-12", include: all, locale: "en" })).toHaveLength(1);
  });
});

describe("buildIcs", () => {
  const entries = [{ uid: "u1@budgetsim", date: "2026-11-16", summary: "CC Akbank — ₺41,511.00", description: "pays from EnPara" }];

  it("writes a calendar a phone will accept: CRLF, and the blocks in order", () => {
    const ics = buildIcs({ entries, name: "Payments", alarm: "onDay", now: today });
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("VERSION:2.0");
    expect(ics.split("\n").every((l) => l === "" || l.endsWith("\r"))).toBe(true);
  });

  it("dates an all-day event with an exclusive end, so it covers one day", () => {
    const ics = buildIcs({ entries, name: "Payments", alarm: "none", now: today });
    expect(ics).toContain("DTSTART;VALUE=DATE:20261116");
    expect(ics).toContain("DTEND;VALUE=DATE:20261117");
    expect(ics).not.toContain("BEGIN:VALARM");
  });

  it("puts the alarm where it was asked for, relative to midnight", () => {
    expect(buildIcs({ entries, name: "P", alarm: "onDay", now: today })).toContain("TRIGGER:PT9H");
    expect(buildIcs({ entries, name: "P", alarm: "dayBefore", now: today })).toContain("TRIGGER:-PT15H");
    const both = buildIcs({ entries, name: "P", alarm: "both", now: today });
    expect(both).toContain("TRIGGER:-PT15H");
    expect(both).toContain("TRIGGER:PT9H");
    expect(both.match(/BEGIN:VALARM/g)).toHaveLength(2);
  });

  it("escapes a summary that would otherwise break the file", () => {
    const tricky = [{ uid: "u2", date: "2026-11-16", summary: "Card; one, two", description: "a\nb" }];
    const ics = buildIcs({ entries: tricky, name: "P", alarm: "none", now: today });
    expect(ics).toContain("SUMMARY:Card\; one\\, two");
    expect(ics).toContain("DESCRIPTION:a\\nb");
  });

  it("writes a valid empty calendar rather than nothing at all", () => {
    const ics = buildIcs({ entries: [], name: "P", alarm: "both", now: today });
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).not.toContain("BEGIN:VEVENT");
  });
});
