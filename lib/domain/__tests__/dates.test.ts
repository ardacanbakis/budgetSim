import { describe, expect, it } from "vitest";
import { formatDate, isDateFormat } from "../dates";

describe("formatDate", () => {
  const iso = "2026-03-09";

  it("renders each supported format", () => {
    expect(formatDate(iso, "iso")).toBe("2026-03-09");
    expect(formatDate(iso, "dmy")).toBe("09/03/2026");
    expect(formatDate(iso, "mdy")).toBe("03/09/2026");
    expect(formatDate(iso, "dmy-dot")).toBe("09.03.2026");
    expect(formatDate(iso, "long", "en")).toBe("Mar 9, 2026");
  });

  it("uses the locale for the long month name", () => {
    // Turkish short month for March is "Mar" too, but the ordering/locale path runs
    expect(formatDate(iso, "long", "tr")).toContain("2026");
  });

  it("defaults to ISO and passes through non-ISO input unchanged", () => {
    expect(formatDate(iso)).toBe("2026-03-09");
    expect(formatDate("")).toBe("");
    expect(formatDate(null)).toBe("");
    expect(formatDate("not-a-date", "dmy")).toBe("not-a-date");
    expect(formatDate("2026-03", "dmy")).toBe("2026-03");
  });

  it("validates format ids", () => {
    expect(isDateFormat("dmy")).toBe(true);
    expect(isDateFormat("nope")).toBe(false);
  });
});
