import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeBalances } from "@/lib/domain/balances";
import { FxSnapshot } from "@/lib/domain/fx";
import { FALLBACK_USD_PER } from "@/lib/rates/fallback";
import { DemoRepo } from "../demoRepo";
import { NewTemplate } from "../repo";

/*
 * Recurring items through their whole life, driven through DemoRepo under
 * Node: what the ledger holds after creating, editing and opening the app.
 * SupabaseRepo runs the same domain functions, so these pin the shared rules.
 */

const snapshot: FxSnapshot = { usdPer: FALLBACK_USD_PER, at: "2026-10-06T09:00:00.000Z" };

/** Pretends the clock reads this local date (midday, clear of any timezone edge). */
const setToday = (date: string) => vi.setSystemTime(new Date(`${date}T12:00:00`));

async function freshRepo() {
  const repo = new DemoRepo();
  await repo.importAll({
    app: "renovator",
    version: 1,
    exportedAt: snapshot.at,
    accounts: [],
    categories: [],
    transactions: [],
    templates: [],
    victvsSessions: [],
    victvsPayouts: [],
    loans: [],
    purchases: [],
    budgets: [],
    goals: [],
    snapshots: [],
  });
  const account = await repo.createAccount({ name: "Ziraat TRY", currency: "TRY", kind: "fiat", openingBalance: 100000 });
  return { repo, account };
}

/** What the Bootstrapper does on every app open. */
async function openApp(repo: DemoRepo) {
  await repo.materializeTemplates(12);
  return repo.autoCompleteDue(snapshot);
}

async function balanceOf(repo: DemoRepo, accountId: string) {
  return computeBalances(await repo.listAccounts(), await repo.listTransactions()).get(accountId);
}

async function rowsOf(repo: DemoRepo, templateId: string) {
  return (await repo.listTransactions())
    .filter((t) => t.recurringTemplateId === templateId)
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
}

const loan = (accountId: string): NewTemplate => ({
  name: "Tansu Akbank 100k Kredi",
  accountId,
  direction: "expense",
  categoryId: null,
  amount: 5000,
  frequency: "monthly",
  startDate: "2025-10-15",
  endDate: "2027-09-15",
  autoComplete: true,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  setToday("2026-10-06");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a template whose start date has passed", () => {
  it("already paid: the past is history and the next app open takes nothing from the account", async () => {
    const { repo, account } = await freshRepo();
    const tpl = await repo.createTemplate(loan(account.id), { mode: "paid", fxSnapshot: snapshot });

    expect(await openApp(repo)).toBe(0);
    expect(await balanceOf(repo, account.id)).toBe(100000);

    const rows = await rowsOf(repo, tpl.id);
    const past = rows.filter((r) => r.dueDate < "2026-10-06");
    expect(past).toHaveLength(12);
    expect(past.every((r) => r.status === "completed" && r.legacy && r.fxSnapshot != null)).toBe(true);
    // from today on it's an ordinary schedule, one row a month to the end
    const ahead = rows.filter((r) => r.dueDate >= "2026-10-06");
    expect(ahead.map((r) => r.dueDate)).toEqual([
      "2026-10-15", "2026-11-15", "2026-12-15", "2027-01-15", "2027-02-15", "2027-03-15",
      "2027-04-15", "2027-05-15", "2027-06-15", "2027-07-15", "2027-08-15", "2027-09-15",
    ]);
    expect(ahead.every((r) => r.status === "planned" && !r.legacy)).toBe(true);
    expect((await repo.listTemplates())[0].startDate).toBe("2025-10-15");
  });

  it("already paid: the next installment still auto-completes when its day comes", async () => {
    const { repo, account } = await freshRepo();
    await repo.createTemplate(loan(account.id), { mode: "paid", fxSnapshot: snapshot });
    await openApp(repo);

    setToday("2026-10-15");
    expect(await openApp(repo)).toBe(1);
    expect(await balanceOf(repo, account.id)).toBe(95000);
  });

  it("leave to confirm: past items wait for a tap, even with auto-complete on", async () => {
    const { repo, account } = await freshRepo();
    const tpl = await repo.createTemplate(loan(account.id), { mode: "confirm", fxSnapshot: snapshot });

    expect(await openApp(repo)).toBe(0);
    expect(await balanceOf(repo, account.id)).toBe(100000);
    const past = (await rowsOf(repo, tpl.id)).filter((r) => r.dueDate < "2026-10-06");
    expect(past).toHaveLength(12);
    expect(past.every((r) => r.status === "planned" && !r.legacy)).toBe(true);
  });

  it("start from today: nothing before today, and the schedule begins at its next date", async () => {
    const { repo, account } = await freshRepo();
    const tpl = await repo.createTemplate(loan(account.id), { mode: "fromToday", fxSnapshot: snapshot });
    expect(tpl.startDate).toBe("2026-10-15");

    expect(await openApp(repo)).toBe(0);
    const rows = await rowsOf(repo, tpl.id);
    expect(rows[0].dueDate).toBe("2026-10-15");
    expect(rows).toHaveLength(12);
  });

  it("with no choice made (a loan's own template) the past is still filled in, to confirm", async () => {
    const { repo, account } = await freshRepo();
    const tpl = await repo.createTemplate(loan(account.id));

    expect(await openApp(repo)).toBe(0);
    expect(await balanceOf(repo, account.id)).toBe(100000);
    expect((await rowsOf(repo, tpl.id)).filter((r) => r.dueDate < "2026-10-06")).toHaveLength(12);
  });

  it("opening the app again adds nothing", async () => {
    const { repo, account } = await freshRepo();
    const tpl = await repo.createTemplate(loan(account.id), { mode: "paid", fxSnapshot: snapshot });
    await openApp(repo);
    const before = (await rowsOf(repo, tpl.id)).length;
    await openApp(repo);
    expect(await rowsOf(repo, tpl.id)).toHaveLength(before);
  });
});
