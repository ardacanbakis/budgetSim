import { describe, expect, it } from "vitest";
import { formatForField, parseTypedDate } from "../dates";

const BASE = "2026-10-05";

describe("parseTypedDate", () => {
  it.each([
    ["17", "2026-10-17"],
    ["17 oct", "2026-10-17"],
    ["17 Oct", "2026-10-17"],
    ["oct 17", "2026-10-17"],
    ["17oct", "2026-10-17"],
    ["17 october 2025", "2025-10-17"],
    ["17 eki", "2026-10-17"],
    ["17 Ekim", "2026-10-17"],
    ["17 EKİM 2026", "2026-10-17"],
    ["3 şub", "2026-02-03"],
    ["3 sub", "2026-02-03"],
    ["3 ŞUBAT", "2026-02-03"],
    ["9 mayıs", "2026-05-09"],
    ["1 aralık", "2026-12-01"],
    ["1 sept", "2026-09-01"],
    ["29 feb 2028", "2028-02-29"],
    ["17 oct 27", "2027-10-17"],
    ["Sat, 17 Oct 2026", "2026-10-17"],
    ["17 Eki 2026", "2026-10-17"],
    ["17.10", "2026-10-17"],
    ["17/10/2026", "2026-10-17"],
    ["17-10-26", "2026-10-17"],
    ["5.6", "2026-06-05"],
    ["10/17", "2026-10-17"],
    ["10/17/2026", "2026-10-17"],
    ["2026-10-17", "2026-10-17"],
    ["2026-1-7", "2026-01-07"],
    ["  17   oct  ", "2026-10-17"],
  ])("reads %j", (text, expected) => {
    expect(parseTypedDate(text, BASE)).toBe(expected);
  });

  it("reads words for nearby days, in either language", () => {
    expect(parseTypedDate("today", BASE)).toBe("2026-10-05");
    expect(parseTypedDate("Bugün", BASE)).toBe("2026-10-05");
    expect(parseTypedDate("dün", BASE)).toBe("2026-10-04");
    expect(parseTypedDate("yesterday", "2026-03-01")).toBe("2026-02-28");
    expect(parseTypedDate("yarın", "2026-12-31")).toBe("2027-01-01");
  });

  it.each(["", "abc", "32", "31 feb", "30 şubat", "17 ma", "13/13", "2026", "17 oct 2026 extra", "1/2/3/4", "17 o"])(
    "refuses %j",
    (text) => {
      expect(parseTypedDate(text, BASE)).toBeNull();
    }
  );

  it("fills a typed day from the field's own month and year", () => {
    expect(parseTypedDate("3", "2025-06-20")).toBe("2025-06-03");
    expect(parseTypedDate("3 jan", "2025-06-20")).toBe("2025-01-03");
  });
});

describe("formatForField", () => {
  it("shows a short, typeable date", () => {
    expect(formatForField("2026-10-17", "en")).toBe("17 Oct 2026");
    expect(formatForField("2026-10-17", "tr")).toBe("17 Eki 2026");
  });

  it("reads back what it shows", () => {
    for (const iso of ["2026-01-09", "2026-05-31", "2027-12-01"]) {
      for (const locale of ["en", "tr"]) expect(parseTypedDate(formatForField(iso, locale), "2000-01-01")).toBe(iso);
    }
  });

  it("passes anything that isn't a date through", () => {
    expect(formatForField("", "en")).toBe("");
  });
});
