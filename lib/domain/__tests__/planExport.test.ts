import { describe, expect, it } from "vitest";
import { runChecks } from "../planExport";
import type { ProjectionMonth, ProjectionResult } from "../projector";

const month = (over: Partial<ProjectionMonth>): ProjectionMonth => ({
  month: "2026-01",
  income: 0,
  expense: 0,
  net: 0,
  endNetWorth: 0,
  shortfall: 0,
  draws: [],
  uncovered: 0,
  sourceBalances: {},
  expenseByCategory: {},
  lines: [],
  ...over,
});

const result = (months: ProjectionMonth[]): ProjectionResult => ({
  startNetWorth: 0,
  months,
  skippedAccountIds: [],
});

const names = new Map([["gold", { name: "Gram Gold", currency: "USD" as const }]]);
const ok = (checks: ReturnType<typeof runChecks>, name: string) =>
  checks.find((c) => c.name.includes(name))!.ok;

describe("export checks", () => {
  it("passes a projection that adds up", () => {
    const r = result([
      month({ month: "2026-01", income: 100, expense: 40, net: 60, endNetWorth: 60 }),
      month({ month: "2026-02", income: 100, expense: 140, net: -40, endNetWorth: 20, shortfall: 40 }),
    ]);
    expect(runChecks(r, names, 25).every((c) => c.ok)).toBe(true);
  });

  it("catches a net that doesn't match its own income and expense", () => {
    const r = result([month({ income: 100, expense: 40, net: 999 })]);
    expect(ok(runChecks(r, names, 25), "net equals")).toBe(false);
  });

  it("catches a source that was sold below zero", () => {
    const r = result([
      month({
        sourceBalances: { gold: -5 },
        draws: [{ accountId: "gold", currency: "USD", amount: 5, value: 5, routine: false }],
      }),
    ]);
    const checks = runChecks(r, names, 25);
    expect(ok(checks, "sold below zero")).toBe(false);
    expect(checks.find((c) => c.name.includes("sold below zero"))!.detail).toContain("Gram Gold");
  });

  it("allows an account its own bills overdrew, when nothing was sold from it", () => {
    const r = result([month({ sourceBalances: { gold: -5 }, uncovered: 5 })]);
    expect(ok(runChecks(r, names, 25), "sold below zero")).toBe(true);
  });

  it("catches an unpaid month that still had something to sell", () => {
    // this is the shape of the bug that left gold untouched while short
    const r = result([month({ uncovered: 500, shortfall: 500, sourceBalances: { gold: 1200 } })]);
    expect(ok(runChecks(r, names, 25), "nothing is left unsold")).toBe(false);
  });

  it("catches net worth climbing through an unpaid month", () => {
    const r = result([
      month({ month: "2026-01", endNetWorth: 100 }),
      month({ month: "2026-02", endNetWorth: 200, uncovered: 500, shortfall: 500 }),
    ]);
    expect(ok(runChecks(r, names, 25), "doesn't rise")).toBe(false);
  });

  it("ignores a balance that's negative by rounding rather than by money", () => {
    const r = result([
      month({
        sourceBalances: { gold: -0.0005 },
        draws: [{ accountId: "gold", currency: "USD", amount: 1, value: 1, routine: false }],
      }),
    ]);
    expect(ok(runChecks(r, names, 25), "sold below zero")).toBe(true);
  });

  it("lets rounding dust past the threshold", () => {
    const r = result([
      month({ month: "2026-01", endNetWorth: 100 }),
      month({ month: "2026-02", endNetWorth: 200, uncovered: 0.4, sourceBalances: { gold: 9 } }),
    ]);
    expect(runChecks(r, names, 25).every((c) => c.ok)).toBe(true);
  });
});

describe("conduit accounts", () => {
  const conduit = new Map([
    ["usd", { name: "Semoş USD", currency: "USD" as const, startBalance: 6500, routine: false }],
  ]);

  it("flags an account that gives up more than it ever held", () => {
    // exactly the shape that confused a real plan: $450/mo of income lands
    // here and leaves again, so ten years of it reads as $65,000 "sold"
    const months = Array.from({ length: 12 }, (_, i) =>
      month({
        month: `2026-${String(i + 1).padStart(2, "0")}`,
        draws: [{ accountId: "usd", currency: "USD", amount: 1000, value: 1000, routine: false }],
      })
    );
    const checks = runChecks(result(months), conduit, 25);
    const c = checks.find((x) => x.name.includes("more than it ever held"))!;
    expect(c.ok).toBe(false);
    expect(c.detail).toContain("Semoş USD");
    expect(c.detail).toContain("mark it routine");
  });

  it("says nothing once it's marked routine", () => {
    const routine = new Map([
      ["usd", { name: "Semoş USD", currency: "USD" as const, startBalance: 6500, routine: true }],
    ]);
    const months = [
      month({ draws: [{ accountId: "usd", currency: "USD", amount: 60_000, value: 60_000, routine: true }] }),
    ];
    expect(runChecks(result(months), routine, 25).every((c) => c.ok)).toBe(true);
  });

  it("leaves a genuine asset sale alone", () => {
    const months = [
      month({ draws: [{ accountId: "usd", currency: "USD", amount: 6000, value: 6000, routine: false }] }),
    ];
    const c = runChecks(result(months), conduit, 25).find((x) => x.name.includes("more than it ever held"))!;
    expect(c.ok).toBe(true);
  });
});
