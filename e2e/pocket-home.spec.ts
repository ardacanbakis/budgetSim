import { expect, Locator, Page, test } from "@playwright/test";

/**
 * Pocket's Home (/): the hero, "Coming up" with one action per row, the
 * accounts strip, budgets and recent activity. Runs in the demo at 390×844
 * with the Pocket phone layout switched on.
 */

const DEMO_KEY = "renovator-demo-v5";
const SHOTS = "e2e/screenshots";
const TAB_BAR = 56;

interface StoredTx {
  id: string;
  description: string;
  status: "planned" | "completed";
}
interface Store {
  transactions: StoredTx[];
  settings: { dashboardLayout: unknown };
}

async function enterPocket(
  page: Page,
  opts: { locale?: "tr"; home?: string[]; style?: "terminal" | "contrast"; density?: "compact" } = {}
) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/welcome");
  await page.getByRole("button", { name: /demo/i }).click();
  await expect(page.getByText(/Net worth|Toplam varlık/).first()).toBeVisible({ timeout: 15_000 });
  await page.evaluate(
    ({ locale, home, style, density }) => {
      localStorage.setItem("renovator-phone-layout", "pocket");
      if (style) localStorage.setItem("renovator-ui-style", style);
      if (density) localStorage.setItem("renovator-density", density);
      localStorage.removeItem("renovator-pocket-hide-amounts");
      localStorage.removeItem("renovator-pocket-hero");
      if (home) localStorage.setItem("renovator-pocket-home", JSON.stringify(home));
      else localStorage.removeItem("renovator-pocket-home");
      if (locale) localStorage.setItem("renovator-locale", locale);
    },
    { locale: opts.locale, home: opts.home, style: opts.style, density: opts.density }
  );
  await page.reload();
  await expect(page.locator("[data-pocket-shell]")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("[data-coming-up]")).toBeVisible({ timeout: 15_000 });
}

const store = (page: Page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}") as Store, DEMO_KEY);
const comingUpRows = (page: Page) => page.locator("[data-coming-up] > li");
const hero = (page: Page) => page.getByRole("region", { name: /^(Net worth|Safe to spend) · / });
const snackbar = (page: Page) => page.locator("[role=status]").filter({ hasText: /Marked paid|Ödendi/ });

/** Every section heading on the page, in order. */
const headings = (page: Page) => page.locator("main h2").allInnerTexts();

async function bottomOf(locator: Locator): Promise<number> {
  const box = await locator.boundingBox();
  if (!box) throw new Error("not on screen");
  return box.y + box.height;
}

