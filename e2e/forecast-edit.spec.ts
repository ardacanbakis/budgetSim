import { expect, Locator, Page, test } from "@playwright/test";
import { pinRates } from "./support/rates";

// the same rates in every run, offline or in CI (see support/rates.ts)
test.beforeEach(async ({ page }) => {
  await pinRates(page);
});

/**
 * Editing the VICTVS forecast by hand: a month's own figure, typed as a bank
 * writes it, shown beside the forecast's and used wherever the forecast is
 * (the Planner's card, the Timeline's expected payouts), kept across a
 * reload (the demo's settings), and reverted. Classic at 1280px, Pocket at
 * 390px with its sheet.
 *
 * The demo has no payouts on record, so its payouts are assumed a month after
 * the work (the test checks the forecast says so): next month's work lands the
 * month after. Months are worked out from the browser's today, so the test
 * holds on any date.
 */

const SHOTS = "e2e/screenshots";

async function enterDemo(page: Page, opts: { pocket?: boolean } = {}) {
  await page.setViewportSize(opts.pocket ? { width: 390, height: 844 } : { width: 1280, height: 900 });
  await page.goto("/welcome");
  await page.getByRole("button", { name: /demo/i }).click();
  await expect(page.getByText(/Net worth|Toplam varlık/).first()).toBeVisible({ timeout: 15_000 });
  await page.evaluate((pocket) => {
    if (pocket) localStorage.setItem("renovator-phone-layout", "pocket");
    else localStorage.removeItem("renovator-phone-layout");
    localStorage.removeItem("renovator-pocket-hide-amounts");
  }, opts.pocket ?? false);
}

/** yyyy-MM, `n` months from this one */
function monthFromNow(n: number): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** "Nov 2026", as the forecast names a month */
const monthName = (key: string) => new Date(`${key}-01T00:00:00`).toLocaleDateString("en-GB", { month: "short", year: "numeric" });

const forecastRow = (scope: Page | Locator, month: string) => scope.locator(`[data-forecast-month="${month}"]`);

test("edit a month on the VICTVS page: your figure everywhere, kept, then reverted", async ({ page }) => {
  const month = monthFromNow(1);
  const lands = monthFromNow(2);
  await enterDemo(page);
  await page.goto("/victvs");
  const forecast = page.locator("[data-victvs-forecast]");
  await expect(forecast).toBeVisible({ timeout: 15_000 });
  await expect(forecast).toContainText("Payouts are assumed a month after the work");
  const row = forecastRow(forecast, month);
  await expect(row).toContainText(/~\$[\d,.]+/);
  const original = (await row.locator("[data-amount]").first().innerText()).trim();
  const originalFigure = original.replace("~", "");
  await expect(row).not.toHaveAttribute("data-edited");

  // typed the Turkish way: 1.250,50 is one thousand two hundred and fifty and a half
  await row.getByRole("button", { name: `Edit ${monthName(month)}` }).click();
  const field = row.getByLabel(`What ${monthName(month)}'s work should earn (USD)`);
  await expect(field).toBeFocused();
  await field.fill("1.250,50");
  await row.getByRole("button", { name: "Save" }).click();

  await expect(row).toHaveAttribute("data-edited", "");
  await expect(row).toContainText("Your figure");
  await expect(row.locator("[data-own-figure]")).toHaveText("$1,250.50");
  await expect(row.locator("[data-auto-figure]")).toHaveText(`forecast ${original}`);
  await expect(forecast).toContainText("Months with your own figure: 1");
  // the money lands a month later
  await expect(forecast).toContainText(`${monthName(lands)} ~$1,250.50`);
  await page.screenshot({ path: `${SHOTS}/forecast-edit-victvs-1280.png`, fullPage: true });

  // the Planner's card is the same forecast
  await page.goto("/planner");
  const plannerRow = forecastRow(page, month);
  await expect(plannerRow).toContainText("Your figure", { timeout: 15_000 });
  await expect(plannerRow.locator("[data-own-figure]")).toHaveText("$1,250.50");

  // and so is the Timeline's expected payout for the month it lands in
  await page.goto("/reports?tab=timeline");
  const payout = page.locator(`[data-expected="victvs:${lands}"]`);
  await expect(payout).toContainText("VICTVS · expected ~$1,251", { timeout: 15_000 });

  // kept across a reload (the demo keeps the settings)
  await page.goto("/victvs");
  await page.reload();
  await expect(forecastRow(page, month).locator("[data-own-figure]")).toHaveText("$1,250.50", { timeout: 15_000 });

  // Revert puts the forecast's own figure back, everywhere
  await forecastRow(page, month).getByRole("button", { name: `Revert ${monthName(month)} to the forecast` }).click();
  await expect(forecastRow(page, month)).not.toHaveAttribute("data-edited");
  await expect(forecastRow(page, month).locator("[data-amount]").first()).toHaveText(original);
  await expect(page.locator("[data-victvs-forecast]")).not.toContainText("Months with your own figure");
  await page.goto("/reports?tab=timeline");
  await expect(page.locator(`[data-expected="victvs:${lands}"]`)).toContainText(`VICTVS · expected ~$${Math.round(Number(originalFigure.replace(/[$,]/g, "")))}`, {
    timeout: 15_000,
  });
});

