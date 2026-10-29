import { expect, Page, test } from "@playwright/test";
import { pinRates } from "./support/rates";

// the same rates in every run, offline or in CI (see support/rates.ts)
test.beforeEach(async ({ page }) => {
  await pinRates(page);
});

/**
 * Debts, in the Portfolio's Debts view: borrowed or lent, from a person or a
 * bank, with the money's own row, payments made, a date planned, the payoff
 * suggestion, and Move to Debts from Data check and from a recurring item.
 */

const DEMO_KEY = "renovator-demo-v5";

interface Store {
  accounts: Array<{ id: string; name: string }>;
  templates: Array<{ id: string; name: string; loanId: string | null }>;
  loans: Array<{ id: string; name: string; direction?: string; payoffDate?: string | null; recurringTemplateId: string | null }>;
  transactions: Array<{ id: string; accountId: string; loanId: string | null; direction: string; amount: number; status: string; dueDate: string; loanPrincipal?: boolean; description: string }>;
}

const store = (page: Page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}") as Store, DEMO_KEY);

async function enterDemo(page: Page, width = 1400, height = 1000) {
  await page.setViewportSize({ width, height });
  await page.goto("/welcome");
  await page.getByRole("button", { name: /demo/i }).click();
  await expect(page.getByText(/Net worth|Toplam varlık/).first()).toBeVisible({ timeout: 15_000 });
}

function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** A date as the form's field shows it, for typing into it. */
const typed = (isoDate: string) => new Date(`${isoDate}T12:00:00`).toLocaleDateString("en-GB");

async function newDebt(page: Page) {
  await page.goto("/accounts?view=debts");
  await page.getByRole("button", { name: "+ New debt" }).click();
  const form = page.locator("[data-debt-form]");
  await expect(form).toBeVisible();
  return form;
}

test("borrowed from a person: the money lands, a payment counts, and a date plans the rest", async ({ page }) => {
  await enterDemo(page);
  const form = await newDebt(page);
  await form.getByLabel("Person", { exact: true }).fill("Ahmet");
  await form.getByLabel("Amount", { exact: true }).fill("12500");
  await page.getByRole("button", { name: "Save" }).click();

  const pane = page.locator("[data-loan-pane]");
  await expect(pane).toContainText("Ahmet");
  await expect(pane.getByText("You owe")).toBeVisible();
  await expect(pane.locator("[data-debt-remaining]")).toHaveText("−₺12,500.00");
  await expect(pane.locator("[data-debt-rows]")).toContainText("Borrowed");
  // the row on Ziraat TRY: the money itself, not income
  const s = await store(page);
  const loan = s.loans.find((l) => l.name === "Ahmet")!;
  const money = s.transactions.filter((t) => t.loanId === loan.id);
  expect(money).toEqual([expect.objectContaining({ direction: "income", amount: 12500, status: "completed", loanPrincipal: true })]);

  // 5,000 paid back: 7,500 left
  await pane.getByRole("button", { name: "Record a payment" }).click();
  const record = page.locator("[data-debt-record]");
  await record.getByLabel(/^Amount/).fill("5000");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(pane.locator("[data-debt-remaining]")).toHaveText("−₺7,500.00");
  await expect(pane).toContainText("₺5,000.00 of ₺12,500.00 repaid");

  // a date: the 7,500 is planned on it
  const later = new Date();
  later.setMonth(later.getMonth() + 2, 15);
  await pane.getByRole("button", { name: "Edit" }).click();
  await form.getByRole("radio", { name: "One payment on a date" }).check();
  await form.getByLabel("Repay on").fill(typed(iso(later)));
  await form.getByLabel("Repay on").press("Tab");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(pane).toContainText(/Repay on/);
  await expect
    .poll(async () => (await store(page)).transactions.filter((t) => t.loanId === loan.id && t.status === "planned").map((t) => [t.amount, t.dueDate]))
    .toEqual([[7500, iso(later)]]);
  // the edit is in its history
  await expect(pane.locator("[data-entity-changes]")).toContainText("Repay on");
});

