import { describe, expect, it } from "vitest";
import { inflate } from "../inflationCalc";

const index = { "2025-01": 100, "2025-07": 120, "2026-01": 144 };

describe("inflate", () => {
  it("scales an amount by the index between two months", () => {
    const r = inflate(10000, "2025-01", "2026-01", index)!;
    expect(r.value).toBeCloseTo(14400);
    expect(r.changePct).toBeCloseTo(44);
    expect(r.annualPct).toBeCloseTo(44);
    expect(r.clamped).toBe(false);
  });

  it("gives a yearly rate for a part of a year", () => {
    // 20% in six months is 44% a year
    expect(inflate(100, "2025-01", "2025-07", index)!.annualPct).toBeCloseTo(44);
  });

  it("goes backwards too: today's lira in an earlier month's", () => {
    expect(inflate(14400, "2026-01", "2025-01", index)!.value).toBeCloseTo(10000);
  });

  it("reads months outside the table as its nearest end, and says so", () => {
    const r = inflate(100, "2024-06", "2026-11", index)!;
    expect(r.fromMonth).toBe("2025-01");
    expect(r.toMonth).toBe("2026-01");
    expect(r.clamped).toBe(true);
    expect(inflate(100, "2025-01", "2025-01", index)!.annualPct).toBeNull();
  });

  it("refuses what it can't read", () => {
    expect(inflate(Number.NaN, "2025-01", "2026-01", index)).toBeNull();
    expect(inflate(1, "2025-1", "2026-01", index)).toBeNull();
    expect(inflate(1, "2025-01", "2026-01", {})).toBeNull();
  });
});
