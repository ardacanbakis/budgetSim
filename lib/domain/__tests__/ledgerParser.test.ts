import { describe, expect, it } from "vitest";
import { extractLedgerDate, parseLedgerPaste, parseMoney } from "../ledgerParser";

describe("parseMoney", () => {
  it("reads both decimal conventions", () => {
    // Turkish bank export: dot groups thousands, comma is the decimal
    expect(parseMoney("1.250,50")).toBe(1250.5);
    expect(parseMoney("12.000,00")).toBe(12000);
    // international: comma groups, dot is the decimal
    expect(parseMoney("1,250.50")).toBe(1250.5);
    expect(parseMoney("12,000.00")).toBe(12000);
  });

  it("treats a lone separator before three digits as grouping", () => {
    expect(parseMoney("1.250")).toBe(1250);
    expect(parseMoney("1,250")).toBe(1250);
    // ...but two trailing digits is a decimal
    expect(parseMoney("1.25")).toBe(1.25);
    expect(parseMoney("1,25")).toBe(1.25);
  });

  it("ignores currency symbols and handles negatives", () => {
    expect(parseMoney("₺1.250,50")).toBe(1250.5);
    expect(parseMoney("$1,250.50")).toBe(1250.5);
    expect(parseMoney("-450,75")).toBe(-450.75);
    expect(parseMoney("no digits here")).toBeNull();
  });
});

describe("extractLedgerDate", () => {
  it("reads day-first formats, as Turkish statements write them", () => {
    expect(extractLedgerDate("15/03/2025")).toBe("2025-03-15");
    expect(extractLedgerDate("15.03.2025")).toBe("2025-03-15");
    expect(extractLedgerDate("15.03.25")).toBe("2025-03-15");
    expect(extractLedgerDate("2025-03-15")).toBe("2025-03-15");
    expect(extractLedgerDate("15 Mar 2025")).toBe("2025-03-15");
    expect(extractLedgerDate("nothing")).toBe("");
  });

  it("rejects impossible dates rather than guessing", () => {
    expect(extractLedgerDate("32/03/2025")).toBe("");
    expect(extractLedgerDate("15/13/2025")).toBe("");
  });
});

describe("parseLedgerPaste", () => {
  it("reads a tab-separated statement export", () => {
    const { rows } = parseLedgerPaste(
      [
        "Tarih\tAçıklama\tTutar",
        "15.03.2025\tAKBANK KREDI KARTI ODEME\t12.500,00",
        "02.04.2025\tMigros\t1.250,50",
      ].join("\n")
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      date: "2025-03-15",
      description: "AKBANK KREDI KARTI ODEME",
      amount: 12500,
    });
    expect(rows[1]).toMatchObject({ date: "2025-04-02", description: "Migros", amount: 1250.5 });
  });

  it("reads free-text lines", () => {
    const { rows } = parseLedgerPaste("15 Mar 2025 Akbank card payment ₺12.500,00");
    expect(rows[0]).toMatchObject({ date: "2025-03-15", amount: 12500 });
    expect(rows[0].description).toContain("Akbank card payment");
  });

  it("keeps rows that are missing a date, so they can be fixed in the preview", () => {
    const { rows } = parseLedgerPaste("Akbank statement\t12.500,00");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ date: "", description: "Akbank statement", amount: 12500 });
  });

  it("skips headers and blank lines", () => {
    const { rows } = parseLedgerPaste("Date\tDescription\tAmount\n\n   \n15.03.2025\tX\t100,00");
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(100);
  });

  it("picks the amount column even when other numbers are present", () => {
    // a card number fragment and a running balance shouldn't be mistaken for the amount
    const { rows } = parseLedgerPaste("15.03.2025\tPOS 1234\t-450,75");
    expect(rows[0].amount).toBe(-450.75);
  });
});