test("the Planner's card edits too, and Revert all clears every month", async ({ page }) => {
  await enterDemo(page);
  await page.goto("/planner");
  const card = page.locator("[data-victvs-forecast]");
  await expect(card).toBeVisible({ timeout: 15_000 });
  for (const [n, figure] of [
    [1, "900"],
    [2, "0"],
  ] as const) {
    const row = forecastRow(card, monthFromNow(n));
    await row.getByRole("button", { name: `Edit ${monthName(monthFromNow(n))}` }).click();
    await row.getByRole("textbox").fill(figure);
    await row.getByRole("textbox").press("Enter");
    await expect(row).toHaveAttribute("data-edited", "");
  }
  await expect(forecastRow(card, monthFromNow(2)).locator("[data-own-figure]")).toHaveText("$0.00");
  await expect(card).toContainText("Months with your own figure: 2");

  // a figure that isn't an amount isn't saved; Escape leaves the month as it was
  const third = forecastRow(card, monthFromNow(3));
  await third.getByRole("button", { name: `Edit ${monthName(monthFromNow(3))}` }).click();
  await third.getByRole("textbox").fill("lots");
  await third.getByRole("button", { name: "Save" }).click();
  await expect(third).toContainText("Enter an amount of 0 or more.");
  await third.getByRole("textbox").press("Escape");
  await expect(third.getByRole("textbox")).toHaveCount(0);
  await expect(third).not.toHaveAttribute("data-edited");

  await card.getByRole("button", { name: "Revert all" }).click();
  await expect(card.locator("[data-edited]")).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Revert all" })).toHaveCount(0);
  await page.reload();
  await expect(page.locator("[data-victvs-forecast]")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("[data-victvs-forecast] [data-edited]")).toHaveCount(0);
});

test("Pocket: a month's figure in a sheet, at 390px", async ({ page }) => {
  const month = monthFromNow(1);
  await enterDemo(page, { pocket: true });
  await page.goto("/victvs");
  await expect(page.locator("[data-pocket-shell]")).toBeVisible({ timeout: 15_000 });
  const section = page.getByRole("region", { name: "Forecast" });
  const row = forecastRow(section, month);
  await expect(row).toBeVisible({ timeout: 15_000 });
  const original = (await row.locator("[data-amount]").first().innerText()).trim();

  await row.getByRole("button", { name: `Edit ${monthName(month)}` }).click();
  const sheet = page.getByRole("dialog", { name: `${monthName(month)} · your figure` });
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText(`The forecast says ${original}`);
  const field = sheet.getByLabel(`What ${monthName(month)}'s work should earn (USD)`);
  await expect(field).toHaveAttribute("inputmode", "decimal");
  await field.fill("1.250,50");
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet).toHaveCount(0);

  await expect(row).toHaveAttribute("data-edited", "");
  await expect(row.locator("[data-own-figure]")).toHaveText("$1,250.50");
  await expect(row.locator("[data-auto-figure]")).toHaveText(`forecast ${original}`);
  // nothing wider than the phone
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await section.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/forecast-edit-pocket-390.png` });

  // the sheet offers the way back
  await row.getByRole("button", { name: `Edit ${monthName(month)}` }).click();
  await expect(sheet.getByLabel(`What ${monthName(month)}'s work should earn (USD)`)).toHaveValue("1250.50");
  await page.screenshot({ path: `${SHOTS}/forecast-edit-pocket-sheet-390.png` });
  await sheet.getByRole("button", { name: `Revert ${monthName(month)} to the forecast` }).click();
  await expect(sheet).toHaveCount(0);
  await expect(row).not.toHaveAttribute("data-edited");
  await expect(row.locator("[data-amount]").first()).toHaveText(original);
});

test("the dashboard's VICTVS outlook shows your figure, marked edited, without editing", async ({ page }) => {
  const month = monthFromNow(1);
  await enterDemo(page);
  // the outlook card is off until turned on; the figure as the VICTVS page would save it
  await page.evaluate((month) => {
    const store = JSON.parse(localStorage.getItem("renovator-demo-v5") ?? "{}");
    store.settings = {
      ...store.settings,
      victvsForecast: { overrides: { [month]: 900 } },
      dashboardLayout: { order: [], hidden: [], shown: ["victvs-outlook"] },
    };
    localStorage.setItem("renovator-demo-v5", JSON.stringify(store));
  }, month);
  await page.goto("/");
  const row = forecastRow(page.locator("[data-victvs-forecast]"), month);
  await expect(row).toHaveAttribute("data-edited", "", { timeout: 15_000 });
  await expect(row).toContainText("edited");
  await expect(row.locator("[data-own-figure]")).toHaveText("$900.00");
  await expect(row.getByRole("button")).toHaveCount(0);
});
