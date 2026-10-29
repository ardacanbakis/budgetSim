import { expect, Page, test } from "@playwright/test";
import { pinRates } from "./support/rates";

// the same rates in every run, offline or in CI (see support/rates.ts)
test.beforeEach(async ({ page }) => {
  await pinRates(page);
});

/**
 * Converted income: a salary paid in dollars that a middleman turns into
 * lira. The income item says where it's converted into; each payday asks
 * what arrived, records it as a conversion, and Reports shows the cut.
 */

const DEMO_KEY = "renovator-demo-v5";

interface Tx {
  id: string;
  accountId: string;
  direction: string;
  amount: number;
  status: string;
  dueDate: string;
  transferGroupId: string | null;
  convertsId?: string | null;
}
interface Store {
  accounts: Array<{ id: string; name: string }>;
  templates: Array<{ id: string; name: string; convertToAccountId?: string | null; convertFrom?: string | null }>;
  transactions: Tx[];
}

const store = (page: Page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}") as Store, DEMO_KEY);

async function enterDemo(page: Page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/welcome");
  await page.getByRole("button", { name: /demo/i }).click();
  await expect(page.getByText(/Net worth|Toplam varlık/).first()).toBeVisible({ timeout: 15_000 });
}

function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const now = new Date();
const first = iso(new Date(now.getFullYear(), now.getMonth(), 1));

/** WBL, $2,090 a month into Wise USD, converted into Ziraat TRY from the 1st of this month; one payday on the 1st. */
async function seedSalary(page: Page, payday: "planned" | "completed") {
  await page.evaluate(
    ({ key, first, payday }) => {
      const s = JSON.parse(localStorage.getItem(key)!);
      const usd = s.accounts.find((a: { name: string }) => a.name === "Wise USD");
      const ziraat = s.accounts.find((a: { name: string }) => a.name === "Ziraat TRY");
      s.templates.push({
        id: "wbl",
        name: "WBL",
        accountId: usd.id,
        direction: "income",
        categoryId: null,
        amount: 2090,
        frequency: "monthly",
        startDate: first,
        endDate: null,
        autoComplete: false,
        loanId: null,
        convertToAccountId: ziraat.id,
        convertFrom: first,
        createdAt: new Date().toISOString(),
      });
      s.transactions.push({
        id: "wbl-1",
        accountId: usd.id,
        direction: "income",
        categoryId: null,
        amount: 2090,
        status: payday,
        dueDate: first,
        completedAt: payday === "completed" ? new Date().toISOString() : null,
        description: "WBL",
        fxSnapshot: null,
        transferGroupId: null,
        transferMarketRate: null,
        recurringTemplateId: "wbl",
        loanId: null,
        victvsPayoutId: null,
        purchaseId: null,
        legacy: false,
        createdAt: new Date().toISOString(),
      });
      localStorage.setItem(key, JSON.stringify(s));
    },
    { key: DEMO_KEY, first, payday }
  );
}

test("an income item converted into another account: set on the form, from today", async ({ page }) => {
  await enterDemo(page);
  await page.goto("/transactions?tab=income");
  const card = page.getByText("VICTVS retainer", { exact: true }).first().locator("xpath=ancestor::div[contains(@class,'p-4')][1]");
  await card.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Converted into").selectOption({ label: "Ziraat TRY (TRY)" });
  await page.getByRole("button", { name: "Save" }).click();
  await expect.poll(async () => (await store(page)).templates.find((t) => t.name === "VICTVS retainer")?.convertFrom).toBe(iso(now));
  const s = await store(page);
  const ziraat = s.accounts.find((a) => a.name === "Ziraat TRY")!;
  expect(s.templates.find((t) => t.name === "VICTVS retainer")!.convertToAccountId).toBe(ziraat.id);
});

test("completing a payday asks what arrived, and records the conversion with it", async ({ page }) => {
  await enterDemo(page);
  await seedSalary(page, "planned");
  await page.goto("/transactions");
  const row = page.locator("li, tr, div").filter({ hasText: /^WBL/ }).getByRole("button", { name: /^Complete$/ }).first();
  await row.click();
  const arrived = page.locator("[data-arrived]");
  await expect(page.getByText("Arrived in Ziraat TRY (TRY)")).toBeVisible();
  // prefilled with what should arrive
  await expect(arrived).not.toHaveValue("");
  await arrived.fill("85000");
  await page.getByRole("button", { name: /^Confirm$/ }).click();

  await expect.poll(async () => (await store(page)).transactions.filter((t) => t.convertsId === "wbl-1").length).toBe(2);
  const s = await store(page);
  expect(s.transactions.find((t) => t.id === "wbl-1")!.status).toBe("completed");
  const legs = s.transactions.filter((t) => t.convertsId === "wbl-1");
  const ziraat = s.accounts.find((a) => a.name === "Ziraat TRY")!;
  expect(legs.find((t) => t.direction === "income")).toMatchObject({ accountId: ziraat.id, amount: 85000 });
  expect(legs.find((t) => t.direction === "expense")).toMatchObject({ amount: 2090 });
  // nothing left waiting
  await page.goto("/");
  await expect(page.locator("[data-pending-conversions]")).toHaveCount(0);
});

test("a payday done elsewhere waits on the dashboard until what arrived is recorded; Reports shows the cut", async ({ page }) => {
  await enterDemo(page);
  await seedSalary(page, "completed");
  await page.goto("/");
  const pending = page.locator("[data-pending-conversions]");
  await expect(pending).toContainText("WBL");
  await pending.getByRole("button", { name: "Record what arrived" }).click();
  const form = page.locator("[data-conversion]");
  await expect(form).toContainText("Paid: $2,090.00");
  // the market's 41.80 a dollar, less 1% to the middleman
  await form.locator("[data-arrived]").fill("86486.20");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(pending).toHaveCount(0);

  await page.goto("/reports?tab=networth");
  await expect(page.locator('[data-middleman="USD>TRY"]')).toContainText(/Middleman's cut \(USD → TRY\) · average [\d.]+% · ₺[\d,.]+ this year/);
});

test("Pocket: the ledger shows a payday waiting for what arrived", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/welcome");
  await page.getByRole("button", { name: /demo/i }).click();
  await expect(page.getByText(/Net worth|Toplam varlık/).first()).toBeVisible({ timeout: 15_000 });
  await seedSalary(page, "completed");
  await page.evaluate(() => localStorage.setItem("renovator-phone-layout", "pocket"));
  await page.goto("/transactions");
  await expect(page.locator("[data-pocket-shell]")).toBeVisible({ timeout: 15_000 });
  const pending = page.locator("[data-pending-conversions]");
  await expect(pending).toContainText("WBL");
  await pending.getByRole("button", { name: "Record what arrived" }).click();
  await expect(page.locator("[data-pocket-sheet] [data-conversion]")).toBeVisible();
  await page.screenshot({ path: "e2e/screenshots/pocket-conversion.png" });
});
