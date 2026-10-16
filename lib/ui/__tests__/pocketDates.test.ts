import { describe, expect, it } from "vitest";
import { dayLabel, daysBetween, relativeDue } from "../pocket/dates";

const words = { today: "Today", yesterday: "Yesterday", tomorrow: "Tomorrow" };

describe("daysBetween", () => {
  it("counts calendar days, across months, years and DST changes", () => {
    expect(daysBetween("2026-10-16", "2026-10-16")).toBe(0);
    expect(daysBetween("2026-10-30", "2026-11-02")).toBe(3);
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
    expect(daysBetween("2026-03-28", "2026-03-30")).toBe(2);
    expect(daysBetween("2026-10-16", "2026-10-10")).toBe(-6);
  });
});

describe("relativeDue", () => {
  const today = "2026-10-16";
  it("names today, tomorrow and yesterday", () => {
    expect(relativeDue("2026-10-16", today)).toEqual({ key: "today", count: 0 });
    expect(relativeDue("2026-10-17", today)).toEqual({ key: "tomorrow", count: 1 });
    expect(relativeDue("2026-10-15", today)).toEqual({ key: "yesterday", count: 1 });
  });

  it("counts days ahead and days late", () => {
    expect(relativeDue("2026-10-20", today)).toEqual({ key: "inDays", count: 4 });
    expect(relativeDue("2026-10-06", today)).toEqual({ key: "late", count: 10 });
  });
});

describe("dayLabel", () => {
  const today = "2026-10-16";
  it("uses the words for the three nearest days", () => {
    expect(dayLabel("2026-10-16", today, "en", words)).toBe("Today");
    expect(dayLabel("2026-10-15", today, "en", words)).toBe("Yesterday");
    expect(dayLabel("2026-10-17", today, "en", words)).toBe("Tomorrow");
  });

  it("writes other days short, in the locale, with the year only when it differs", () => {
    expect(dayLabel("2026-10-12", today, "en", words)).toBe("Mon 12 Oct");
    expect(dayLabel("2026-10-12", today, "tr", words)).toBe("12 Eki Pzt");
    expect(dayLabel("2025-12-30", today, "en", words)).toBe("Tue, 30 Dec 2025");
  });
});
