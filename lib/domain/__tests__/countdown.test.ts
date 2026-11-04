import { describe, expect, it } from "vitest";
import { calendarSpan, localMoment, momentParts, sortTimers, spanBetween, timerState } from "../countdown";

const at = (s: string) => new Date(s).getTime();

describe("spanBetween", () => {
  it("splits the gap into days, hours, minutes and seconds, either way round", () => {
    const a = at("2026-11-04T10:00:00");
    const b = at("2026-11-06T13:25:42");
    expect(spanBetween(a, b)).toEqual({ days: 2, hours: 3, minutes: 25, seconds: 42 });
    expect(spanBetween(b, a)).toEqual({ days: 2, hours: 3, minutes: 25, seconds: 42 });
  });

  it("drops the part of a second", () => {
    expect(spanBetween(0, 1999)).toEqual({ days: 0, hours: 0, minutes: 0, seconds: 1 });
  });
});

describe("timerState", () => {
  const now = at("2026-11-04T12:00:00");

  it("counts down to a moment ahead, and says when it's been reached", () => {
    expect(timerState("until", new Date("2026-11-05T12:00:00").toISOString(), now)).toMatchObject({
      phase: "counting",
      span: { days: 1, hours: 0, minutes: 0, seconds: 0 },
    });
    expect(timerState("until", new Date("2026-11-04T11:00:00").toISOString(), now)).toMatchObject({
      phase: "reached",
      span: { days: 0, hours: 1 },
    });
  });

  it("counts the time since a moment, and waits for one still ahead", () => {
    expect(timerState("since", new Date("2026-10-04T12:00:00").toISOString(), now)).toMatchObject({ phase: "elapsed" });
    expect(timerState("since", new Date("2026-11-04T12:30:00").toISOString(), now)).toMatchObject({
      phase: "pending",
      span: { minutes: 30 },
    });
  });

  it("reads a long span in calendar terms too, and a short one only in days", () => {
    const long = timerState("since", new Date("2025-08-01T12:00:00").toISOString(), now);
    expect(long.calendar).toEqual({ years: 1, months: 3, days: 3 });
    expect(timerState("since", new Date("2026-10-20T12:00:00").toISOString(), now).calendar).toBeNull();
  });
});

describe("calendarSpan", () => {
  it("counts whole months by the calendar", () => {
    expect(calendarSpan(at("2026-03-15T00:00:00"), at("2026-05-14T00:00:00"))).toEqual({ years: 0, months: 1, days: 29 });
    expect(calendarSpan(at("2026-03-15T00:00:00"), at("2026-05-15T00:00:00"))).toEqual({ years: 0, months: 2, days: 0 });
  });

  it("reaches a month too short for the start's day on its last day", () => {
    expect(calendarSpan(at("2026-01-31T00:00:00"), at("2026-02-28T00:00:00"))).toEqual({ years: 0, months: 1, days: 0 });
  });

  it("doesn't count a day whose time hasn't come yet", () => {
    expect(calendarSpan(at("2026-01-01T18:00:00"), at("2026-03-05T09:00:00"))).toEqual({ years: 0, months: 2, days: 3 });
  });
});

describe("localMoment and momentParts", () => {
  it("round-trip a local date and time", () => {
    const iso = localMoment("2026-12-31", "23:59")!;
    expect(momentParts(iso)).toEqual({ date: "2026-12-31", time: "23:59" });
  });

  it("take midnight when there's no time, and refuse what isn't a date", () => {
    expect(momentParts(localMoment("2027-01-01", "")!)).toEqual({ date: "2027-01-01", time: "00:00" });
    expect(localMoment("", "10:00")).toBeNull();
    expect(localMoment("2027-01-01", "10")).toBeNull();
  });
});

describe("sortTimers", () => {
  const now = at("2026-11-04T12:00:00");
  const t = (name: string, kind: "until" | "since", when: string) => ({ name, kind, targetAt: new Date(when).toISOString() });

  it("puts running countdowns first, soonest first, then counts since, most recent first", () => {
    const sorted = sortTimers(
      [
        t("reached", "until", "2026-11-01T00:00:00"),
        t("far", "until", "2027-06-01T00:00:00"),
        t("old", "since", "2020-01-01T00:00:00"),
        t("soon", "until", "2026-11-10T00:00:00"),
        t("pending", "since", "2026-12-01T00:00:00"),
        t("recent", "since", "2026-10-01T00:00:00"),
      ],
      now
    );
    expect(sorted.map((x) => x.name)).toEqual(["soon", "far", "recent", "old", "reached", "pending"]);
  });
});
