import { expect, Page, test } from "@playwright/test";
import { pinRates } from "./support/rates";

// the same rates in every run, offline or in CI (see support/rates.ts)
test.beforeEach(async ({ page }) => {
  await pinRates(page);
});

/**
 * Income on Transactions: an income with raises is one card with its earlier
 * amounts; "Give a raise" starts the next period; items entered year by year
 * are offered as one.
 */

const DEMO_KEY = "renovator-demo-v5";

interface Store {
  accounts: Array<{ id: string; name: string }>;
  templates: Array<{ id: string; name: string; amount: number; startDate: string; endDate: string | null; series?: string | null }>;
}

const store = (page: Page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}") as Store, DEMO_KEY);

async function enterDemo(page: Page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/welcome");
  await page.getByRole("button", { name: /demo/i }).click();
  await expect(page.getByText(/Net worth|Toplam varlık/).first()).toBeVisible({ timeout: 15_000 });
}

const cardOf = (page: Page, name: string) =>
  page.getByText(name, { exact: true }).first().locator("xpath=ancestor::div[contains(@class,'p-4')][1]");

function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

test("a raise: the old amount ends the day before, the new one starts, and the card shows both", async ({ page }) => {
  await enterDemo(page);
  await page.goto("/transactions?tab=income");
  await cardOf(page, "VICTVS retainer").getByRole("button", { name: "Give a raise" }).click();
  const form = page.locator("[data-raise]");
  await form.getByLabel(/^New amount/).fill("1000");
  await expect(form).toContainText(/\$900\.00 until/);
  await page.getByRole("button", { name: "Save" }).click();

  // until its first date the new amount is what comes next; the card says so
  const card = cardOf(page, "VICTVS retainer");
  await expect(card.locator("[data-income-later]")).toContainText("Then $1,000.00 from");
  await expect(card).toContainText("+$900.00");
  const s = await store(page);
  const periods = s.templates.filter((t) => t.name === "VICTVS retainer").sort((a, b) => a.startDate.localeCompare(b.startDate));
  expect(periods).toHaveLength(2);
  expect(periods[0].endDate).toBeTruthy();
  expect(periods[1]).toMatchObject({ amount: 1000, series: periods[0].id });
  expect(periods[0].series).toBe(periods[0].id);
  // the day after the old one ends
  const next = new Date(`${periods[0].endDate}T12:00:00`);
  next.setDate(next.getDate() + 1);
  expect(periods[1].startDate).toBe(iso(next));
});

test("WBL 2024, 2025 and 2026: offered as one income, combined into one card with its history", async ({ page }) => {
  await enterDemo(page);
  const y = new Date().getFullYear();
  await page.evaluate(
    ({ key, y }) => {
      const s = JSON.parse(localStorage.getItem(key)!);
      const usd = s.accounts.find((a: { name: string }) => a.name === "Wise USD");
      const base = { accountId: usd.id, direction: "income", categoryId: null, frequency: "monthly", autoComplete: false, loanId: null, createdAt: new Date().toISOString() };
      s.templates.push(
        { ...base, id: "wbl-a", name: `WBL ${y - 2}`, amount: 1679, startDate: `${y - 2}-10-05`, endDate: `${y - 2}-12-05` },
        { ...base, id: "wbl-b", name: `WBL ${y - 1}`, amount: 1679, startDate: `${y - 1}-01-05`, endDate: `${y - 1}-12-05` },
        { ...base, id: "wbl-c", name: `WBL ${y}`, amount: 2090, startDate: `${y}-01-05`, endDate: null }
      );
      localStorage.setItem(key, JSON.stringify(s));
    },
    { key: DEMO_KEY, y }
  );
  await page.goto("/transactions?tab=income");
  const offer = page.locator("[data-combine]");
  await expect(offer).toContainText(`WBL ${y - 2}, WBL ${y - 1}, WBL ${y}`);
  await offer.getByRole("button", { name: "Combine" }).click();
  await expect(offer).toHaveCount(0);

  // one card, the current amount, the earlier ones under it
  await expect(page.getByText(`WBL ${y - 1}`, { exact: true })).toHaveCount(0);
  const card = cardOf(page, `WBL ${y}`);
  await expect(card).toContainText("+$2,090.00");
  // two years at the same amount read as one stretch
  await expect(card.locator("[data-income-earlier]")).toHaveText(new RegExp(`^Before: \\$1,679\\.00 ${y - 2}-10-05 – ${y - 1}-12-05$`));
  const s = await store(page);
  expect(s.templates.filter((t) => t.id.startsWith("wbl-")).map((t) => t.series)).toEqual(["wbl-a", "wbl-a", "wbl-a"]);
});

test("Not the same: the offer goes, and stays gone", async ({ page }) => {
  await enterDemo(page);
  await page.evaluate((key) => {
    const s = JSON.parse(localStorage.getItem(key)!);
    const usd = s.accounts.find((a: { name: string }) => a.name === "Wise USD");
    const base = { accountId: usd.id, direction: "income", categoryId: null, frequency: "monthly", autoComplete: false, loanId: null, createdAt: new Date().toISOString() };
    s.templates.push(
      { ...base, id: "x-a", name: "Tutoring 1", amount: 100, startDate: "2025-01-05", endDate: "2025-06-05" },
      { ...base, id: "x-b", name: "Tutoring 2", amount: 120, startDate: "2025-07-05", endDate: null }
    );
    localStorage.setItem(key, JSON.stringify(s));
  }, DEMO_KEY);
  await page.goto("/transactions?tab=income");
  await page.locator("[data-combine]").getByRole("button", { name: "Not the same" }).click();
  await expect(page.locator("[data-combine]")).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("Tutoring 2", { exact: true })).toBeVisible();
  await expect(page.locator("[data-combine]")).toHaveCount(0);
});
