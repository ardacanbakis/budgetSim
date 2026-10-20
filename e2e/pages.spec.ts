import { expect, Page, test } from "@playwright/test";
import { pinRates } from "./support/rates";

// the same rates in every run, offline or in CI (see support/rates.ts)
test.beforeEach(async ({ page }) => {
  await pinRates(page);
});

/**
 * The pages merge (Own · Flow · Plan): Evim sistemi is a tab of Plan. Each
 * old address redirects to where its page lives now, and a page loaded by
 * that redirect (with a query) still switches tabs and can be left and come
 * back to without the old query returning (lib/ui/shallowUrl.ts).
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
