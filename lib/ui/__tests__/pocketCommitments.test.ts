import { describe, expect, it } from "vitest";
import { Account, RecurringTemplate, Transaction } from "@/lib/data/types";
import { Currency } from "@/lib/domain/currencies";
import { UsdPerMap } from "@/lib/domain/fx";
import { TemplateProgress, templateProgress } from "@/lib/domain/templateStatus";
import {
  dueOccurrences,
  monthlyCommitments,
  PER_MONTH,
  recurringList,
  scaleCommitments,
} from "../pocket/commitments";

const TODAY = "2026-10-17";

const account = (id: string, currency: Currency): Account => ({
  id,
  name: id,
  currency,
  kind: "fiat",
  openingBalance: 0,
  archived: false,
  paymentAccountId: null,
  paymentDay: null,
  creditLimit: null,
  createdAt: "2026-01-01T00:00:00.000Z",
});

const bank = account("Ziraat TRY", "TRY");
const wise = account("Wise USD", "USD");
const accountsById = new Map([bank, wise].map((a) => [a.id, a]));
const usdPer: UsdPerMap = { USD: 1, TRY: 0.025, EUR: 1.1, BTC: 60000, XAU_G: 80 };

const template = (overrides: Partial<RecurringTemplate> & Pick<RecurringTemplate, "id" | "name">): RecurringTemplate => ({
  accountId: bank.id,
  direction: "expense",
  categoryId: null,
  amount: 100,
  frequency: "monthly",
  startDate: "2026-01-10",
  endDate: null,
  autoComplete: false,
  loanId: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

let seq = 0;
const row = (tpl: RecurringTemplate, dueDate: string, status: Transaction["status"]): Transaction => ({
  id: `r${++seq}`,
  accountId: tpl.accountId,
  direction: tpl.direction,
  categoryId: null,
  amount: tpl.amount,
  status,
  dueDate,
  completedAt: status === "completed" ? `${dueDate}T12:00:00.000Z` : null,
  description: tpl.name,
  fxSnapshot: null,
  transferGroupId: null,
  transferMarketRate: null,
  recurringTemplateId: tpl.id,
  loanId: tpl.loanId,
  victvsPayoutId: null,
  purchaseId: null,
  legacy: false,
  createdAt: `${dueDate}T08:00:00.000Z`,
});

// rent: monthly ₺27,500 on the 10th, this month's still to confirm
const rent = template({ id: "rent", name: "Rent", amount: 27500, autoComplete: true });
// the retainer: $900 a month, in, on the 5th, still to confirm
const retainer = template({ id: "retainer", name: "VICTVS retainer", accountId: wise.id, direction: "income", amount: 900, startDate: "2026-01-05" });
// a weekly lesson: ₺600, every Monday
const lesson = template({ id: "lesson", name: "Piano lesson", amount: 600, frequency: "weekly", startDate: "2026-10-05" });
// insurance: $1,200 a year, due on 20 October
const insurance = template({ id: "insurance", name: "Insurance", accountId: wise.id, amount: 1200, frequency: "yearly", startDate: "2025-10-20" });
// a gym membership that ended and was settled
const gym = template({ id: "gym", name: "Gym", amount: 800, startDate: "2026-01-15", endDate: "2026-03-15" });
// a course starting next month
const course = template({ id: "course", name: "Course", amount: 1500, startDate: "2026-11-02", endDate: "2027-02-02" });

const templates = [rent, retainer, lesson, insurance, gym, course];
const transactions: Transaction[] = [
  row(rent, "2026-09-10", "completed"),
  row(rent, "2026-10-10", "planned"),
  row(rent, "2026-11-10", "planned"),
  row(retainer, "2026-09-05", "completed"),
  row(retainer, "2026-10-05", "planned"),
  row(retainer, "2026-11-05", "planned"),
  row(lesson, "2026-10-12", "completed"),
  row(lesson, "2026-10-19", "planned"),
  row(insurance, "2025-10-20", "completed"),
  row(insurance, "2026-10-20", "planned"),
  row(gym, "2026-01-15", "completed"),
  row(gym, "2026-02-15", "completed"),
  row(gym, "2026-03-15", "completed"),
  row(course, "2026-11-02", "planned"),
];
const progressById = new Map<string, TemplateProgress>(templates.map((t) => [t.id, templateProgress(t, transactions, TODAY)]));

describe("monthlyCommitments", () => {
  it("sums what the unfinished templates take and bring a month, in the display currency", () => {
    const c = monthlyCommitments({ templates, progressById, accountsById, usdPer, display: "USD" });
    // out: rent $687.50 + lessons ₺600 × 52/12 ($65) + insurance $1,200 / 12 + the course ₺1,500 ($37.50); the gym is finished
    expect(c.out).toBeCloseTo(687.5 + 15 * (52 / 12) + 100 + 37.5, 6);
    expect(c.in).toBeCloseTo(900, 6);
    expect(c.missing).toBe(0);
  });

  it("uses the frequency factors weekly 52/12, monthly 1, yearly 1/12", () => {
    expect(PER_MONTH).toEqual({ weekly: 52 / 12, monthly: 1, yearly: 1 / 12 });
    const only = (tpl: RecurringTemplate) =>
      monthlyCommitments({ templates: [tpl], progressById, accountsById, usdPer, display: "TRY" }).out;
    expect(only(lesson)).toBeCloseTo((600 * 52) / 12, 6);
    expect(only(rent)).toBeCloseTo(27500, 6);
    expect(only(insurance)).toBeCloseTo(48000 / 12, 6);
  });

  it("skips a finished template", () => {
    expect(progressById.get("gym")!.status).toBe("completed");
    const c = monthlyCommitments({ templates: [gym], progressById, accountsById, usdPer, display: "TRY" });
    expect(c.out).toBe(0);
    expect(c.next).toBeNull();
  });

  it("Yearly is twelve Monthlies", () => {
    const monthly = monthlyCommitments({ templates, progressById, accountsById, usdPer, display: "EUR" });
    const yearly = scaleCommitments(monthly, "yearly");
    expect(yearly.out).toBeCloseTo(monthly.out * 12, 9);
    expect(yearly.in).toBeCloseTo(monthly.in * 12, 9);
    expect(scaleCommitments(monthly, "monthly")).toBe(monthly);
  });

  it("names the soonest next date", () => {
    // rent and the retainer were due earlier; their next is the next one ahead of today
    const c = monthlyCommitments({ templates, progressById, accountsById, usdPer, display: "USD" });
    expect(c.next).toEqual({ name: "Piano lesson", due: "2026-10-19" });
  });

  it("counts what it can't convert, and still sums the display currency without rates", () => {
    const c = monthlyCommitments({ templates: [rent, retainer], progressById, accountsById, usdPer: undefined, display: "TRY" });
    expect(c.out).toBe(27500);
    expect(c.in).toBe(0);
    expect(c.missing).toBe(1);
    const orphan = template({ id: "orphan", name: "Orphan", accountId: "gone" });
    expect(monthlyCommitments({ templates: [orphan], progressById, accountsById, usdPer, display: "TRY" }).missing).toBe(1);
  });
});

describe("recurringList", () => {
  it("lists templates with items to confirm first, then by next due date; finished apart", () => {
    const list = recurringList(templates, progressById, { status: "all", direction: "all" });
    // open items: the retainer (5 Oct) and rent (10 Oct); then the lesson (19 Oct), insurance (20 Oct), the course (2 Nov)
    expect(list.live.map((t) => t.id)).toEqual(["retainer", "rent", "lesson", "insurance", "course"]);
    expect(list.finished.map((t) => t.id)).toEqual(["gym"]);
  });

  it("filters and counts as the Classic chips do: counts follow the direction filter", () => {
    const all = recurringList(templates, progressById, { status: "all", direction: "all" });
    expect(all.counts).toEqual({ all: 6, active: 4, notStarted: 1, toConfirm: 0, completed: 1 });
    const income = recurringList(templates, progressById, { status: "all", direction: "income" });
    expect(income.live.map((t) => t.id)).toEqual(["retainer"]);
    expect(income.counts.all).toBe(1);
    const notStarted = recurringList(templates, progressById, { status: "notStarted", direction: "all" });
    expect(notStarted.live.map((t) => t.id)).toEqual(["course"]);
    const finished = recurringList(templates, progressById, { status: "completed", direction: "expense" });
    expect(finished.live).toEqual([]);
    expect(finished.finished.map((t) => t.id)).toEqual(["gym"]);
  });

  it("a schedule that ran out with items left is 'to confirm'", () => {
    const ended = template({ id: "ended", name: "Ended", startDate: "2026-08-01", endDate: "2026-09-01" });
    const rows = [row(ended, "2026-08-01", "completed"), row(ended, "2026-09-01", "planned")];
    const progress = new Map([[ended.id, templateProgress(ended, rows, TODAY)]]);
    const list = recurringList([ended], progress, { status: "toConfirm", direction: "all" });
    expect(list.counts.toConfirm).toBe(1);
    expect(list.live.map((t) => t.id)).toEqual(["ended"]);
  });
});

describe("dueOccurrences", () => {
  it("is a template's planned rows dated today or earlier, oldest first", () => {
    const extra = row(rent, "2026-09-10", "planned");
    const due = dueOccurrences(rent, [...transactions, extra], TODAY);
    expect(due.map((t) => t.dueDate)).toEqual(["2026-09-10", "2026-10-10"]);
    expect(dueOccurrences(lesson, transactions, TODAY)).toEqual([]);
    expect(dueOccurrences(lesson, transactions, "2026-10-19").map((t) => t.dueDate)).toEqual(["2026-10-19"]);
  });
});
