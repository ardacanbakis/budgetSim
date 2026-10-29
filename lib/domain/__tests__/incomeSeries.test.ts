import { describe, expect, it } from "vitest";
import { RecurringTemplate } from "@/lib/data/types";
import { combineSuggestions, incomeSeries, nameStem, raise, seriesKey } from "../incomeSeries";

function tpl(partial: Partial<RecurringTemplate> & Pick<RecurringTemplate, "id" | "startDate">): RecurringTemplate {
  return {
    name: "WBL",
    accountId: "usd",
    direction: "income",
    categoryId: "salary",
    amount: 1679,
    frequency: "monthly",
    endDate: null,
    autoComplete: false,
    loanId: null,
    createdAt: "2024-10-01",
    ...partial,
  };
}

describe("a raise", () => {
  it("ends this period the day before and starts the next in the same series", () => {
    const wbl = tpl({ id: "w1", startDate: "2024-10-05" });
    const plan = raise(wbl, 2090, "2026-03-05")!;
    expect(plan.end).toEqual({ id: "w1", endDate: "2026-03-04", series: "w1" });
    expect(plan.next).toMatchObject({ amount: 2090, startDate: "2026-03-05", endDate: null, series: "w1", accountId: "usd", categoryId: "salary" });
  });

  it("keeps a series it's already in, and refuses what isn't a raise", () => {
    const later = tpl({ id: "w2", startDate: "2026-03-05", amount: 2090, series: "w1" });
    expect(raise(later, 2300, "2027-03-05")!.next.series).toBe("w1");
    expect(raise(later, 2090, "2027-03-05")).toBeNull();
    expect(raise(later, 0, "2027-03-05")).toBeNull();
    expect(raise(later, 2300, "2026-03-05")).toBeNull();
    // past an end it doesn't reach
    expect(raise({ ...later, endDate: "2026-12-05" }, 2300, "2027-03-05")).toBeNull();
  });
});

describe("incomeSeries", () => {
  it("one line per income: the period running today, with the ones before it", () => {
    const p1 = tpl({ id: "w1", startDate: "2024-10-05", endDate: "2026-03-04", series: "w1" });
    const p2 = tpl({ id: "w2", startDate: "2026-03-05", amount: 2090, series: "w1" });
    const other = tpl({ id: "v", name: "VICTVS retainer", startDate: "2026-01-05", amount: 900 });
    const bill = tpl({ id: "rent", direction: "expense", startDate: "2026-01-10" });
    const series = incomeSeries([p2, other, bill, p1], "2026-10-29");
    expect(series.map((s) => [s.key, s.current.id, s.earlier.map((e) => e.id)])).toEqual([
      ["w1", "w2", ["w1"]],
      ["v", "v", []],
    ]);
  });

  it("a raise that hasn't started yet: today's period is still current", () => {
    const p1 = tpl({ id: "w1", startDate: "2024-10-05", endDate: "2026-11-30", series: "w1" });
    const p2 = tpl({ id: "w2", startDate: "2026-12-01", amount: 2090, series: "w1" });
    const [s] = incomeSeries([p1, p2], "2026-10-29");
    expect(s.current.id).toBe("w1");
    expect(s.periods.map((p) => p.id)).toEqual(["w1", "w2"]);
    expect(s.later.map((p) => p.id)).toEqual(["w2"]);
    expect(s.latest.id).toBe("w2");
  });
});

describe("combineSuggestions", () => {
  it("finds the same income entered year by year, in turn, on one account", () => {
    const y24 = tpl({ id: "a", name: "WBL 2024", startDate: "2024-10-05", endDate: "2024-12-05" });
    const y25 = tpl({ id: "b", name: "WBL 2025", startDate: "2025-01-05", endDate: "2025-12-05" });
    const y26 = tpl({ id: "c", name: "WBL – 2026", startDate: "2026-01-05", amount: 2090 });
    const [s, ...rest] = combineSuggestions([y26, y24, y25]);
    expect(rest).toEqual([]);
    expect(s.key).toBe("a");
    expect(s.templates.map((t) => t.id)).toEqual(["a", "b", "c"]);
    expect(nameStem("WBL – 2026")).toBe("wbl");
  });

  it("not when they overlap, sit on different accounts, or are one series already", () => {
    const a = tpl({ id: "a", name: "WBL 2024", startDate: "2024-10-05", endDate: "2025-06-05" });
    const b = tpl({ id: "b", name: "WBL 2025", startDate: "2025-01-05" });
    expect(combineSuggestions([a, b])).toEqual([]);
    const c = tpl({ id: "c", name: "WBL 2025", startDate: "2025-07-05", accountId: "try" });
    expect(combineSuggestions([a, c])).toEqual([]);
    const d = tpl({ id: "d", name: "WBL 2025", startDate: "2025-07-05", series: "a" });
    expect(combineSuggestions([{ ...a, series: "a" }, d])).toEqual([]);
    expect(seriesKey(d)).toBe("a");
  });
});
