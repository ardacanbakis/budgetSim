import { describe, expect, it } from "vitest";
import { VictvsPayout, VictvsSession } from "@/lib/data/types";
import { cleanVictvsOverrides, forecastVictvs, payoutLagDays, victvsForecastFlows } from "../victvsForecast";

const TODAY = "2026-10-19";

let seq = 0;
function session(date: string, amount: number, overrides: Partial<VictvsSession> = {}): VictvsSession {
  seq += 1;
  return {
    id: `s${seq}`,
    date,
    sessionType: "IWCF",
    sessionNo: String(10000 + seq),
    amount,
    status: "paid",
    payoutId: null,
    notes: "",
    source: "manual",
    createdAt: `${date}T09:00:00.000Z`,
    ...overrides,
  };
}
const payout = (id: string, paymentDate: string, total: number): VictvsPayout => ({
  id,
  paymentDate,
  accountId: "wise",
  total,
  transactionId: `tx-${id}`,
  sessionCount: 1,
  createdAt: `${paymentDate}T09:00:00.000Z`,
});

/** Two years of work: October busy, November light, December empty, the rest steady. */
function twoYears(): VictvsSession[] {
  const out: VictvsSession[] = [];
  for (const year of [2024, 2025]) {
    for (let m = 1; m <= 12; m++) {
      const month = `${year}-${String(m).padStart(2, "0")}`;
      if (m === 10) out.push(session(`${month}-05`, year === 2024 ? 400 : 500), session(`${month}-20`, 200));
      else if (m === 11) {
        if (year === 2024) out.push(session(`${month}-12`, 100));
      } else if (m !== 12) out.push(session(`${month}-10`, 120));
    }
  }
  // this year until last month: steady
  for (let m = 1; m <= 9; m++) out.push(session(`2026-${String(m).padStart(2, "0")}-10`, 150));
  return out;
}

describe("forecastVictvs: earnings by the month the work is done", () => {
  it("forecasts each month from the same month in earlier years, with their range", () => {
    const f = forecastVictvs({ sessions: twoYears(), payouts: [], today: TODAY, months: 6 });
    const [oct, nov, dec, jan] = f.earnings;
    expect(oct).toMatchObject({ month: "2026-10", basis: "seasonal", expected: 650, low: 600, high: 700 });
    expect(oct.samples).toEqual([
      { month: "2024-10", amount: 600 },
      { month: "2025-10", amount: 700 },
    ]);
    // a quiet month inside the history counts as zero, not as missing
    expect(nov).toMatchObject({ expected: 50, low: 0, high: 100, basis: "seasonal" });
    expect(dec).toMatchObject({ expected: 0, low: 0, high: 0, basis: "seasonal" });
    // the history starts with January 2024's session, so every January counts
    expect(jan.samples.map((s) => s.month)).toEqual(["2024-01", "2025-01", "2026-01"]);
    expect(jan.expected).toBe(130);
    expect(f.historyMonths).toBe(33);
  });

  it("starts the history at the first session, so earlier months aren't zeros", () => {
    const sessions = [session("2025-11-03", 90), session("2026-03-10", 120)];
    const f = forecastVictvs({ sessions, payouts: [], today: TODAY, months: 3 });
    // October has no earlier year inside the history: the recent months stand in
    expect(f.earnings[0].basis).toBe("recent");
    // November 2025 is the only November, and it was worked
    expect(f.earnings[1]).toMatchObject({ month: "2026-11", basis: "seasonal", expected: 90 });
    expect(f.historyMonths).toBe(11);
  });

  it("falls back to the last six complete months when no earlier year exists", () => {
    const sessions = ["2026-06-10", "2026-07-10", "2026-08-10", "2026-09-10"].map((d, i) => session(d, 100 + i * 20));
    const f = forecastVictvs({ sessions, payouts: [], today: TODAY, months: 2 });
    expect(f.earnings[0]).toMatchObject({ basis: "recent", expected: 130, low: 100, high: 160 });
    expect(f.earnings[0].samples.map((s) => s.month)).toEqual(["2026-06", "2026-07", "2026-08", "2026-09"]);
  });

  it("has nothing to say without history, and doesn't count this month as history", () => {
    expect(forecastVictvs({ sessions: [], payouts: [], today: TODAY, months: 2 }).earnings[0]).toMatchObject({
      basis: "none",
      expected: 0,
    });
    const f = forecastVictvs({ sessions: [session("2026-10-04", 30, { status: "unpaid" })], payouts: [], today: TODAY, months: 2 });
    expect(f.historyMonths).toBe(0);
    expect(f.earnings[0]).toMatchObject({ basis: "none", soFar: 30 });
  });

  it("shows this month's work so far against what it should earn", () => {
    const sessions = [...twoYears(), session("2026-10-04", 250, { status: "unpaid" })];
    const f = forecastVictvs({ sessions, payouts: [], today: TODAY, months: 2 });
    expect(f.earnings[0]).toMatchObject({ expected: 650, soFar: 250 });
    expect(f.earnings[1].soFar).toBe(0);
  });
});