test("lent to a person: owed to you, in its own list, and the summary says so", async ({ page }) => {
  await enterDemo(page);
  const form = await newDebt(page);
  await form.getByRole("button", { name: "I lent" }).click();
  await form.getByLabel("Person", { exact: true }).fill("Mehmet");
  await form.getByLabel("Amount", { exact: true }).fill("3000");
  await page.getByRole("button", { name: "Save" }).click();

  const pane = page.locator("[data-loan-pane]");
  await expect(pane.getByText("Owed to you", { exact: true })).toBeVisible();
  await expect(pane.locator("[data-debt-remaining]")).toHaveText("+₺3,000.00");
  await expect(pane.getByRole("button", { name: "Record money back" })).toBeVisible();
  // no "when can you repay it": it isn't yours to repay
  await expect(pane.locator("[data-payoff]")).toHaveCount(0);
  await expect(page.locator("[data-owed-to-you-list]")).toContainText("Mehmet");
  await expect(page.locator("[data-owed-to-you]")).toContainText("Owed to you");
  const s = await store(page);
  const loan = s.loans.find((l) => l.name === "Mehmet")!;
  expect(loan.direction).toBe("lent");
  expect(s.transactions.filter((t) => t.loanId === loan.id)).toEqual([
    expect.objectContaining({ direction: "expense", amount: 3000, loanPrincipal: true }),
  ]);
});

test("the payoff suggestion plans the payment on its date, and the way back undoes it", async ({ page }) => {
  await enterDemo(page);
  const form = await newDebt(page);
  await form.getByLabel("Person", { exact: true }).fill("Ayşe");
  await form.getByLabel("Amount", { exact: true }).fill("500");
  await page.getByRole("button", { name: "Save" }).click();
  const pane = page.locator("[data-loan-pane]");
  const payoff = pane.locator("[data-payoff]");
  await expect(payoff.getByText("When can you repay it?")).toBeVisible();
  const option = payoff.locator("[data-payoff-option]").first();
  await expect(option).toBeVisible();
  await option.getByRole("button", { name: /^Plan it for / }).click();
  await expect(payoff).toContainText(/Planned for/);
  const s = await store(page);
  const loan = s.loans.find((l) => l.name === "Ayşe")!;
  expect(loan.payoffDate).toBeTruthy();
  expect(s.transactions.filter((t) => t.loanId === loan.id && t.status === "planned")).toEqual([
    expect.objectContaining({ amount: 500, dueDate: loan.payoffDate }),
  ]);
  await payoff.getByRole("button", { name: "Back to when I can" }).click();
  await expect(payoff).not.toContainText(/Planned for/);
  await expect.poll(async () => (await store(page)).transactions.filter((t) => t.loanId === loan.id && t.status === "planned").length).toBe(0);
});

test("Move to Debts from Data check: the borrowed income becomes the debt's money, not another row", async ({ page }) => {
  await enterDemo(page);
  const now = new Date();
  const first = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  await page.evaluate(
    ({ key, first }) => {
      const s = JSON.parse(localStorage.getItem(key)!);
      const ziraat = s.accounts.find((a: { name: string }) => a.name === "Ziraat TRY");
      s.transactions.push({
        id: "e2e-advance",
        accountId: ziraat.id,
        direction: "income",
        categoryId: null,
        amount: 12500,
        status: "completed",
        dueDate: first,
        completedAt: null,
        description: "nakit avans 12.5k",
        fxSnapshot: null,
        transferGroupId: null,
        transferMarketRate: null,
        recurringTemplateId: null,
        loanId: null,
        victvsPayoutId: null,
        purchaseId: null,
        legacy: false,
        createdAt: new Date().toISOString(),
      });
      localStorage.setItem(key, JSON.stringify(s));
    },
    { key: DEMO_KEY, first }
  );
  await page.goto("/settings?tab=check");
  const issue = page.locator('[data-issue="borrowedAsIncome"]');
  await expect(issue).toContainText("nakit avans 12.5k");
  await issue.getByRole("button", { name: "Move to Debts" }).click();
  const form = page.locator("[data-debt-form]");
  await expect(form).toContainText("Already on the ledger: nakit avans 12.5k");
  await form.getByLabel("Person", { exact: true }).fill("Card cash advance");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(issue).toHaveCount(0);
  const s = await store(page);
  const advance = s.transactions.find((t) => t.id === "e2e-advance")!;
  expect(advance.loanId).toBeTruthy();
  expect(advance.loanPrincipal).toBe(true);
  // one row: the one that was there
  expect(s.transactions.filter((t) => t.loanId === advance.loanId)).toHaveLength(1);
});

