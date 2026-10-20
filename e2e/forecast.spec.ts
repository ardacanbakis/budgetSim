import { expect, Page, test } from "@playwright/test";
import { pinRates } from "./support/rates";

// the same rates in every run, offline or in CI (see support/rates.ts)
test.beforeEach(async ({ page }) => {
  await pinRates(page);
});

/**
 * The VICTVS forecast where it shows (the VICTVS page in both layouts, the
 * Planner's switch) and the build line at the foot of Settings. The demo has
 * only a couple of months of sessions, so its forecast stands on the recent
 * months rather than earlier years; the seasonal rule is unit-tested in
 * lib/domain/__tests__/victvsForecast.test.ts.
 */

async function enterDemo(page: Page, opts: { pocket?: boolean } = {}) {
  await page.setViewportSize(opts.pocket ? { width: 390, height: 844 } : { width: 1280, height: 900 });
  await page.goto("/welcome");
  await page.getByRole("button", { name: /demo/i }).click();
  await expect(page.getByText(/Net worth|Toplam varlık/).first()).toBeVisible({ timeout: 15_000 });
  if (opts.pocket) await page.evaluate(() => localStorage.setItem("renovator-phone-layout", "pocket"));
}

test("Settings ends with the build it's running", async ({ page }) => {
  await enterDemo(page);
  await page.goto("/settings");
  const build = page.locator("[data-build]");
  await expect(build).toBeVisible({ timeout: 15_000 });
  await expect(build).toContainText("Version:");
  // a local build knows its commit from git
  await expect(build).toContainText(/[0-9a-f]{7}/);
  // on every tab
  await page.getByRole("button", { name: /Data$/ }).click();
  await expect(build).toBeVisible();
});

test("the VICTVS page forecasts the months ahead", async ({ page }) => {
  await enterDemo(page);
  await page.goto("/victvs");
  const forecast = page.locator("[data-victvs-forecast]");
  await expect(forecast).toBeVisible({ timeout: 15_000 });
  await expect(forecast.locator("[data-forecast-month]")).toHaveCount(6);
  const thisMonth = new Date().toLocaleDateString("en-GB", { month: "short", year: "numeric" });
  await expect(forecast.locator("[data-forecast-month]").first()).toContainText(thisMonth);
  // less than a year of history: the recent months stand in
  await expect(forecast).toContainText("Less than a year of history");
  // the demo's unpaid sessions are waiting
  await expect(forecast).toContainText(/worked and waiting to be paid/);
});

test("Pocket's VICTVS shows the forecast under the unpaid total", async ({ page }) => {
  await enterDemo(page, { pocket: true });
  await page.goto("/victvs");
  await expect(page.locator("[data-pocket-shell]")).toBeVisible({ timeout: 15_000 });
  const section = page.getByRole("region", { name: "Forecast" });
  await expect(section).toBeVisible({ timeout: 15_000 });
  // three months on a phone, six on request
  await expect(section.locator("[data-forecast-month]")).toHaveCount(3);
  await section.getByRole("button", { name: "Show 6 months" }).click();
  await expect(section.locator("[data-forecast-month]")).toHaveCount(6);
  // with Hide amounts on, its figures blur like every other
  await expect(section.locator("[data-amount]").first()).toBeAttached();
});

test("the Planner can plan VICTVS from the forecast", async ({ page }) => {
  await enterDemo(page);
  await page.goto("/planner");
  const toggle = page.getByRole("checkbox", { name: /Include the VICTVS forecast/ });
  await expect(toggle).toBeVisible({ timeout: 15_000 });
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await expect(toggle).toBeChecked();
  // kept with the plan
  await page.reload();
  await expect(page.getByRole("checkbox", { name: /Include the VICTVS forecast/ })).toBeChecked({ timeout: 15_000 });
});
