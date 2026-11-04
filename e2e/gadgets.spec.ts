import { expect, Page, test } from "@playwright/test";
import { pinRates } from "./support/rates";

// the same rates in every run, offline or in CI (see support/rates.ts)
test.beforeEach(async ({ page }) => {
  await pinRates(page);
});

/**
 * Gadgets: date timers (a countdown to a moment, or a count since one),
 * stored like any other data, and a converter on the pinned rate table
 * (TRY at 41.8 a dollar).
 */

const DEMO_KEY = "renovator-demo-v5";

interface Store {
  timers?: Array<{ id: string; name: string; kind: string; targetAt: string }>;
}

const store = (page: Page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}") as Store, DEMO_KEY);

async function enterDemo(page: Page, width = 1280, height = 900) {
  await page.setViewportSize({ width, height });
  await page.goto("/welcome");
  await page.getByRole("button", { name: /demo/i }).click();
  await expect(page.getByText(/Net worth|Toplam varlık/).first()).toBeVisible({ timeout: 15_000 });
}

const tile = (page: Page, name: string) => page.locator("[data-timer]").filter({ hasText: name });

test("timers: a countdown is added, turned into a count since, and deleted", async ({ page }) => {
  await enterDemo(page);
  await page.locator("aside nav").getByRole("link", { name: "Gadgets" }).click();
  await expect(page).toHaveURL(/\/gadgets$/);
  await expect(page.getByRole("heading", { name: "Gadgets" })).toBeVisible();

  // the demo comes with one of each
  await expect(tile(page, "New Year")).toContainText("Countdown");
  await expect(tile(page, "Moved to Istanbul")).toContainText("Counting");

  await page.getByRole("button", { name: "+ New timer" }).first().click();
  const dialog = page.locator("[data-modal]");
  // a name and a date are needed
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog.getByText("Give it a name.")).toBeVisible();
  await dialog.getByLabel("Name").fill("Trip to Rome");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog.getByText("Pick a date.")).toBeVisible();
  await dialog.getByLabel("Date").fill("31/12/2030");
  await dialog.getByLabel(/^Time/).fill("18:30");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toHaveCount(0);

  const trip = tile(page, "Trip to Rome");
  await expect(trip).toContainText("Countdown");
  await expect(trip).toContainText("18:30");
  await expect(trip.locator('[data-unit="days"]')).not.toHaveText("0");
  const saved = (await store(page)).timers?.find((t) => t.name === "Trip to Rome");
  expect(saved?.kind).toBe("until");
  expect(new Date(saved!.targetAt).getHours()).toBe(18);

  // the seconds tick
  const seconds = await trip.locator('[data-unit="seconds"]').textContent();
  await expect(trip.locator('[data-unit="seconds"]')).not.toHaveText(seconds!, { timeout: 3_000 });

  // edited into a count since a past date
  await page.getByRole("button", { name: "Edit timer: Trip to Rome" }).click();
  await expect(dialog.getByLabel("Name")).toHaveValue("Trip to Rome");
  await dialog.getByRole("button", { name: "Time since" }).click();
  await dialog.getByLabel("Date").fill("01/01/2020");
  await dialog.getByLabel(/^Time/).fill("");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(trip).toContainText("Counting");
  await expect(trip).toContainText(/That's \d+ y/);
  expect((await store(page)).timers?.find((t) => t.name === "Trip to Rome")?.kind).toBe("since");

  // and deleted, after a confirm
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Edit timer: Trip to Rome" }).click();
  await dialog.getByRole("button", { name: "Delete" }).click();
  await expect(trip).toHaveCount(0);
  expect((await store(page)).timers?.some((t) => t.name === "Trip to Rome")).toBe(false);
});

test("converter: dollars to lira by default, sides switch, and any unit is a click away", async ({ page }) => {
  await enterDemo(page);
  await page.goto("/gadgets");
  const result = page.locator("[data-converter-result]");
  await expect(page.getByRole("combobox", { name: "From" })).toHaveValue("USD");
  await expect(page.getByRole("combobox", { name: "To" })).toHaveValue("TRY");
  await expect(result).toHaveText("4,180.00");
  await expect(page.locator("[data-converter-rate]")).toHaveText("1 USD = 41.8 TRY");

  // typed the Turkish way
  await page.getByLabel("Amount").fill("1.250,50");
  await expect(result).toHaveText("52,270.90");

  await page.getByRole("button", { name: "Switch sides" }).click();
  await expect(page.getByRole("combobox", { name: "From" })).toHaveValue("TRY");
  await expect(page.getByRole("combobox", { name: "To" })).toHaveValue("USD");
  await expect(result).toHaveText("29.92");

  // the list shows the amount in every other unit; a row becomes the "to" side
  await page.getByRole("button", { name: /^EUR · Euro/ }).click();
  await expect(page.getByRole("combobox", { name: "To" })).toHaveValue("EUR");
  await expect(result).toHaveText("27.45");

  await page.getByLabel("Amount").fill("abc");
  await expect(page.getByText("Not an amount this can read.")).toBeVisible();
  await expect(result).toHaveText("—");
});

test("converter: coins the gold feed priced are offered, at their own price", async ({ page }) => {
  // gram at 3281 TRY; a çeyrek at 5270
  await pinRates(page, { goldTry: { gram: 3281.4, ceyrek: 5270 } });
  await enterDemo(page);
  await page.goto("/gadgets");
  await page.getByLabel("Amount").fill("2");
  await page.getByRole("combobox", { name: "From" }).selectOption("gold:ceyrek");
  await expect(page.locator("[data-converter-result]")).toHaveText("10,540.00");
  // a coin the feed didn't price isn't offered
  await expect(page.getByRole("combobox", { name: "From" }).locator('option[value="gold:tam"]')).toHaveCount(0);
});

test("Pocket: Gadgets is under More", async ({ page }) => {
  await enterDemo(page, 390, 844);
  await page.evaluate(() => localStorage.setItem("renovator-phone-layout", "pocket"));
  await page.reload();
  await expect(page.locator("[data-pocket-shell]")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("link", { name: "Gadgets" }).click();
  await expect(page).toHaveURL(/\/gadgets$/);
  await expect(tile(page, "New Year")).toBeVisible();
  await expect(page.locator("[data-converter-result]")).toHaveText("4,180.00");
});
