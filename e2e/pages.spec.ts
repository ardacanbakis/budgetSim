import { expect, Page, test } from "@playwright/test";
import { pinRates } from "./support/rates";

// the same rates in every run, offline or in CI (see support/rates.ts)
test.beforeEach(async ({ page }) => {
  await pinRates(page);
});

/**
 * The pages merge (Own · Flow · Plan): Evim sistemi and the loan simulator
 * are tabs of Plan, and Debt is the Portfolio's Debts view. Each old address
 * redirects to where its page lives now, and a page loaded by that redirect
 * (with a query) still switches tabs and can be left and come back to
 * without the old query returning (lib/ui/shallowUrl.ts).
 */

async function enterDemo(page: Page, width = 1280, height = 800) {
  await page.setViewportSize({ width, height });
  await page.goto("/welcome");
  await page.getByRole("button", { name: /demo/i }).click();
  await expect(page.getByText(/Net worth|Toplam varlık/).first()).toBeVisible({ timeout: 15_000 });
}

async function enterPocket(page: Page) {
  await enterDemo(page, 390, 844);
  await page.evaluate(() => localStorage.setItem("renovator-phone-layout", "pocket"));
  await page.reload();
  await expect(page.locator("[data-pocket-shell]")).toBeVisible({ timeout: 15_000 });
}

const tab = (page: Page, name: RegExp) => page.getByRole("tab", { name });
const FORECAST = /^forecast$|^tahmin$/i;
const EVIM = /^evim sistemi$/i;
const LOAN = /^loan simulator$|^kredi simülatörü$/i;
const CAR_LOAN = "Car loan — Garanti";
/** Classic Portfolio's view buttons */
const viewButton = (page: Page, name: string) => page.getByRole("group", { name: "Show" }).getByRole("button", { name, exact: true });

test.describe("Plan", () => {
  test("Evim sistemi is a tab of Plan, and the old address still lands there", async ({ page }) => {
    await enterDemo(page);
    const sidebar = page.locator("aside nav");

    // gone from the sidebar, which calls the Planner Plan now
    await expect(sidebar.locator('a[href="/savings"]')).toHaveCount(0);
    await expect(sidebar.locator('a[href="/planner"]')).toHaveText(/Plan/);

    await page.goto("/planner");
    await expect(page.getByRole("heading", { name: /^plan$/i })).toBeVisible();
    await expect(tab(page, FORECAST)).toHaveAttribute("aria-selected", "true");
    await tab(page, EVIM).click();
    await expect(page).toHaveURL(/\/planner\?tab=evim$/);
    await expect(tab(page, EVIM)).toHaveAttribute("aria-selected", "true");
    await expect(page.getByLabel("Scenario name")).toBeVisible();

    // a bookmark to the old page redirects to the tab
    await page.goto("/savings");
    await expect(page).toHaveURL(/\/planner\?tab=evim$/);
    await expect(page.getByLabel("Scenario name")).toBeVisible();

    // and from there the tabs still switch
    await tab(page, FORECAST).click();
    await expect(page).toHaveURL(/\/planner$/);
    await expect(tab(page, FORECAST)).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("button", { name: /new scenario/i })).toBeVisible();
    await tab(page, EVIM).click();
    await expect(page).toHaveURL(/\/planner\?tab=evim$/);
    await expect(tab(page, EVIM)).toHaveAttribute("aria-selected", "true");

    // nor does the old query come back by the sidebar, here or from another page
    await page.goto("/savings");
    await expect(tab(page, EVIM)).toHaveAttribute("aria-selected", "true");
    await sidebar.locator('a[href="/planner"]').click();
    await expect(page).toHaveURL(/\/planner$/);
    await expect(tab(page, FORECAST)).toHaveAttribute("aria-selected", "true");
    await page.goto("/savings");
    await sidebar.locator('a[href="/accounts"]').click();
    await expect(page).toHaveURL(/\/accounts$/);
    await sidebar.locator('a[href="/planner"]').click();
    await expect(page).toHaveURL(/\/planner$/);
    await expect(tab(page, FORECAST)).toHaveAttribute("aria-selected", "true");
  });

  test("the forecast's Evim sistemi card opens the tab, and the quick jump finds it", async ({ page }) => {
    await enterDemo(page);
    await page.goto("/planner");
    await page.getByRole("link", { name: /Open Evim sistemi/ }).first().click();
    await expect(page).toHaveURL(/\/planner\?tab=evim$/);
    await expect(tab(page, EVIM)).toHaveAttribute("aria-selected", "true");

    await page.goto("/transactions");
    await expect(page.getByRole("tab", { name: /^transactions$/i })).toBeVisible();
    await page.keyboard.press("Control+k");
    const palette = page.getByRole("dialog", { name: /Quick jump/i });
    await page.keyboard.type("evim");
    await palette.getByRole("button", { name: /Evim sistemi/ }).click();
    await expect(page).toHaveURL(/\/planner\?tab=evim$/);
    await expect(tab(page, EVIM)).toHaveAttribute("aria-selected", "true");
  });

  test("in Pocket the tabs switch on a phone, and the old address lands on Evim", async ({ page }) => {
    await enterPocket(page);
    await page.goto("/planner");
    await expect(tab(page, FORECAST)).toHaveAttribute("aria-selected", "true");
    // the strip fits the screen without pushing the page sideways
    const wide = await page.evaluate(() => document.scrollingElement!.scrollWidth - document.documentElement.clientWidth);
    expect(wide).toBeLessThanOrEqual(0);
    await tab(page, EVIM).click();
    await expect(page).toHaveURL(/\/planner\?tab=evim$/);
    await expect(page.getByLabel("Scenario name")).toBeVisible();
    await page.screenshot({ path: "e2e/screenshots/pages-plan-evim-pocket.png" });

    await page.goto("/savings");
    await expect(page).toHaveURL(/\/planner\?tab=evim$/);
    await expect(tab(page, EVIM)).toHaveAttribute("aria-selected", "true");
    await tab(page, FORECAST).click();
    await expect(page).toHaveURL(/\/planner$/);
    await expect(tab(page, FORECAST)).toHaveAttribute("aria-selected", "true");
  });
});

