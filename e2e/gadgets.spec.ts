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

/** one card of the page: timers, history, converter, alerts or inflation */
const gadget = (page: Page, name: string) => page.locator(`[data-gadget="${name}"]`);

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

test("timers: each can show its total in one unit, remembered on this device", async ({ page }) => {
  await enterDemo(page);
  await page.goto("/gadgets");
  const moved = tile(page, "Moved to Istanbul");
  const showAs = page.getByRole("combobox", { name: "Show as: Moved to Istanbul" });
  await expect(showAs).toHaveValue("parts");
  const days = Number((await moved.locator('[data-unit="days"]').textContent())!.replace(/,/g, ""));

  await showAs.selectOption("hours");
  const hours = moved.locator('[data-total="hours"]');
  await expect(hours).toHaveText(/^[\d,]+\.\d\d$/);
  expect(Math.floor(Number((await hours.textContent())!.replace(/,/g, "")) / 24)).toBe(days);
  await expect(moved.locator('[data-unit="days"]')).toHaveCount(0);

  await showAs.selectOption("seconds");
  const seconds = moved.locator('[data-total="seconds"]');
  const first = await seconds.textContent();
  expect(first).toMatch(/^[\d,]+$/);
  // still ticking
  await expect(seconds).not.toHaveText(first!, { timeout: 3_000 });

  // the other timer keeps its own choice, and this one survives a reload
  await expect(page.getByRole("combobox", { name: "Show as: New Year" })).toHaveValue("parts");
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Show as: Moved to Istanbul" })).toHaveValue("seconds");
  await expect(tile(page, "Moved to Istanbul").locator('[data-total="seconds"]')).toBeVisible();
});

test("converter: dollars to lira by default, sides switch, and any unit is a click away", async ({ page }) => {
  await enterDemo(page);
  await page.goto("/gadgets");
  const result = page.locator("[data-converter-result]");
  await expect(gadget(page, "converter").getByRole("combobox", { name: "From", exact: true })).toHaveValue("USD");
  await expect(gadget(page, "converter").getByRole("combobox", { name: "To", exact: true })).toHaveValue("TRY");
  await expect(result).toHaveText("4,180.00");
  await expect(page.locator("[data-converter-rate]")).toHaveText("1 USD = 41.8 TRY");

  // typed the Turkish way
  await gadget(page, "converter").getByLabel("Amount", { exact: true }).fill("1.250,50");
  await expect(result).toHaveText("52,270.90");

  await gadget(page, "converter").getByRole("button", { name: "Switch sides" }).click();
  await expect(gadget(page, "converter").getByRole("combobox", { name: "From", exact: true })).toHaveValue("TRY");
  await expect(gadget(page, "converter").getByRole("combobox", { name: "To", exact: true })).toHaveValue("USD");
  await expect(result).toHaveText("29.92");

  // the list shows the amount in every other unit; a row becomes the "to" side
  await gadget(page, "converter").getByRole("button", { name: /^EUR · Euro/ }).click();
  await expect(gadget(page, "converter").getByRole("combobox", { name: "To", exact: true })).toHaveValue("EUR");
  await expect(result).toHaveText("27.45");

  await gadget(page, "converter").getByLabel("Amount", { exact: true }).fill("abc");
  await expect(gadget(page, "converter").getByText("Not an amount this can read.")).toBeVisible();
  await expect(result).toHaveText("—");
});

