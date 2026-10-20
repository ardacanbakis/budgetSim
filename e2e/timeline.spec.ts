import { expect, Page, test } from "@playwright/test";
import { pinRates } from "./support/rates";

// the same rates in every run, offline or in CI (see support/rates.ts)
test.beforeEach(async ({ page }) => {
  await pinRates(page);
});

/**
 * The Classic Timeline tab (/transactions?tab=timeline): the stream with its
 * Today divider, the side panel, and the Ledger tab's own actions. Runs in
 * the demo at 1280×800.
 */

const DEMO_KEY = "renovator-demo-v5";
const SHOTS = "e2e/screenshots";

interface Store {
  accounts: Array<{ id: string; name: string; paymentDay: number | null }>;
  transactions: Array<{ id: string; description: string; status: string; dueDate: string }>;
}

/** yyyy-mm-dd, local, `days` from today */
function isoFromToday(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function enterDemo(page: Page, edit?: (store: Store) => void) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/welcome");
  await page.getByRole("button", { name: /demo/i }).click();
  await expect(page.getByText(/Net worth|Toplam varlık/)).toBeVisible({ timeout: 15_000 });
  await page.evaluate(() => {
    for (const key of ["renovator-timeline-milestones", "renovator-timeline-legacy"]) localStorage.removeItem(key);
  });
  if (edit) {
    const saved = await store(page);
    edit(saved);
    await page.evaluate(([key, value]) => localStorage.setItem(key, value), [DEMO_KEY, JSON.stringify(saved)] as const);
  }
}

const store = (page: Page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}") as Store, DEMO_KEY);
const tab = (page: Page, name: RegExp) => page.getByRole("tab", { name });
const timelineTab = (page: Page) => tab(page, /^timeline$|^zaman tüneli$/i);
const ledgerTab = (page: Page) => tab(page, /^transactions$|^işlemler$/i);
const today = (page: Page) => page.getByRole("separator", { name: /^(Today|Bugün) · / });

