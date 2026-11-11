import { describe, expect, it } from "vitest";
import { Account } from "@/lib/data/types";
import { TimelineEvent } from "../timeline";
import { realTerms, realTermsByLabel, recentAnnualInflationPct } from "../realTerms";

const account = (id: string, o: Partial<Account> = {}): Account => ({
  id,
  name: id,
  currency: "TRY",
  kind: "fiat",
  openingBalance: 0,
  archived: false,
  paymentAccountId: null,
  paymentDay: null,
  creditLimit: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  ...o,
});

const bank = account("bank", { name: "EnPara TRY" });
const usd = account("usd", { name: "EnPara USD", currency: "USD" });
const akbank = account("akbank", { name: "CC Akbank", kind: "credit_card", paymentAccountId: "bank", paymentDay: 16 });
const accounts = [bank, usd, akbank];
const today = "2026-11-06";

const event = (o: Partial<TimelineEvent> & Pick<TimelineEvent, "key" | "date">): TimelineEvent => ({
  kind: "tx",
  status: "planned",
  effectiveDate: o.date,
  legs: [],
  accountId: "bank",
  amount: 0,
  currency: "TRY",
  direction: "expense",
  ...o,
});

describe("recentAnnualInflationPct", () => {
  it("reads the last twelve months the table actually holds", () => {
    const index: Record<string, number> = {};
    // 2% a month for 13 months: a year of it is 1.02^12 - 1 = 26.82%
    for (let i = 0; i < 13; i++) {
      const m = 1 + i;
      index[`2026-${String(m).padStart(2, "0")}`] = 100 * Math.pow(1.02, i);
    }
    expect(recentAnnualInflationPct(index)).toBeCloseTo(26.82, 1);
  });

  it("says it doesn't know rather than inventing a rate", () => {
    expect(recentAnnualInflationPct({ "2026-01": 100, "2026-02": 110 })).toBeNull();
  });
});

describe("realTerms", () => {
  // a year of ₺10,000 statements, paid monthly, at 26.82% a year
  const annualPct = 26.82;
  const events: TimelineEvent[] = [
    event({
      key: "stmt:akbank:2026-12",
      date: "2026-12-16",
      kind: "statement",
      cardId: "akbank",
      legs: [{ accountId: "bank", delta: -10000 }],
    }),
    event({
      key: "stmt:akbank:2027-11",
      date: "2027-11-06",
      kind: "statement",
      cardId: "akbank",
      legs: [{ accountId: "bank", delta: -10000 }],
    }),
  ];
  const result = realTerms({ events, accounts, today, to: "2027-12-31", annualPct });

  it("names a statement after its card and a debt instalment after the debt", () => {
    expect(result.rows.map((r) => [r.label, r.group])).toEqual([
      ["CC Akbank", "card"],
      ["CC Akbank", "card"],
    ]);
  });

  it("discounts a payment by how far away it is, to the day", () => {
    // a calendar year out: 365 days is 11.99 average months, not 12 on the
    // nose, and the figure follows the days rather than the month boundary
    const far = result.rows.find((r) => r.date === "2027-11-06")!;
    expect(far.monthsAhead).toBeCloseTo(11.99, 1);
    expect(far.real).toBeCloseTo(10000 / 1.2682, -1);
    // forty days out: barely discounted at all
    const near = result.rows.find((r) => r.date === "2026-12-16")!;
    expect(near.real).toBeGreaterThan(9600);
    expect(near.real).toBeLessThan(10000);
  });

  it("shows what the currency's slide takes off the bill", () => {
    expect(result.totals.nominal).toBe(20000);
    expect(result.totals.saved).toBeCloseTo(result.totals.nominal - result.totals.real, 2);
    expect(result.totals.saved).toBeGreaterThan(2000);
  });

  it("never discounts another currency by this one's inflation", () => {
    const mixed = [...events, event({ key: "usd", date: "2027-01-05", legs: [{ accountId: "usd", delta: -1000 }] })];
    const lira = realTerms({ events: mixed, accounts, today, to: "2027-12-31", annualPct });
    expect(lira.rows.every((r) => r.key !== "usd:usd")).toBe(true);
    const dollars = realTerms({ events: mixed, accounts, today, to: "2027-12-31", annualPct, currency: "USD" });
    expect(dollars.rows.map((r) => r.label)).toEqual(["row usd"].map(() => dollars.rows[0].label));
    expect(dollars.totals.nominal).toBe(1000);
  });

  it("counts what goes out, never what comes in", () => {
    const withIncome = [...events, event({ key: "pay", date: "2026-12-05", legs: [{ accountId: "bank", delta: 50000 }] })];
    const r = realTerms({ events: withIncome, accounts, today, to: "2027-12-31", annualPct });
    expect(r.totals.nominal).toBe(20000);
  });

  it("leaves out what falls outside the window, and a marker that moves nothing", () => {
    const near = realTerms({ events, accounts, today, to: "2027-01-01", annualPct });
    expect(near.rows).toHaveLength(1);
    const marker = [event({ key: "end", date: "2026-12-01", kind: "milestone", status: "marker", legs: [] })];
    expect(realTerms({ events: marker, accounts, today, to: "2027-12-31", annualPct }).rows).toEqual([]);
  });

  it("at zero inflation the two figures are the same, so the view can't mislead", () => {
    const flat = realTerms({ events, accounts, today, to: "2027-12-31", annualPct: 0 });
    expect(flat.totals.real).toBeCloseTo(flat.totals.nominal, 2);
    expect(flat.totals.saved).toBeCloseTo(0, 2);
  });

  it("splits the three kinds apart, so a debt can be told from the shopping", () => {
    const mixed = [
      ...events,
      event({
        key: "loan",
        date: "2026-12-26",
        legs: [{ accountId: "bank", delta: -9046.8 }],
        tx: { loanId: "l1", description: "Tansu Akbank 100k Kredi" } as never,
      }),
      event({ key: "rent", date: "2026-12-10", legs: [{ accountId: "bank", delta: -27500 }], tx: { description: "Rent" } as never }),
    ];
    const r = realTerms({ events: mixed, accounts, today, to: "2027-12-31", annualPct });
    expect(r.byGroup.card.nominal).toBe(20000);
    expect(r.byGroup.debt.nominal).toBeCloseTo(9046.8, 2);
    expect(r.byGroup.other.nominal).toBe(27500);
  });
});

describe("realTermsByLabel", () => {
  it("gathers payments into one line a commitment, dearest first in real terms", () => {
    const events: TimelineEvent[] = [
      event({ key: "a1", date: "2026-12-16", kind: "statement", cardId: "akbank", legs: [{ accountId: "bank", delta: -10000 }] }),
      event({ key: "a2", date: "2027-01-16", kind: "statement", cardId: "akbank", legs: [{ accountId: "bank", delta: -10000 }] }),
      event({ key: "r1", date: "2026-12-10", legs: [{ accountId: "bank", delta: -27500 }], tx: { description: "Rent" } as never }),
    ];
    const lines = realTermsByLabel(realTerms({ events, accounts, today, to: "2027-12-31", annualPct: 26.82 }));
    // one rent of 27,500 is dearer in today's money than two 10,000
    // statements spread over two months, and the order says so
    expect(lines.map((l) => [l.label, l.count])).toEqual([
      ["Rent", 1],
      ["CC Akbank", 2],
    ]);
    const card = lines.find((l) => l.label === "CC Akbank")!;
    expect(card.from).toBe("2026-12-16");
    expect(card.to).toBe("2027-01-16");
    expect(card.totals.nominal).toBe(20000);
    expect(card.totals.real).toBeLessThan(20000);
  });
});