test.describe("Debt split", () => {
  test("Debt is the Portfolio's Debts view, and the old address still lands there", async ({ page }) => {
    await enterDemo(page);
    const sidebar = page.locator("aside nav");
    await expect(sidebar.locator('a[href="/loans"]')).toHaveCount(0);

    // a bookmark to the old page opens the Debts view
    await page.goto("/loans");
    await expect(page).toHaveURL(/\/accounts\?view=debts$/);
    await expect(viewButton(page, "Debts")).toHaveAttribute("aria-pressed", "true");
    const summary = page.locator("[data-debt-summary]");
    await expect(summary.getByText(/Total debt/)).toBeVisible();
    await expect(summary.getByText("Attack first (highest rate)")).toBeVisible();
    // what each card owes (a link to the Cards page) and the tracked loans; no cash or gold
    await expect(page.locator("[data-debt-row]").filter({ hasText: CAR_LOAN })).toBeVisible();
    await expect(page.getByRole("button", { name: /Ziraat TRY/ })).toHaveCount(0);
    await page.screenshot({ path: "e2e/screenshots/pages-portfolio-debts.png" });

    // a loan opens in the pane, by its own address
    await page.locator("[data-debt-row]").filter({ hasText: CAR_LOAN }).click();
    await expect(page).toHaveURL(/\/accounts\?view=debts&loan=[^&]+$/);
    const pane = page.locator("[data-loan-pane]");
    await expect(pane.getByText(/Paid \d+ of 36 installments/)).toBeVisible();
    await expect(pane.locator("tbody tr")).toHaveCount(36);
    await expect(pane.locator("tbody tr[data-paid]").first()).toBeVisible();
    await page.screenshot({ path: "e2e/screenshots/pages-portfolio-loan.png" });
    const loanUrl = page.url();
    await page.goto("/");
    await page.goto(loanUrl);
    await expect(page.locator("[data-loan-pane]")).toBeVisible();

    // the views switch in place
    await viewButton(page, "Assets").click();
    await expect(page).toHaveURL(/\/accounts\?view=assets$/);
    await expect(page.locator("[data-debt-row]")).toHaveCount(0);
    await viewButton(page, "All").click();
    await expect(page).toHaveURL(/\/accounts$/);
    await expect(page.locator("[data-debt-row]").filter({ hasText: CAR_LOAN })).toBeVisible();
    await expect(page.getByRole("button", { name: /Ziraat TRY/ }).first()).toBeVisible();

    // nor does the old query come back by the sidebar, here or from another page
    await page.goto("/loans");
    await expect(viewButton(page, "Debts")).toHaveAttribute("aria-pressed", "true");
    await sidebar.locator('a[href="/accounts"]').click();
    await expect(page).toHaveURL(/\/accounts$/);
    await expect(viewButton(page, "All")).toHaveAttribute("aria-pressed", "true");
    await page.goto("/loans");
    await sidebar.locator('a[href="/transactions"]').click();
    await expect(page).toHaveURL(/\/transactions$/);
    await sidebar.locator('a[href="/accounts"]').click();
    await expect(page).toHaveURL(/\/accounts$/);
    await expect(viewButton(page, "All")).toHaveAttribute("aria-pressed", "true");
  });

  test("the loan simulator is a tab of Plan, and a loan tracked there opens in Debts", async ({ page }) => {
    await enterDemo(page, 1400, 1000);
    await page.goto("/planner");
    await tab(page, LOAN).click();
    await expect(page).toHaveURL(/\/planner\?tab=loan$/);
    await expect(tab(page, LOAN)).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText("Tracked loans", { exact: true })).toBeVisible();
    await page.screenshot({ path: "e2e/screenshots/pages-plan-loan.png" });

    await page.getByRole("button", { name: "Track this loan" }).click();
    await page.getByLabel("Name").fill("Flat loan");
    await page.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Now tracking Flat loan." })).toBeVisible();
    await page.getByRole("link", { name: "See it in Portfolio → Debts" }).click();
    await expect(page).toHaveURL(/\/accounts\?view=debts&loan=[^&]+$/);
    // the pane's title (its rows and changes name it too)
    await expect(page.locator("[data-loan-pane]").getByText("Flat loan").first()).toBeVisible();

    // and the Debts view leads back to the simulator
    await page.getByRole("link", { name: /Loan simulator/ }).click();
    await expect(page).toHaveURL(/\/planner\?tab=loan$/);
    await expect(tab(page, LOAN)).toHaveAttribute("aria-selected", "true");

    // the quick jump finds both
    await page.keyboard.press("Control+k");
    const palette = page.getByRole("dialog", { name: /Quick jump/i });
    await page.keyboard.type("debts");
    await palette.getByRole("button", { name: /^Debts/ }).click();
    await expect(page).toHaveURL(/\/accounts\?view=debts$/);
  });

  test("a loan's recurring item links to the loan", async ({ page }) => {
    await enterDemo(page);
    await page.goto("/transactions?tab=recurring");
    await page.getByRole("link", { name: /Linked to loan/ }).first().click();
    await expect(page).toHaveURL(/\/accounts\?view=debts&loan=[^&]+$/);
    await expect(page.locator("[data-loan-pane]").getByText(CAR_LOAN).first()).toBeVisible();
  });

  test("in Pocket, /loans opens the Debts segment without changing the device's choice, and a loan has a page", async ({ page }) => {
    await enterPocket(page);
    await page.evaluate(() => localStorage.setItem("renovator-pocket-portfolio-seg", "assets"));
    const radios = page.getByRole("radiogroup", { name: "Show" });

    await page.goto("/loans");
    await expect(page).toHaveURL(/\/accounts\?view=debts$/);
    await expect(radios.getByRole("radio", { name: "Debts" })).toHaveAttribute("aria-checked", "true");
    expect(await page.evaluate(() => localStorage.getItem("renovator-pocket-portfolio-seg"))).toBe("assets");

    // a loan row opens its page; Back returns to the list
    await page.locator("[data-portfolio-section='loans']").getByText(CAR_LOAN).click();
    await expect(page).toHaveURL(/\/accounts\?view=debts&loan=[^&]+$/);
    const detail = page.locator("[data-loan-detail]");
    await expect(detail).toBeVisible();
    await expect(detail.getByText(/Paid \d+ of 36 installments/)).toBeVisible();
    await expect(detail.locator("[data-loan-upcoming] li").first()).toBeVisible();
    await detail.getByRole("button", { name: "Payment schedule" }).click();
    await expect(detail.locator("[data-loan-schedule] li")).toHaveCount(36);
    await page.screenshot({ path: "e2e/screenshots/pages-pocket-loan.png", fullPage: true });
    const loanUrl = page.url();
    await page.goBack();
    await expect(page).toHaveURL(/\/accounts\?view=debts$/);
    await expect(radios.getByRole("radio", { name: "Debts" })).toHaveAttribute("aria-checked", "true");

    // without a view in the URL, the device's choice holds
    await page.goto("/accounts");
    await expect(radios.getByRole("radio", { name: "Assets" })).toHaveAttribute("aria-checked", "true");

    // opened by its link, the header's back closes to the Debts list
    await page.goto(loanUrl);
    await expect(page.locator("[data-loan-detail]")).toBeVisible();
    await page.locator("[data-pocket-header]").getByRole("button", { name: /back|geri/i }).click();
    await expect(page).toHaveURL(/\/accounts\?view=debts$/);
    await expect(radios.getByRole("radio", { name: "Debts" })).toHaveAttribute("aria-checked", "true");

    // a choice made with a view in the URL is the device's, and the URL follows
    await radios.getByRole("radio", { name: "All" }).click();
    await expect(page).toHaveURL(/\/accounts$/);
    expect(await page.evaluate(() => localStorage.getItem("renovator-pocket-portfolio-seg"))).toBe("all");
    await page.screenshot({ path: "e2e/screenshots/pages-pocket-portfolio.png" });
  });

  test("in Pocket, the loan simulator tab works on a phone", async ({ page }) => {
    await enterPocket(page);
    await page.goto("/planner?tab=loan");
    await expect(tab(page, LOAN)).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText("Total payback")).toBeVisible();
    const wide = await page.evaluate(() => document.scrollingElement!.scrollWidth - document.documentElement.clientWidth);
    expect(wide).toBeLessThanOrEqual(0);
    await page.screenshot({ path: "e2e/screenshots/pages-plan-loan-pocket.png" });
    await page.locator("main").getByRole("link", { name: CAR_LOAN }).click();
    await expect(page).toHaveURL(/\/accounts\?view=debts&loan=[^&]+$/);
    await expect(page.locator("[data-loan-detail]")).toBeVisible();
  });
});
