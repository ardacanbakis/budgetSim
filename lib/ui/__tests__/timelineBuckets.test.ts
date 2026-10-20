import { describe, expect, it } from "vitest";
import { buildDemoSeed } from "@/lib/data/demoSeed";
import { Account, Transaction } from "@/lib/data/types";
import { buildCardBook } from "@/lib/domain/cards";
import { todayISO } from "@/lib/domain/recurrence";
import { balanceAt, balanceSeries, buildTimeline } from "@/lib/domain/timeline";
import { groupMonthsDays, listedRows } from "../pocket/dayGroups";
import {
  balancesAfter,
  bucketTimeline,
  contributionOf,
  filterTimeline,
  flowBetween,
  monthHighlights,
  monthSummaries,
} from "../timeline";
import { parseTab } from "../urlTab";

const usdPer = { USD: 1, TRY: 1 / 41.8, EUR: 1.09, BTC: 104000, XAU_G: 78.5 };

function demo() {
  const seed = buildDemoSeed();
  const today = todayISO();
  const book = buildCardBook(seed.accounts, seed.transactions);
  const events = buildTimeline(
    { accounts: seed.accounts, transactions: seed.transactions, templates: seed.templates, loans: seed.loans, purchases: seed.purchases, book, usdPer },
    { to: "2099-12-31", today }
  );
  const accountsById = new Map(seed.accounts.map((a) => [a.id, a] as const));
  return { seed, today, book, events, accountsById };
}

describe("bucketTimeline", () => {
  it("gives past months the Ledger tab's nets (groupMonthsDays), in the display currency", () => {
    const { seed, today, book, events, accountsById } = demo();
    const done = events.filter((e) => e.status === "completed" && e.kind === "tx");
    const months = bucketTimeline(done, { accountsById, usdPer, display: "USD" });
    const completed = listedRows(seed.transactions, book).filter((t) => t.status === "completed");
    const ledger = groupMonthsDays(completed, { accountsById, usdPer, display: "USD", book });
    expect(months.length).toBe(ledger.length);
    for (const m of months) {
      const same = ledger.find((l) => l.month === m.month)!;
      expect(m.net).toBeCloseTo(same.net, 6);
      expect(m.income).toBeCloseTo(same.income, 6);
      expect(m.expense).toBeCloseTo(same.expense, 6);
      // days line up too
      for (const d of m.days) expect(d.net).toBeCloseTo(same.days.find((x) => x.date === d.date)!.net, 6);
    }
    expect(months.every((m) => m.month <= today.slice(0, 7))).toBe(true);
  });

  it("with one account: its own rows, nets in its currency, and the balance at each day's end", () => {
    const { seed, book, events, accountsById, today } = demo();
    const ziraat = seed.accounts.find((a) => a.name === "Ziraat TRY")!;
    const series = balanceSeries({ accounts: seed.accounts, transactions: seed.transactions, events, today });
    const mine = filterTimeline(events, { accountId: ziraat.id, milestones: false, legacy: false }).filter(
      (e) => e.status === "completed"
    );
    const months = bucketTimeline(mine, { accountsById, usdPer, display: "USD", accountId: ziraat.id, series: series.get(ziraat.id) });
    const ledger = groupMonthsDays(
      // with an account, the ledger lists both legs of a transfer on it
      listedRows(seed.transactions, book).filter((t) => t.status === "completed"),
      { accountsById, usdPer, display: "USD", book, accountId: ziraat.id }
    );
    for (const m of months) expect(m.net).toBeCloseTo(ledger.find((l) => l.month === m.month)!.net, 2);
    const day = months.at(-1)!.days.at(-1)!;
    expect(day.endBalance).toBe(balanceAt(series.get(ziraat.id)!.points, day.date));
  });
});

const account = (id: string, currency: Account["currency"] = "TRY"): Account => ({
  id,
  name: id,
  currency,
  kind: "fiat",
  openingBalance: 1000,
  archived: false,
  paymentAccountId: null,
  paymentDay: null,
  creditLimit: null,
  createdAt: "2026-01-01T00:00:00.000Z",
});
let seq = 0;
const tx = (accountId: string, dueDate: string, amount: number, o: Partial<Transaction> = {}): Transaction => ({
  id: `r${++seq}`,
  accountId,
  direction: "expense",
  categoryId: null,
  amount,
  status: "completed",
  dueDate,
  completedAt: null,
  description: "",
  fxSnapshot: null,
  transferGroupId: null,
  transferMarketRate: null,
  recurringTemplateId: null,
  loanId: null,
  victvsPayoutId: null,
  purchaseId: null,
  legacy: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  ...o,
});

