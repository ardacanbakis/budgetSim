import { describe, expect, it } from "vitest";
import { daysInMonth, pace } from "../pocket/pace";

describe("daysInMonth", () => {
  it("knows long, short and leap months", () => {
    expect(daysInMonth("2026-10-17")).toBe(31);
    expect(daysInMonth("2026-11-01")).toBe(30);
    expect(daysInMonth("2026-02-10")).toBe(28);
    expect(daysInMonth("2028-02-10")).toBe(29);
  });
});

describe("pace", () => {
  it("counts days left including today, and splits what's left over them", () => {
    // 10 Oct: 22 days to go, today included
    const p = pace({ spent: 4200, limit: 6000, today: "2026-10-10" });
    expect(p.daysLeft).toBe(22);
    expect(p.perDay).toBeCloseTo(1800 / 22, 10);
    expect(p.pct).toBeCloseTo(70, 10);
    expect(p.elapsedPct).toBeCloseTo((10 / 31) * 100, 10);
    expect(p.over).toBe(0);
  });

  it("has one day left on the last day of the month, and the whole month on the first", () => {
    expect(pace({ spent: 0, limit: 3100, today: "2026-10-31" }).daysLeft).toBe(1);
    expect(pace({ spent: 0, limit: 3100, today: "2026-10-31" }).perDay).toBe(3100);
    const first = pace({ spent: 0, limit: 3100, today: "2026-10-01" });
    expect(first.daysLeft).toBe(31);
    expect(first.perDay).toBe(100);
    expect(first.elapsedPct).toBeCloseTo(100 / 31, 10);
  });

  it("is ok while spending keeps pace with the month, ahead once it runs past", () => {
    // half the month gone (15 of 30 days)
    expect(pace({ spent: 500, limit: 1000, today: "2026-11-15" }).tone).toBe("ok");
    expect(pace({ spent: 400, limit: 1000, today: "2026-11-15" }).tone).toBe("ok");
    expect(pace({ spent: 501, limit: 1000, today: "2026-11-15" }).tone).toBe("ahead");
  });

  it("is over at the limit and past it, with the excess and nothing per day", () => {
    const at = pace({ spent: 1000, limit: 1000, today: "2026-11-02" });
    expect(at.tone).toBe("over");
    expect(at.over).toBe(0);
    expect(at.perDay).toBe(0);
    const past = pace({ spent: 1250, limit: 1000, today: "2026-11-02" });
    expect(past.tone).toBe("over");
    expect(past.over).toBe(250);
    expect(past.perDay).toBe(0);
    expect(past.pct).toBe(125);
    // the bar never draws past its track
    expect(past.fill).toBe(100);
  });

  it("copes with a zero limit", () => {
    expect(pace({ spent: 0, limit: 0, today: "2026-11-02" })).toMatchObject({ pct: 0, tone: "ok", perDay: 0, fill: 0 });
    expect(pace({ spent: 5, limit: 0, today: "2026-11-02" })).toMatchObject({ pct: 100, tone: "over", over: 5 });
  });
});