test.describe("Timeline tab", () => {
  test("a tab of Transactions between the ledger and recurring, kept in the URL", async ({ page }) => {
    await enterDemo(page);
    await page.goto("/transactions");
    await expect(page.getByRole("tablist", { name: "Transactions" }).getByRole("tab")).toHaveText([
      "Transactions",
      "Timeline",
      "Recurring",
    ]);
    await timelineTab(page).click();
    await expect(page).toHaveURL(/\/transactions\?tab=timeline$/);
    await expect(timelineTab(page)).toHaveAttribute("aria-selected", "true");
    await expect(today(page)).toBeVisible();

    // loaded with the query, the tabs still switch, and the sidebar lands on the ledger
    await page.goto("/transactions?tab=timeline");
    await expect(timelineTab(page)).toHaveAttribute("aria-selected", "true");
    await ledgerTab(page).click();
    await expect(page).toHaveURL(/\/transactions$/);
    await expect(ledgerTab(page)).toHaveAttribute("aria-selected", "true");
    await timelineTab(page).click();
    await expect(page).toHaveURL(/\/transactions\?tab=timeline$/);
    const sidebar = page.locator("aside nav");
    await sidebar.locator('a[href="/accounts"]').click();
    await expect(page).toHaveURL(/\/accounts$/);
    await sidebar.locator('a[href="/transactions"]').click();
    await expect(page).toHaveURL(/\/transactions$/);
    await expect(ledgerTab(page)).toHaveAttribute("aria-selected", "true");
  });

  test("Today, the Bonus Card statement, the lowest point ahead and the loan's last payment", async ({ page }) => {
    await enterDemo(page);
    await page.goto("/transactions?tab=timeline");
    await expect(today(page)).toBeVisible();
    const bonus = page.locator("[data-statement]").filter({ hasText: "Bonus Card statement" }).first();
    await expect(bonus).toBeVisible();
    await bonus.getByRole("button", { name: /charges?/ }).click();
    await expect(bonus.getByText(/Migros \+ market|iPhone 17/).first()).toBeVisible();
    await expect(page.locator("[data-lowest]").getByRole("button", { name: /Ziraat TRY/ })).toBeVisible();
    await expect(page.locator("[data-next30]")).toContainText(/In[\s\S]*Out[\s\S]*Net/);
    const markers = page.locator("[data-markers]");
    await expect(markers.getByText("Car loan — Garanti: last payment")).toBeVisible();
    await expect(markers.getByText("iPhone 17: last instalment")).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/timeline-desktop.png` });

    // milestones off: gone from the panel, and kept on the device
    await page.getByRole("checkbox", { name: "Milestones" }).uncheck();
    await expect(page.locator("[data-markers]")).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem("renovator-timeline-milestones"))).toBe("off");
  });

  test("✓ Complete marks a planned row done, with the Ledger tab's own form", async ({ page }) => {
    await enterDemo(page);
    await page.goto("/transactions?tab=timeline");
    const dentist = page.locator("[data-event]").filter({ hasText: "Dentist follow-up" }).first();
    await expect(dentist).toBeVisible();
    const id = (await dentist.getAttribute("data-event"))!;
    await dentist.getByRole("button", { name: /^Complete$/ }).click();
    // Classic's modal: a heading and its buttons, no dialog role
    const heading = page.getByRole("heading", { name: "Complete transaction" });
    await expect(heading).toBeVisible();
    await page.getByRole("button", { name: /^Confirm$/ }).click();
    await expect(heading).toHaveCount(0);
    await expect.poll(async () => (await store(page)).transactions.find((t) => t.id === id)?.status).toBe("completed");
  });

  test("a statement due this week has Pay, which opens the card payment form", async ({ page }) => {
    const day = Number(isoFromToday(2).slice(8));
    await enterDemo(page, (s) => {
      s.accounts.find((a) => a.name === "Bonus Card")!.paymentDay = day;
    });
    await page.goto("/transactions?tab=timeline");
    await page.getByRole("button", { name: "Pay Bonus Card" }).first().click();
    await expect(page.getByRole("heading", { name: /Record payment — Bonus Card/ })).toBeVisible();
  });

  test("one account from the link: its chart, and the balance after each row", async ({ page }) => {
    await enterDemo(page);
    const ziraat = (await store(page)).accounts.find((a) => a.name === "Ziraat TRY")!;
    await page.goto(`/transactions?tab=timeline&account=${ziraat.id}`);
    await expect(page.getByRole("img", { name: "Ziraat TRY: balance over time" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("combobox", { name: "Account" })).toHaveValue(ziraat.id);
    await expect(page.locator("[data-event] [title='Balance after']").first()).toHaveText(/^→ −?₺[\d,.]+$/);
    // the lowest-point line toggles the account off again
    await page.locator("[data-lowest]").getByRole("button", { name: /Ziraat TRY/ }).click();
    await expect(page).toHaveURL(/\/transactions\?tab=timeline$/);
    await expect(page.getByRole("img", { name: /balance over time/ })).toHaveCount(0);
  });

  test("Month sums each month up: biggest outflows, statements, markers", async ({ page }) => {
    await enterDemo(page);
    await page.goto("/transactions?tab=timeline");
    await page.getByRole("group", { name: "Show by" }).getByRole("button", { name: "Month" }).click();
    await expect(page.getByRole("heading", { name: "Biggest outflows" }).first()).toBeVisible();
    await expect(today(page)).toBeAttached();
  });

  test("quick jump finds the Timeline", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await enterDemo(page);
    await page.goto("/settings");
    await page.getByRole("button", { name: /^Calm/ }).click();
    await page.goto("/transactions");
    await expect(ledgerTab(page)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Control+k");
    const palette = page.getByRole("dialog", { name: /Quick jump/i });
    await expect(palette).toBeVisible();
    await page.keyboard.type("timeline");
    await expect(palette.getByRole("button", { name: /Timeline/ })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/transactions\?tab=timeline$/);
    await expect(timelineTab(page)).toHaveAttribute("aria-selected", "true");
  });

  test("reads naturally in Turkish", async ({ page }) => {
    await enterDemo(page);
    await page.evaluate(() => localStorage.setItem("renovator-locale", "tr"));
    await page.goto("/transactions?tab=timeline");
    await expect(timelineTab(page)).toHaveAttribute("aria-selected", "true");
    await expect(today(page)).toHaveAccessibleName(/^Bugün · /);
    await expect(page.getByRole("heading", { name: "Önümüzdeki en düşük nokta" })).toBeVisible();
    await expect(page.locator("[data-statement]").filter({ hasText: "Bonus Card ekstresi" }).first()).toBeVisible();
  });
});