test.describe("Pocket home", () => {
  test("shows the hero and at least four Coming-up rows before the first scroll", async ({ page }) => {
    await enterPocket(page);
    await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();

    const top = hero(page);
    await expect(top).toBeVisible();
    await expect(top.locator("[data-figure=xl]")).toHaveText(/^−?\$[\d,]+\.\d\d$/);
    await expect(top.getByText("Safe to spend", { exact: true })).toBeVisible();
    await expect(top.getByText("This month", { exact: true })).toBeVisible();
    await expect(top.getByText(/owed on cards/)).toBeVisible();
    await expect(top.getByRole("button", { name: /USD\/TRY [\d.]+ · EUR\/TRY [\d.]+/ })).toBeVisible();

    // overdue first, and four rows clear of the tab bar without scrolling
    const rows = comingUpRows(page);
    expect(await rows.count()).toBeGreaterThanOrEqual(4);
    expect(await bottomOf(rows.nth(3))).toBeLessThanOrEqual(844 - TAB_BAR);
    await expect(rows.first()).toContainText(/days? late/);
    await expect(page.getByText(/^Next 7 days · −?\$[\d,]+\.\d\d$/)).toBeVisible();

    // the card statement: the Cards page's figure, and everything owed beneath it
    const card = rows.filter({ hasText: "Bonus Card" });
    await expect(card).toContainText("−₺20,220.30");
    await expect(card).toContainText("Total owed ₺90,220.30");
    await expect(card.getByRole("button", { name: "Pay Bonus Card" })).toBeVisible();

    // unpaid VICTVS sessions: one undated row to /victvs
    await expect(rows.filter({ hasText: /\d+ unpaid sessions?/ })).toContainText("+$187.50");

    // no row is shorter than the row token
    for (const row of await rows.all()) expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(56);

    await page.screenshot({ path: `${SHOTS}/pocket-home-light.png` });
  });

  test("Pay opens the card payment form with the Cards page's suggestion", async ({ page }) => {
    await enterPocket(page);
    await comingUpRows(page).filter({ hasText: "Bonus Card" }).getByRole("button", { name: "Pay Bonus Card" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("heading", { name: /Record payment — Bonus Card/ })).toBeVisible();
    await expect(sheet.getByLabel("Amount (TRY)")).toHaveValue("20220.3");
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
  });

  test("✓ marks an overdue row paid, and Undo puts it back", async ({ page }) => {
    await enterPocket(page);
    const row = comingUpRows(page).filter({ hasText: /days? late/ }).filter({ has: page.getByRole("button", { name: /as paid$/ }) }).first();
    const title = (await row.locator("button").first().locator("span.block.truncate").first().innerText()).trim();
    const before = (await store(page)).transactions.find((t) => t.description === title && t.status === "planned");
    expect(before, `planned row "${title}"`).toBeTruthy();

    await row.getByRole("button", { name: `Mark ${title} as paid` }).click();
    await expect(snackbar(page)).toBeVisible();
    await expect(snackbar(page)).toContainText("Marked paid");
    await expect.poll(async () => (await store(page)).transactions.find((t) => t.id === before!.id)?.status).toBe("completed");
    await expect(comingUpRows(page).filter({ hasText: title })).toHaveCount(0);

    await snackbar(page).getByRole("button", { name: "Undo" }).click();
    await expect.poll(async () => (await store(page)).transactions.find((t) => t.id === before!.id)?.status).toBe("planned");
    await expect(comingUpRows(page).filter({ hasText: title })).toHaveCount(1);
  });

  test("tapping a row's body opens its actions", async ({ page }) => {
    await enterPocket(page);
    const row = comingUpRows(page).filter({ has: page.getByRole("button", { name: /as paid$/ }) }).first();
    await row.locator("button").first().click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("button", { name: /Mark as paid/ })).toBeVisible();
    await expect(sheet.getByRole("button", { name: /Delete/ })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
  });

  test("without live rates the ✓ waits, and the hero says why", async ({ page }) => {
    await enterPocket(page);
    // the rate request never answers
    await page.route("**/api/rates**", () => {});
    await page.reload();
    await expect(page.locator("[data-coming-up]")).toBeVisible({ timeout: 15_000 });
    await expect(hero(page).getByText("Waiting for live rates…")).toBeVisible();
    const check = comingUpRows(page).getByRole("button", { name: /as paid\. Waiting for live rates…$/ }).first();
    await expect(check).toBeDisabled();
    await page.unrouteAll({ behavior: "ignoreErrors" });
  });

  test("the eye blurs every figure on Home and in the header, and stays on after a reload", async ({ page }) => {
    await enterPocket(page);
    const eye = hero(page).getByRole("button", { name: "Hide amounts" });
    await expect(eye).toHaveAttribute("aria-pressed", "false");
    await eye.click();
    await expect(eye).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("html")).toHaveAttribute("data-hide-amounts", "on");
    const blurred = await page.locator("main [data-amount]").evaluateAll((els) =>
      els.map((el) => getComputedStyle(el).filter)
    );
    expect(blurred.length).toBeGreaterThan(10);
    for (const filter of blurred) expect(filter).toContain("blur");

    await page.reload();
    await expect(page.locator("[data-coming-up]")).toBeVisible({ timeout: 15_000 });
    await expect(hero(page).getByRole("button", { name: "Hide amounts" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("html")).toHaveAttribute("data-hide-amounts", "on");
    await page.screenshot({ path: `${SHOTS}/pocket-home-hidden-light.png` });

    // the condensed header masks the lead figure too
    await page.mouse.wheel(0, 400);
    await expect(page.locator("[data-pocket-header]")).toHaveAttribute("data-condensed", "");
    await expect(page.locator("[data-pocket-header]")).toContainText("Net worth •••••");
  });

  test("the header leads with the figure chosen in Settings once the title scrolls away", async ({ page }) => {
    await enterPocket(page);
    await page.mouse.wheel(0, 400);
    await expect(page.locator("[data-pocket-header]")).toHaveAttribute("data-condensed", "");
    await expect(page.locator("[data-pocket-header]")).toContainText(/Net worth −?\$[\d,]+\.\d\d/);

    await page.evaluate(() => localStorage.setItem("renovator-pocket-hero", "safe"));
    await page.reload();
    await expect(page.locator("[data-coming-up]")).toBeVisible({ timeout: 15_000 });
    await expect(hero(page)).toHaveAccessibleName("Safe to spend · USD");
    // the other figure moves to the strip
    await expect(hero(page).getByText("Net worth", { exact: true })).toBeVisible();
  });

  test("Safe to spend opens the Classic breakdown", async ({ page }) => {
    await enterPocket(page);
    await hero(page).getByRole("button", { name: /Safe to spend/ }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByText("Cash and bank accounts")).toBeVisible();
    await expect(sheet.getByText(/Liquid accounts \+ expected income/)).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("accounts, budgets and recent activity follow, and the rates footer opens the quotes", async ({ page }) => {
    await enterPocket(page);
    expect(await headings(page)).toEqual(["Coming up", "Accounts", "Budgets", "Recent activity"]);

    // cards come last among the tiles, as what they're owed; then "All accounts"
    const strip = page.locator("section").filter({ has: page.getByRole("heading", { name: "Accounts" }) });
    const tiles = strip.locator("li");
    await expect(tiles.nth(-2)).toContainText("Bonus Card");
    await expect(tiles.last()).toContainText("All accounts");
    await expect(strip.getByRole("link", { name: /Bonus Card/ })).toContainText("−₺90,220.30");
    await expect(strip.getByRole("link", { name: /Bonus Card/ })).toHaveAttribute("href", /\/accounts\?account=/);

    const budgets = page.locator("section").filter({ has: page.getByRole("heading", { name: "Budgets" }) });
    const bar = budgets.getByRole("progressbar", { name: "Groceries" });
    await expect(bar).toHaveAttribute("aria-valuetext", /^Spent ₺[\d,.]+ of ₺15,000\.00; \d+% of the month gone$/);
    await expect(budgets.getByText(/\/day for \d+ days|left for today|over$/).first()).toBeVisible();
    await budgets.getByRole("button", { name: /All budgets \(2\)/ }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("progressbar")).toHaveCount(2);
    await expect(sheet.getByRole("link", { name: /Edit limits/ })).toHaveAttribute("href", "/settings");
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();

    await hero(page).getByRole("button", { name: /USD\/TRY/ }).click();
    const rates = page.getByRole("dialog");
    await expect(rates.getByText("GRAM GOLD/TRY")).toBeVisible();
    await expect(rates.getByRole("button", { name: "Refresh rates" })).toBeVisible();
    await page.keyboard.press("Escape");

    await page.mouse.wheel(0, 700);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/pocket-home-scrolled-light.png` });
  });

  test("honours the section order kept on the device, and leaves Classic's layout alone", async ({ page }) => {
    await enterPocket(page, { home: ["comingUp", "budgets", "accounts", "!recent", "flow"] });
    expect(await headings(page)).toEqual(["Coming up", "Budgets", "Accounts", "Monthly cashflow (USD)"]);
    await expect(page.getByRole("heading", { name: "Recent activity" })).toHaveCount(0);

    await page.reload();
    await expect(page.locator("[data-coming-up]")).toBeVisible({ timeout: 15_000 });
    expect(await headings(page)).toEqual(["Coming up", "Budgets", "Accounts", "Monthly cashflow (USD)"]);

    // back to the default order when the stored list goes
    await page.evaluate(() => localStorage.removeItem("renovator-pocket-home"));
    await page.reload();
    await expect(page.locator("[data-coming-up]")).toBeVisible({ timeout: 15_000 });
    expect(await headings(page)).toEqual(["Coming up", "Accounts", "Budgets", "Recent activity"]);
    expect((await store(page)).settings.dashboardLayout).toBeNull();
  });

  test("keeps its shape under the Contrast skin", async ({ page }) => {
    await enterPocket(page, { style: "contrast" });
    await expect(page.locator("html")).toHaveAttribute("data-skin", "contrast");
    expect(await comingUpRows(page).count()).toBeGreaterThanOrEqual(4);
    expect(await bottomOf(comingUpRows(page).nth(3))).toBeLessThanOrEqual(844 - TAB_BAR);
    await page.screenshot({ path: `${SHOTS}/pocket-home-contrast-light.png` });
  });

  test("reads naturally in Turkish", async ({ page }) => {
    await enterPocket(page, { locale: "tr" });
    await expect(page.getByRole("heading", { level: 2, name: "Yaklaşanlar" })).toBeVisible();
    await expect(page.getByText(/^Önümüzdeki 7 gün · /)).toBeVisible();
    await expect(comingUpRows(page).filter({ hasText: "Bonus Card" })).toContainText("Toplam borç ₺90.220,30");
    await page.screenshot({ path: `${SHOTS}/pocket-home-tr-light.png` });
  });
});

test.describe("Pocket home, dark", () => {
  test.use({ colorScheme: "dark" });

  test("screenshots", async ({ page }) => {
    await enterPocket(page, { home: ["comingUp", "accounts", "budgets", "recent", "flow", "goals", "gold"] });
    await expect(page.locator("html")).toHaveClass(/dark/);
    await page.screenshot({ path: `${SHOTS}/pocket-home-dark.png` });
    await page.mouse.wheel(0, 700);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/pocket-home-scrolled-dark.png` });
    await page.mouse.wheel(0, 900);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/pocket-home-optional-dark.png` });
  });

  test("Terminal at compact density keeps rows at least 48px tall", async ({ page }) => {
    await enterPocket(page, { style: "terminal", density: "compact" });
    await expect(page.locator("html")).toHaveAttribute("data-skin", "terminal");
    await expect(page.locator("html")).toHaveAttribute("data-density", "compact");
    for (const row of await comingUpRows(page).all()) expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(48);
    for (const button of await page.locator("main button:visible").all()) {
      const box = await button.boundingBox();
      if (box && box.width > 0) expect(box.height, await button.innerText()).toBeGreaterThanOrEqual(44);
    }
    await page.screenshot({ path: `${SHOTS}/pocket-home-terminal-compact-dark.png` });
  });
});