describe("forecastVictvs: cash, by the month the money lands", () => {
  it("reads the lag from payouts: the median days from session to payout", () => {
    const p = payout("p1", "2026-09-15", 180);
    const sessions = [
      session("2026-08-10", 60, { payoutId: "p1" }),
      session("2026-08-20", 60, { payoutId: "p1" }),
      session("2026-08-25", 60, { payoutId: "p1" }),
    ];
    expect(payoutLagDays(sessions, [p])).toBe(26);
    expect(payoutLagDays(sessions, [])).toBeNull();
  });

  it("moves each month's earnings by the lag (a month without payouts to read)", () => {
    const f = forecastVictvs({ sessions: twoYears(), payouts: [], today: TODAY, months: 4 });
    expect(f.lagDays).toBeNull();
    expect(f.lagMonths).toBe(1);
    // October's work lands in November, November's in December
    expect(f.cash.map((c) => [c.month, c.expected])).toEqual([
      ["2026-10", 0],
      ["2026-11", 650],
      ["2026-12", 50],
      ["2027-01", 0],
    ]);
    expect(f.cash[1]).toMatchObject({ low: 600, high: 700 });
  });

  it("lands work already done at its month plus the lag, or now when that has passed", () => {
    const sessions = [
      ...twoYears(),
      session("2026-08-22", 60, { status: "unpaid" }),
      session("2026-10-04", 250, { status: "unpaid" }),
    ];
    const f = forecastVictvs({ sessions, payouts: [], today: TODAY, months: 3 });
    expect(f.unpaid).toBe(310);
    // August's straggler is overdue: this month. October's own: November, with the rest of October's forecast
    expect(f.cash[0]).toMatchObject({ month: "2026-10", expected: 60, earned: 60 });
    expect(f.cash[1]).toMatchObject({ month: "2026-11", expected: 650, earned: 250 });
    // only what's left to earn this month is forecast on top of what's worked
    expect(f.cash[1].low).toBe(600);
  });

  it("caps a backlog-sized lag, and a zero lag lands in the same month", () => {
    const late = payout("late", "2026-09-01", 100);
    const slow = forecastVictvs({
      sessions: [...twoYears(), session("2025-01-01", 100, { payoutId: "late" })],
      payouts: [late],
      today: TODAY,
      months: 6,
    });
    expect(slow.lagMonths).toBe(3);
    const quick = payout("quick", "2026-09-12", 150);
    const same = forecastVictvs({
      sessions: [...twoYears().filter((s) => s.date !== "2026-09-10"), session("2026-09-10", 150, { payoutId: "quick" })],
      payouts: [quick],
      today: TODAY,
      months: 2,
    });
    expect(same.lagMonths).toBe(0);
    expect(same.cash[0].expected).toBe(650);
  });
});

