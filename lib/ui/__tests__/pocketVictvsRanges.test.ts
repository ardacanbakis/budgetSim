import { describe, expect, it } from "vitest";
import { buildDemoSeed } from "@/lib/data/demoSeed";
import { VictvsSession } from "@/lib/data/types";
import { sumAmounts } from "@/lib/domain/money";
import {
  halfMonthRanges,
  lastDayOfMonth,
  toggleRange,
  unpaidSummary,
  victvsYears,
} from "../pocket/victvsRanges";

let n = 0;
const session = (date: string, extra: Partial<VictvsSession> = {}): VictvsSession => ({
  id: `s${++n}`,
  date,
  sessionType: "IWCF",
  sessionNo: String(70000 + n),
  amount: 60,
  status: "unpaid",
  payoutId: null,
  notes: "",
  source: "manual",
  createdAt: "2026-01-01T00:00:00.000Z",
  ...extra,
});

describe("lastDayOfMonth", () => {
  it("knows every month's length, leap Februaries included", () => {
    expect(lastDayOfMonth("2026-01")).toBe(31);
    expect(lastDayOfMonth("2026-02")).toBe(28);
    expect(lastDayOfMonth("2028-02")).toBe(29);
    expect(lastDayOfMonth("2026-09")).toBe(30);
    expect(lastDayOfMonth("2026-12")).toBe(31);
  });
});

describe("halfMonthRanges", () => {
  const sep = [
    session("2026-09-01", { id: "d1" }),
    session("2026-09-15", { id: "d15" }),
    session("2026-09-16", { id: "d16" }),
    session("2026-09-30", { id: "d30" }),
    session("2026-09-10", { id: "paid10", status: "paid", payoutId: "p1" }),
    session("2026-09-20", { id: "paid20", status: "paid", payoutId: "p1" }),
    session("2026-08-31", { id: "aug" }),
    session("2026-10-01", { id: "oct" }),
  ];

  it("splits the month's unpaid sessions on the page's day bounds: 1–15 and 16 to the end", () => {
    const r = halfMonthRanges(sep, "2026-09");
    expect(r.first.sort()).toEqual(["d1", "d15"]);
    expect(r.second.sort()).toEqual(["d16", "d30"]);
    expect(r.all.sort()).toEqual(["d1", "d15", "d16", "d30"]);
  });

  it("never includes paid sessions or another month's", () => {
    const r = halfMonthRanges(sep, "2026-09");
    for (const id of ["paid10", "paid20", "aug", "oct"]) {
      expect(r.first).not.toContain(id);
      expect(r.second).not.toContain(id);
      expect(r.all).not.toContain(id);
    }
  });

  it("the halves together are exactly the month's unpaid sessions", () => {
    const r = halfMonthRanges(sep, "2026-09");
    expect([...r.first, ...r.second].sort()).toEqual([...r.all].sort());
  });

  it("is empty for a month with nothing unpaid", () => {
    expect(halfMonthRanges(sep, "2026-07")).toEqual({ first: [], second: [], all: [] });
  });

  it("the 31st of a long month lands in the second half", () => {
    const r = halfMonthRanges([session("2026-10-31", { id: "d31" })], "2026-10");
    expect(r.second).toEqual(["d31"]);
    expect(r.first).toEqual([]);
  });

  it("matches the demo: last month's first half is the 8th and the 15th", () => {
    const seed = buildDemoSeed();
    const lastMonth = [...new Set(seed.victvsSessions.filter((s) => s.status === "unpaid").map((s) => s.date.slice(0, 7)))]
      .sort()
      .at(0)!;
    const r = halfMonthRanges(seed.victvsSessions, lastMonth);
    const days = (ids: string[]) => ids.map((id) => seed.victvsSessions.find((s) => s.id === id)!.date.slice(8)).sort();
    expect(days(r.first)).toEqual(["08", "15"]);
    expect(days(r.second)).toEqual(["22"]);
    expect(sumAmounts("USD", r.all.map((id) => seed.victvsSessions.find((s) => s.id === id)!.amount))).toBe(157.5);
  });
});

describe("toggleRange", () => {
  it("adds a range to what is already selected", () => {
    expect([...toggleRange(new Set(["x"]), ["a", "b"])].sort()).toEqual(["a", "b", "x"]);
  });

  it("selects the rest when only part of the range is selected", () => {
    expect([...toggleRange(new Set(["a"]), ["a", "b"])].sort()).toEqual(["a", "b"]);
  });

  it("takes the range away when every one of it is already selected", () => {
    expect([...toggleRange(new Set(["a", "b", "x"]), ["a", "b"])]).toEqual(["x"]);
  });

  it("an empty range changes nothing, and the input is never mutated", () => {
    const before = new Set(["a"]);
    expect([...toggleRange(before, [])]).toEqual(["a"]);
    toggleRange(before, ["b"]);
    expect([...before]).toEqual(["a"]);
  });
});

describe("victvsYears", () => {
  const sessions = [
    session("2025-12-02", { id: "old", amount: 37.5 }),
    session("2026-09-08", { id: "a", amount: 37.5 }),
    session("2026-09-22", { id: "b", amount: 60 }),
    session("2026-09-15", { id: "c", amount: 60, status: "paid", payoutId: "p" }),
    session("2026-10-04", { id: "d", amount: 30 }),
  ];

  it("groups by year and month, latest first, with USD totals and unpaid counts", () => {
    const years = victvsYears(sessions, "all");
    expect(years.map((y) => y.year)).toEqual(["2026", "2025"]);
    expect(years[0].months.map((m) => m.month)).toEqual(["2026-10", "2026-09"]);
    const sep = years[0].months[1];
    expect(sep.items.map((s) => s.id)).toEqual(["b", "c", "a"]);
    expect(sep.total).toBe(157.5);
    expect(sep.unpaidCount).toBe(2);
    expect(years[0].total).toBe(187.5);
    expect(years[0].count).toBe(4);
    expect(years[1]).toMatchObject({ year: "2025", count: 1, total: 37.5 });
  });

  it("filters by status the way the page's Unpaid | Paid | All does", () => {
    const unpaid = victvsYears(sessions, "unpaid");
    expect(unpaid.flatMap((y) => y.months.flatMap((m) => m.items.map((s) => s.id))).sort()).toEqual(["a", "b", "d", "old"]);
    const paid = victvsYears(sessions, "paid");
    expect(paid).toHaveLength(1);
    expect(paid[0].months).toEqual([expect.objectContaining({ month: "2026-09", total: 60, unpaidCount: 0 })]);
  });

  it("sums in cents, so a column of 37.5s and 0.1s adds up exactly", () => {
    const many = [0.1, 0.2, 37.5, 37.5].map((amount, i) => session(`2026-03-0${i + 1}`, { amount }));
    expect(victvsYears(many, "all")[0].total).toBe(75.3);
  });

  it("nothing in, nothing out", () => {
    expect(victvsYears([], "all")).toEqual([]);
  });
});

describe("unpaidSummary", () => {
  it("counts and totals the unpaid sessions, as the page's 'Unpaid' figure", () => {
    const seed = buildDemoSeed();
    const s = unpaidSummary(seed.victvsSessions);
    expect(s.count).toBe(4);
    expect(s.total).toBe(187.5);
    expect(s.ids).toHaveLength(4);
    expect(new Set(s.ids).size).toBe(4);
  });
});