test("Move to Debts from a recurring item: its payments are the debt's, and what's left follows them", async ({ page }) => {
  await enterDemo(page);
  const start = new Date();
  start.setMonth(start.getMonth() - 2, 20);
  const end = new Date(start);
  end.setMonth(end.getMonth() + 11);
  await page.evaluate(
    ({ key, start, end }) => {
      const s = JSON.parse(localStorage.getItem(key)!);
      const ziraat = s.accounts.find((a: { name: string }) => a.name === "Ziraat TRY");
      s.templates.push({
        id: "e2e-qnb",
        name: "Semoş QNB 30k",
        accountId: ziraat.id,
        direction: "expense",
        categoryId: null,
        amount: 2500,
        frequency: "monthly",
        startDate: start,
        endDate: end,
        autoComplete: false,
        loanId: null,
        createdAt: new Date().toISOString(),
      });
      localStorage.setItem(key, JSON.stringify(s));
    },
    { key: DEMO_KEY, start: iso(start), end: iso(end) }
  );
  await page.goto("/transactions?tab=bills");
  const card = page.getByText("Semoş QNB 30k", { exact: true }).first().locator("xpath=ancestor::div[contains(@class,'border')][1]");
  await card.getByRole("button", { name: "Edit" }).click();
  await page.getByRole("button", { name: "Move to Debts" }).click();
  const form = page.locator("[data-debt-form]");
  await expect(form).toContainText("From the recurring item Semoş QNB 30k: 12 payments of ₺2,500.00");
  await form.getByRole("button", { name: "Bank" }).click();
  await form.getByLabel("Bank", { exact: true }).fill("QNB");
  await page.getByRole("button", { name: "Save" }).click();

  const s = await store(page);
  const loan = s.loans.find((l) => l.name === "Semoş QNB 30k")!;
  expect(loan.recurringTemplateId).toBe("e2e-qnb");
  expect(s.templates.find((t) => t.id === "e2e-qnb")!.loanId).toBe(loan.id);
  await page.goto(`/accounts?view=debts&loan=${loan.id}`);
  const pane = page.locator("[data-loan-pane]");
  // 12 × 2,500 = 30,000, none paid yet
  await expect(pane.locator("[data-debt-remaining]")).toHaveText("−₺30,000.00");
  await expect(page.locator("[data-debt-row='Semoş QNB 30k']")).toBeVisible();
});

test("Pocket: a debt's page records a payment and edits, and Debts has New debt", async ({ page }) => {
  await enterDemo(page, 390, 844);
  await page.evaluate(() => localStorage.setItem("renovator-phone-layout", "pocket"));
  await page.reload();
  await expect(page.locator("[data-pocket-shell]")).toBeVisible({ timeout: 15_000 });
  await page.goto("/accounts?view=debts");
  await page.getByRole("button", { name: "New debt" }).click();
  const form = page.locator("[data-debt-form]");
  await form.getByLabel("Person", { exact: true }).fill("Can");
  await form.getByLabel("Amount", { exact: true }).fill("2000");
  await page.locator("[data-pocket-sheet]").getByRole("button", { name: "Save" }).click();
  const detail = page.locator("[data-loan-detail]");
  await expect(detail).toBeVisible();
  await expect(detail.locator("[data-loan-remaining]")).toContainText("2,000.00");
  await detail.getByRole("button", { name: "Record a payment" }).click();
  await page.locator("[data-debt-record]").getByLabel(/^Amount/).fill("500");
  await page.locator("[data-pocket-sheet]").getByRole("button", { name: "Save" }).click();
  await expect(detail.locator("[data-loan-remaining]")).toContainText("1,500.00");
  await page.screenshot({ path: "e2e/screenshots/pocket-debt.png" });
});