describe("forecastVictvs: figures you set yourself", () => {
  const auto = () => forecastVictvs({ sessions: twoYears(), payouts: [], today: TODAY, months: 4 });

  it("puts your figure in place of the computed one, keeping that alongside", () => {
    const f = forecastVictvs({ sessions: twoYears(), payouts: [], today: TODAY, months: 4, overrides: { "2026-11": 900 } });
    const nov = f.earnings[1];
    expect(nov).toMatchObject({ month: "2026-11", expected: 900, low: 900, high: 900, basis: "manual" });
    expect(nov.auto).toEqual({
      expected: 50,
      low: 0,
      high: 100,
      basis: "seasonal",
      samples: [
        { month: "2024-11", amount: 100 },
        { month: "2025-11", amount: 0 },
      ],
    });
    // the months around it are untouched, and carry no `auto`
    expect(f.earnings[0]).toMatchObject({ expected: 650, basis: "seasonal" });
    expect(f.earnings[0].auto).toBeUndefined();
  });

  it("moves the cash forecast with it, through the same lag", () => {
    const f = forecastVictvs({ sessions: twoYears(), payouts: [], today: TODAY, months: 4, overrides: { "2026-11": 900 } });
    // November's work lands in December: your 900 in place of the forecast's 50
    expect(f.cash[2]).toMatchObject({ month: "2026-12", expected: 900, low: 900, high: 900 });
    expect(f.cash[1]).toMatchObject({ month: "2026-11", expected: 650, low: 600, high: 700 });
    expect(victvsForecastFlows(f, "2026-10", { accountId: null, categoryId: "c", label: "VICTVS" })[1].amount).toBe(900);
  });

  it("counts this month's work so far against your figure for it", () => {
    const sessions = [...twoYears(), session("2026-10-04", 250, { status: "unpaid" })];
    const f = forecastVictvs({ sessions, payouts: [], today: TODAY, months: 2, overrides: { "2026-10": 400 } });
    expect(f.earnings[0]).toMatchObject({ expected: 400, soFar: 250, basis: "manual" });
    // 150 still to earn, plus the 250 worked and waiting
    expect(f.cash[1]).toMatchObject({ expected: 400, earned: 250 });
  });

  it("gives back exactly the computed forecast once the figure is removed", () => {
    const overrides: Record<string, number> = { "2026-11": 900, "2026-12": 40 };
    const edited = forecastVictvs({ sessions: twoYears(), payouts: [], today: TODAY, months: 4, overrides });
    delete overrides["2026-11"];
    delete overrides["2026-12"];
    const reverted = forecastVictvs({ sessions: twoYears(), payouts: [], today: TODAY, months: 4, overrides });
    expect(reverted).toEqual(auto());
    expect(reverted.earnings[1]).toMatchObject({ ...edited.earnings[1].auto, month: "2026-11", soFar: 0 });
    expect(forecastVictvs({ sessions: twoYears(), payouts: [], today: TODAY, months: 4, overrides: null })).toEqual(auto());
  });

  it("ignores figures for months already over, and anything that isn't an amount", () => {
    const f = forecastVictvs({
      sessions: twoYears(),
      payouts: [],
      today: TODAY,
      months: 4,
      overrides: { "2026-09": 5000, "2025-12": 1, "2027-01": -20, "2026-12": Number.NaN },
    });
    expect(f).toEqual(auto());
  });

  it("takes zero: a month you know will be quiet", () => {
    const f = forecastVictvs({ sessions: twoYears(), payouts: [], today: TODAY, months: 4, overrides: { "2026-10": 0 } });
    expect(f.earnings[0]).toMatchObject({ expected: 0, low: 0, high: 0, basis: "manual" });
    expect(f.earnings[0].auto?.expected).toBe(650);
    expect(f.cash[1]).toMatchObject({ month: "2026-11", expected: 0, low: 0, high: 0 });
  });

  it("cleans stored overrides: month keys, amounts to the cent, nothing past", () => {
    expect(
      cleanVictvsOverrides({ "2026-11": 900.456, "2026-10": 0, "2026-09": 300, "2026-13": 5, nope: 1, "2027-01": "12", "2027-02": -1 }, "2026-10")
    ).toEqual({ "2026-11": 900.46, "2026-10": 0 });
    expect(cleanVictvsOverrides(null, "2026-10")).toEqual({});
    expect(cleanVictvsOverrides([1, 2], "2026-10")).toEqual({});
  });
});

describe("victvsForecastFlows", () => {
  it("turns the cash forecast into the planner's USD income flows from its first month", () => {
    const f = forecastVictvs({ sessions: twoYears(), payouts: [], today: TODAY, months: 4 });
    const flows = victvsForecastFlows(f, "2026-11", { accountId: "wise", categoryId: "c-victvs", label: "VICTVS" });
    expect(flows).toEqual([
      { monthOffset: 0, direction: "income", amount: 650, currency: "USD", accountId: "wise", categoryId: "c-victvs", label: "VICTVS" },
      { monthOffset: 1, direction: "income", amount: 50, currency: "USD", accountId: "wise", categoryId: "c-victvs", label: "VICTVS" },
    ]);
  });
});