test("converter: coins the gold feed priced are offered, at their own price", async ({ page }) => {
  // gram at 3281 TRY; a çeyrek at 5270
  await pinRates(page, { goldTry: { gram: 3281.4, ceyrek: 5270 } });
  await enterDemo(page);
  await page.goto("/gadgets");
  await gadget(page, "converter").getByLabel("Amount", { exact: true }).fill("2");
  await gadget(page, "converter").getByRole("combobox", { name: "From", exact: true }).selectOption("gold:ceyrek");
  await expect(page.locator("[data-converter-result]")).toHaveText("10,540.00");
  // a coin the feed didn't price isn't offered
  await expect(gadget(page, "converter").getByRole("combobox", { name: "From", exact: true }).locator('option[value="gold:tam"]')).toHaveCount(0);
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

/** The pinned table, but from "live" sources: the app holds alerts (and auto-complete) back on fallback rates. */
const LIVE = { sources: { USD: "identity", TRY: "frankfurter", EUR: "frankfurter", BTC: "coingecko", XAU_G: "truncgil" } };

test("pinned conversions: the demo's is live and loads into the converter; new ones pin and unpin", async ({ page }) => {
  await enterDemo(page);
  await page.goto("/gadgets");
  const pins = page.locator("[data-pin]");
  // 100 EUR at 1.09 USD, 41.8 TRY a dollar
  await expect(pins.filter({ hasText: "100.00 EUR" })).toContainText("4,556.20 TRY");
  await page.getByRole("button", { name: "Open 100.00 EUR → TRY in the converter" }).click();
  await expect(gadget(page, "converter").getByRole("combobox", { name: "From", exact: true })).toHaveValue("EUR");
  await expect(gadget(page, "converter").getByLabel("Amount", { exact: true })).toHaveValue("100");
  await expect(page.locator("[data-converter-result]")).toHaveText("4,556.20");
  // already pinned
  await expect(page.getByRole("button", { name: /Pin this conversion/ })).toBeDisabled();

  await gadget(page, "converter").getByLabel("Amount", { exact: true }).fill("50");
  await gadget(page, "converter").getByRole("combobox", { name: "From", exact: true }).selectOption("USD");
  await page.getByRole("button", { name: /Pin this conversion/ }).click();
  await expect(pins.filter({ hasText: "50.00 USD" })).toContainText("2,090.00 TRY");
  await expect(page.getByRole("button", { name: /Pin this conversion/ })).toBeDisabled();
  await page.reload();
  await expect(pins.filter({ hasText: "50.00 USD" })).toBeVisible();
  await page.getByRole("button", { name: "Unpin 50.00 USD → TRY" }).click();
  await expect(pins.filter({ hasText: "50.00 USD" })).toHaveCount(0);
});

test("rate alerts: one that's met fires once, shows a banner, and can be re-armed", async ({ page }) => {
  await pinRates(page, LIVE);
  await enterDemo(page);
  await page.goto("/gadgets");
  const alerts = page.locator("[data-alert]");
  // the demo's is still waiting: 41.8 against 45
  const waiting = alerts.filter({ hasText: "1 USD above 45 TRY" });
  await expect(waiting).toContainText("Waiting");
  await expect(waiting).toContainText("Now 41.8 · 7.66% to go");
  await expect(page.locator("[data-alert-banner]")).toHaveCount(0);

  const form = page.locator("[data-alert-form]");
  await form.getByRole("button", { name: "Add alert" }).click();
  await expect(form.getByText("Enter a rate above 0.")).toBeVisible();
  await form.getByLabel(/^Rate/).fill("40");
  await form.getByRole("button", { name: "Add alert" }).click();

  const hit = alerts.filter({ hasText: "1 USD above 40 TRY" });
  await expect(hit).toContainText("Hit");
  await expect(hit).toContainText(/Hit .* at 41\.8/);
  const banner = page.locator("[data-alert-banner]");
  await expect(banner).toContainText("USD → TRY went above 40: now 41.8");
  // the banner follows you around the app
  await page.goto("/accounts");
  await expect(banner).toBeVisible();
  await banner.getByRole("button", { name: "Dismiss" }).click();
  await expect(banner).toHaveCount(0);
  await page.reload();
  await expect(page.locator("[data-alert-banner]")).toHaveCount(0);

  // re-armed, it fires again on rates that still meet it
  await page.goto("/gadgets");
  await hit.getByRole("button", { name: "Re-arm" }).click();
  await expect(page.locator("[data-alert-banner]")).toBeVisible();
  await page.getByRole("button", { name: "Delete alert: 1 USD above 40 TRY" }).click();
  await expect(hit).toHaveCount(0);
  await expect(page.locator("[data-alert-banner]")).toHaveCount(0);
});

test("rate alerts never fire on the fallback rates", async ({ page }) => {
  await enterDemo(page);
  await page.goto("/gadgets");
  const form = page.locator("[data-alert-form]");
  await form.getByLabel(/^Rate/).fill("40");
  await form.getByRole("button", { name: "Add alert" }).click();
  await expect(page.locator("[data-alert]").filter({ hasText: "1 USD above 40 TRY" })).toContainText("Waiting");
  await expect(page.locator("[data-alert-banner]")).toHaveCount(0);
});

test("rate history: a pair over a range, and an amount on a past date against today", async ({ page }) => {
  const asked: string[] = [];
  await page.route("**/api/rate-history**", (route) => {
    const url = new URL(route.request().url());
    asked.push(url.search);
    if (url.searchParams.has("devaluation")) return route.fulfill({ json: { fetchedAt: new Date().toISOString(), points: [] } });
    if (url.searchParams.get("on")) {
      return route.fulfill({ json: { date: "2025-03-14", usdPer: { USD: 1, TRY: 1 / 36.6, EUR: 1.09 } } });
    }
    return route.fulfill({
      json: {
        fetchedAt: new Date().toISOString(),
        series: {
          TRY: [
            ["2026-08-03", 1 / 40],
            ["2026-09-01", 1 / 39],
            ["2026-10-01", 1 / 41.8],
          ],
          EUR: [
            ["2026-08-03", 1.1],
            ["2026-10-01", 1.09],
          ],
        },
      },
    });
  });
  await enterDemo(page);
  await page.goto("/gadgets");
  await expect(page.locator("[data-history-last]")).toHaveText("41.8 TRY");
  await expect(page.locator("[data-history-change]")).toContainText("+4.5% over the range");
  await expect(page.getByText(/^Low 39 ·/)).toBeVisible();
  expect(asked).toContain("?days=90");

  await page.getByRole("group", { name: "Range" }).getByRole("button", { name: "1Y" }).click();
  await expect.poll(() => asked).toContain("?days=365");

  // bitcoin's source answered nothing
  await gadget(page, "history").getByRole("combobox", { name: "From", exact: true }).selectOption("BTC");
  await expect(page.getByText("No history for this pair right now")).toBeVisible();
  await gadget(page, "history").getByRole("combobox", { name: "From", exact: true }).selectOption("USD");

  // $1,000 on a Sunday: the ECB's Friday rate
  await gadget(page, "history").getByLabel("Date", { exact: true }).fill("16/03/2025");
  const onDate = page.locator("[data-on-date]");
  await expect(onDate).toContainText("= 36,600.00 TRY");
  await expect(onDate).toContainText("Today = 41,800.00 TRY");
  await expect(onDate).toContainText("+14.21% since");
  await expect(onDate).toContainText("Rates of");
  expect(asked).toContain("?on=2025-03-16");
});

test("inflation: an amount from a year before the index's last month, and a month past its end", async ({ page }) => {
  await enterDemo(page);
  await page.goto("/gadgets");
  const result = page.locator("[data-inflation]");
  // TÜİK index: June 2025 2942.6, June 2026 3790
  await expect(result).toContainText("₺12,879.77");
  await expect(result).toContainText("Prices +28.8% between the two");
  await expect(page.getByText("Latest month in the index: June 2026.")).toBeVisible();

  await page.getByLabel("Is worth, in").fill("2026-11");
  await expect(page.getByText(/The index runs January 2024 to June 2026/)).toBeVisible();
  await expect(result).toContainText("₺12,879.77");
});

test("sidebar: Settings sits beside Log out, and the name can lead to the Dashboard instead", async ({ page }) => {
  await enterDemo(page);
  const aside = page.locator("aside[data-sidebar]");
  await expect(aside.locator('nav a[href="/settings"]')).toHaveCount(0);
  await expect(aside.locator('[data-sidebar-footer] a[href="/settings"]')).toBeVisible();
  await expect(aside.locator("[data-sidebar-footer]")).toContainText("Log out");
  // the name goes to the welcome page, as it always has
  await expect(aside.getByRole("link", { name: "BudgetSim" })).toHaveAttribute("href", "/welcome");

  await aside.locator('[data-sidebar-footer] a[href="/settings"]').click();
  await expect(page).toHaveURL(/\/settings/);
  await page.goto("/settings?tab=preferences");
  const brand = page.locator("[data-brand-nav]");
  const hide = brand.getByRole("checkbox", { name: /Hide Dashboard/ });
  await expect(hide).toBeDisabled();
  await brand.getByRole("button", { name: "Dashboard" }).click();
  await expect(aside.getByRole("link", { name: "BudgetSim" })).toHaveAttribute("href", "/");
  await hide.check();
  await expect(aside.locator('nav a[href="/"]')).toHaveCount(0);

  // the name is the way there now; the number keys start at the next page
  await page.reload();
  await expect(aside.locator('nav a[href="/"]')).toHaveCount(0);
  await aside.getByRole("link", { name: "BudgetSim" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.keyboard.press("1");
  await expect(page).toHaveURL(/\/accounts$/);

  // back to the welcome page brings the Dashboard back with it
  await page.goto("/settings?tab=preferences");
  await brand.getByRole("button", { name: "Welcome page" }).click();
  await expect(aside.locator('nav a[href="/"]')).toHaveCount(1);
});

test("phone: the name goes to the Dashboard, which leaves the bar, by default", async ({ page }) => {
  await enterDemo(page, 390, 844);
  const bar = page.locator("nav.fixed.inset-x-0.bottom-0");
  await expect(bar.locator('a[href="/"]')).toHaveCount(0);
  await page.goto("/accounts");
  await page.locator("header").getByRole("link", { name: "BudgetSim" }).click();
  await expect(page).toHaveURL(/\/$/);
  // Settings is still in More on a phone
  await bar.getByRole("button", { name: /more/i }).click();
  await expect(page.locator('a[href="/settings"]').last()).toBeVisible();
});

/** USD/TRY now and 1, 3 and 5 years back (no 2 or 4): 40, 32, 20 and 10 lira a dollar. */
async function pinLiraHistory(page: Page) {
  await page.route("**/api/rate-history?devaluation=1", (route) =>
    route.fulfill({
      json: {
        fetchedAt: new Date().toISOString(),
        points: [
          { yearsAgo: 0, date: "2026-11-04", tryPerUsd: 40 },
          { yearsAgo: 1, date: "2025-11-04", tryPerUsd: 32 },
          { yearsAgo: 3, date: "2023-11-03", tryPerUsd: 20 },
          { yearsAgo: 5, date: "2021-11-04", tryPerUsd: 10 },
        ],
      },
    })
  );
}

test("lira devaluation in Rate history: real averages over 1, 3 and 5 years, and where the pace leads", async ({ page }) => {
  await pinLiraHistory(page);
  await enterDemo(page);
  await page.goto("/gadgets");
  const section = page.locator("[data-lira-devaluation]");
  // 32 → 40 in a year: the lira kept 80%
  await expect(section.locator('[data-deval-window="1"]')).toContainText("−20% a year");
  await expect(section.locator('[data-deval-window="1"]')).toContainText("32 → 40");
  // 20 → 40 in three: 1 − ∛0.5; 10 → 40 in five: 1 − ⁵√0.25
  await expect(section.locator('[data-deval-window="3"]')).toContainText("−20.6% a year");
  await expect(section.locator('[data-deval-window="5"]')).toContainText("−24.2% a year");

  // the three-year pace by default: 40 / 0.7937ⁿ
  await expect(section.locator('[data-deval-window="3"]')).toHaveAttribute("aria-pressed", "true");
  const projection = section.locator("[data-deval-projection] li");
  await expect(projection.nth(0)).toContainText("50.4");
  await expect(projection.nth(1)).toContainText("80");
  await section.locator('[data-deval-window="1"]').click();
  await expect(projection.nth(0)).toContainText("50");
  await expect(projection.nth(2)).toContainText("122.07");

  // year by year: only the one year both ends of which came back
  await section.getByText("Year by year").click();
  await expect(section.getByText("2025 → 2026 · 32 → 40")).toBeVisible();
});

test("the Plan's devaluation starts from the lira's real average, and any window is a click away", async ({ page }) => {
  await pinLiraHistory(page);
  await enterDemo(page);
  await page.goto("/planner");
  await page.getByText("Model a steadily weakening lira").click();

  // the default 25% gives way to the real three-year average
  const real = page.locator("[data-deval-real]");
  await expect(page.getByRole("slider", { name: "Devaluation per year" })).toHaveValue("21");
  await expect(real.getByRole("button", { name: /last 3 years: −21% a year/ })).toHaveAttribute("aria-pressed", "true");
  await expect(real.locator("[data-deval-basis]")).toHaveText("The lira's real average over the last 3 years (20.00 → 40.00 lira a dollar).");

  await real.getByRole("button", { name: /last 5 years/ }).click();
  await expect(page.getByRole("slider", { name: "Devaluation per year" })).toHaveValue("24");
  await expect(real.locator("[data-deval-basis]")).toContainText("last 5 years (10.00 → 40.00");

  // kept with the plan
  await page.reload();
  await expect(page.getByRole("slider", { name: "Devaluation per year" })).toHaveValue("24");
  await expect(page.locator("[data-deval-real] [data-deval-basis]")).toContainText("last 5 years");

  // set by hand, it no longer claims to be the average
  await page.getByRole("slider", { name: "Devaluation per year" }).fill("30");
  await expect(page.locator("[data-deval-real] [data-deval-basis]")).toHaveCount(0);
  await expect(page.locator("[data-deval-real]").getByRole("button", { pressed: true })).toHaveCount(0);
});