describe("monthSummaries, flowBetween, balancesAfter", () => {
  const today = "2026-10-19";
  const bank = account("bank", "USD");
  const accounts = [bank];
  const rows = [
    tx("bank", "2026-07-03", 100, { direction: "income" }),
    tx("bank", "2026-08-03", 40),
    tx("bank", "2026-09-03", 300, { direction: "income" }),
    tx("bank", "2026-10-03", 50),
    tx("bank", "2026-10-10", 25, { status: "planned" }),
    tx("bank", "2026-10-25", 10, { status: "planned" }),
    tx("bank", "2026-11-25", 70, { status: "planned", direction: "income" }),
    tx("bank", "2026-06-03", 999, { legacy: true }),
  ];
  const book = buildCardBook(accounts, rows);
  const events = buildTimeline({ accounts, transactions: rows, book }, { to: "2027-10-19", today });
  const accountsById = new Map([["bank", bank]]);
  const options = { accountsById, usdPer, display: "USD" as const, today };

  it("averages the six months before, from the first month with anything in it", () => {
    const sums = monthSummaries(events, options);
    expect(sums.get("2026-07")).toMatchObject({ net: 100, avgNet: null });
    expect(sums.get("2026-08")!.avgNet).toBe(100);
    expect(sums.get("2026-09")!.avgNet).toBe(30);
    // October: the overdue row counts in the month it was due
    expect(sums.get("2026-10")).toMatchObject({ income: 0, expense: 85 });
    expect(sums.get("2026-10")!.avgNet).toBeCloseTo(120, 6);
    expect(sums.get("2026-11")).toMatchObject({ net: 70, avgNet: null });
    // legacy never counts
    expect(sums.has("2026-06")).toBe(false);
  });

  it("adds up what is still to happen in a stretch, overdue included", () => {
    expect(flowBetween(events, today, "2026-11-18", options)).toEqual({ income: 0, expense: 35, net: -35 });
    expect(flowBetween(events, today, "2026-11-30", options)).toEqual({ income: 70, expense: 35, net: 35 });
  });

  it("walks the balance after each row the way the series walks it", () => {
    const series = balanceSeries({ accounts, transactions: rows, events, today }).get("bank")!;
    const after = balancesAfter(events, "bank", series);
    const last = events.filter((e) => e.legs.length).at(-1)!;
    expect(after.get(last.key)).toBe(series.points.at(-1)!.balance);
    expect(after.get(rows[3].id)).toBe(1310);
    expect(after.get(rows[4].id)).toBe(1285);
  });

  it("filters milestones, history and one account", () => {
    expect(filterTimeline(events, { accountId: null, milestones: true, legacy: false }).some((e) => e.legacy)).toBe(false);
    expect(filterTimeline(events, { accountId: null, milestones: true, legacy: true }).some((e) => e.legacy)).toBe(true);
    expect(filterTimeline(events, { accountId: "other", milestones: true, legacy: true })).toEqual([]);
  });

  it("picks a month's three biggest outflows", () => {
    const [october] = bucketTimeline(
      events.filter((e) => e.date.startsWith("2026-10")),
      options
    );
    expect(monthHighlights(october, options).outflows.map((e) => e.amount)).toEqual([50, 25, 10]);
  });
});

describe("parseTab", () => {
  it("keeps an allowed tab and falls back otherwise", () => {
    const tabs = ["ledger", "timeline", "recurring"] as const;
    expect(parseTab("timeline", tabs, "ledger")).toBe("timeline");
    expect(parseTab("nope", tabs, "ledger")).toBe("ledger");
    expect(parseTab(null, tabs, "ledger")).toBe("ledger");
  });
});

describe("expected VICTVS payouts in the sums", () => {
  it("count only with countExpected", () => {
    const bank = account("bank", "USD");
    const event = {
      key: "victvs:2026-11",
      kind: "expected" as const,
      status: "expected" as const,
      date: "2026-11-15",
      effectiveDate: "2026-11-15",
      legs: [{ accountId: "bank", delta: 650 }],
      accountId: "bank",
      amount: 650,
      currency: "USD" as const,
      direction: "income" as const,
    };
    const options = { accountsById: new Map([["bank", bank]]), usdPer, display: "USD" as const };
    expect(contributionOf(event, options)).toBeNull();
    expect(contributionOf(event, { ...options, accountId: "bank" })).toBeNull();
    expect(contributionOf(event, { ...options, countExpected: true })).toEqual([650, 0]);
    expect(flowBetween([event], "2026-10-19", "2026-11-30", { ...options, countExpected: true }).income).toBe(650);
  });
});
