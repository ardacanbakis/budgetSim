import { expect, Locator, Page, test } from "@playwright/test";

/**
 * Pocket's Portfolio (/accounts): the net-worth hero with All | Assets |
 * Debts, a card per section with its subtotal, and each account full-screen
 * at /accounts?account={id} with Add, Transfer, Adjust (Card payment on a
 * card) and More. Runs in the demo at 390×844 with Pocket switched on.
 */

const DEMO_KEY = "renovator-demo-v5";
const SHOTS = "e2e/screenshots";

interface StoredAccount {
  id: string;
  name: string;
  holdings?: Array<{ type: string; qty: number }> | null;
}
interface Store {
  accounts: StoredAccount[];
  transactions: Array<{ id: string; accountId: string; description: string; amount: number; adjustment?: boolean }>;
}

async function enterPocket(page: Page, opts: { locale?: "tr"; edit?: (store: Store) => void } = {}) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/welcome");
  await page.getByRole("button", { name: /demo/i }).click();
  await expect(page.getByText(/Net worth|Toplam varlık/).first()).toBeVisible({ timeout: 15_000 });
  await page.evaluate(
    ({ locale }) => {
      localStorage.setItem("renovator-phone-layout", "pocket");
      localStorage.removeItem("renovator-pocket-portfolio-seg");
      localStorage.removeItem("renovator-pocket-archived-open");
      localStorage.removeItem("renovator-portfolio-hide-empty");
      if (locale) localStorage.setItem("renovator-locale", locale);
    },
    { locale: opts.locale }
  );
  if (opts.edit) {
    const saved = await store(page);
    opts.edit(saved);
    await page.evaluate(([key, value]) => localStorage.setItem(key, value), [DEMO_KEY, JSON.stringify(saved)] as const);
  }
  await page.goto("/accounts");
  await expect(page.locator("[data-pocket-shell]")).toBeVisible({ timeout: 15_000 });
  await expect(hero(page).locator("[data-figure=xl]")).toBeVisible({ timeout: 15_000 });
}

const store = (page: Page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}") as Store, DEMO_KEY);
const hero = (page: Page) => page.locator("[data-portfolio-hero]");
const heroFigure = (page: Page) => hero(page).locator("[data-figure=xl]");
const headings = (page: Page) => page.locator("main [data-portfolio-section] h2").allInnerTexts();
const subtotal = (page: Page, key: string) => page.locator(`[data-portfolio-section="${key}"] [data-amount]`).first();
const row = (page: Page, name: string) => page.locator(`[data-account-row="${name}"]`).getByRole("button");
const actions = (page: Page, name: string) => page.getByRole("group", { name, exact: true });
const balance = (page: Page) => page.locator("[data-account-balance] [data-figure=xl]");

/** "−$2,158.38" → -2158.38 */
const amountOf = (text: string) => Number(text.replace("−", "-").replace(/[^0-9.-]/g, ""));
const read = async (locator: Locator) => amountOf((await locator.innerText()).trim());

async function openAccount(page: Page, name: string) {
  await row(page, name).click();
  await expect(page).toHaveURL(/\/accounts\?account=/);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(balance(page)).toBeVisible();
}

test.describe("Pocket portfolio", () => {
  test("the hero is net worth, sections carry subtotals, and the segment filters in place", async ({ page }) => {
    await enterPocket(page);
    await expect(page.getByRole("heading", { level: 1, name: "Portfolio" })).toBeVisible();
    await expect(hero(page)).toHaveAccessibleName("Net worth · USD");
    await expect(heroFigure(page)).toHaveText(/^−?\$[\d,]+\.\d\d$/);
    const net = (await heroFigure(page).innerText()).trim();

    expect(await headings(page)).toEqual(["Cash & bank", "Crypto & gold", "Credit cards", "Debt"]);
    for (const key of ["cash", "cryptoGold", "cards", "loans"]) {
      await expect(subtotal(page, key)).toHaveText(/^−?\$[\d,]+\.\d\d$/);
    }
    const cash = await read(subtotal(page, "cash"));
    const cryptoGold = await read(subtotal(page, "cryptoGold"));
    const cards = await read(subtotal(page, "cards"));
    const loans = await read(subtotal(page, "loans"));
    expect(cards).toBeLessThan(0);
    expect(loans).toBeLessThan(0);
    // net worth is what you hold less what the cards are owed, as on the Dashboard
    expect(cash + cryptoGold + cards).toBeCloseTo(amountOf(net), 1);

    // rows: the native figure, with ≈ USD under it when it isn't USD
    await expect(row(page, "Ziraat TRY")).toContainText(/₺[\d,]+\.\d\d/);
    await expect(row(page, "Ziraat TRY")).toContainText(/≈ \$/);
    await expect(row(page, "Wise USD")).not.toContainText("≈");
    await expect(row(page, "Bonus Card")).toContainText(/Due the 15th/);
    await expect(row(page, "Bonus Card")).toContainText(/−₺[\d,]+\.\d\d/);
    for (const r of await page.locator("[data-account-row] button").all()) {
      expect((await r.boundingBox())!.height).toBeGreaterThanOrEqual(56);
    }

    // nothing of the Classic page's desk controls
    await expect(page.getByText(/Select an account/)).toHaveCount(0);
    await expect(page.getByRole("group", { name: "View" })).toHaveCount(0);
    await expect(page.getByRole("group", { name: "Columns" })).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/pocket-portfolio-list-light.png` });

    // the segment is a radio group, and filters without leaving the page
    const radios = page.getByRole("radiogroup", { name: "Show" });
    await expect(radios.getByRole("radio", { name: "All" })).toHaveAttribute("aria-checked", "true");
    await radios.getByRole("radio", { name: "Assets" }).click();
    await expect(page).toHaveURL(/\/accounts$/);
    await expect(hero(page)).toHaveAccessibleName("Assets · USD");
    expect(await headings(page)).toEqual(["Cash & bank", "Crypto & gold"]);
    expect(await read(heroFigure(page))).toBeCloseTo(cash + cryptoGold, 1);

    // arrow keys move along it
    await radios.getByRole("radio", { name: "Assets" }).press("ArrowRight");
    await expect(radios.getByRole("radio", { name: "Debts" })).toHaveAttribute("aria-checked", "true");
    await expect(radios.getByRole("radio", { name: "Debts" })).toBeFocused();
    await expect(hero(page)).toHaveAccessibleName("Debts · USD");
    expect(await headings(page)).toEqual(["Credit cards", "Debt"]);
    expect(await read(heroFigure(page))).toBeCloseTo(cards + loans, 0);
    await page.screenshot({ path: `${SHOTS}/pocket-portfolio-debts-light.png` });

    // remembered on the device
    await page.reload();
    await expect(page.getByRole("radiogroup", { name: "Show" }).getByRole("radio", { name: "Debts" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    await page.getByRole("radio", { name: "All" }).click();

    // the same figure as the Classic Dashboard's net worth
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    await expect(page.getByText(net, { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  });

  test("Ziraat TRY opens full-screen, and Back returns to the list where it was", async ({ page }) => {
    await enterPocket(page);
    await openAccount(page, "Ziraat TRY");
    await expect(balance(page)).toHaveText(/^₺[\d,]+\.\d\d$/);
    await expect(page.locator("[data-account-balance]")).toContainText(/≈ \$[\d,]+\.\d\d/);
    await expect(page.locator("[data-account-balance]")).toContainText("Turkish");
    // what's planned, each with a ✓, then the history by month and day
    await expect(page.getByRole("heading", { level: 2, name: "Upcoming" })).toBeVisible();
    await expect(page.locator("[data-account-upcoming] li").first().getByRole("button", { name: /as paid/ })).toBeVisible();
    await expect(page.locator("[data-account-feed] h2").first()).toHaveText(/^[A-Z][a-z]+ \d{4}$/);
    await expect(page.locator("[data-account-feed] h3").first()).toBeVisible();
    for (const name of ["Add", "Transfer", "Adjust", "More"]) {
      const button = actions(page, "Ziraat TRY").getByRole("button", { name, exact: true });
      await expect(button).toBeVisible();
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(64);
    }
    await page.screenshot({ path: `${SHOTS}/pocket-portfolio-account-light.png` });

    // the header's back chevron
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page).toHaveURL(/\/accounts$/);
    await expect(page.getByRole("heading", { level: 1, name: "Portfolio" })).toBeVisible();

    // further down the list, and the browser's own back
    await page.evaluate(() => document.querySelector('[data-account-row="Gram Gold"]')!.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(150);
    const y = await page.evaluate(() => window.scrollY);
    expect(y).toBeGreaterThan(100);
    await row(page, "Gram Gold").click();
    await expect(page.getByRole("heading", { level: 1, name: "Gram Gold" })).toBeVisible();
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await page.goBack();
    await expect(page.getByRole("heading", { level: 1, name: "Portfolio" })).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(y - 3);
    expect(Math.abs((await page.evaluate(() => window.scrollY)) - y)).toBeLessThanOrEqual(3);
  });

  test("Adjust takes Ziraat TRY to what the bank shows, and the row reads as an adjustment", async ({ page }) => {
    await enterPocket(page);
    await openAccount(page, "Ziraat TRY");
    const before = await read(balance(page));

    await actions(page, "Ziraat TRY").getByRole("button", { name: "Adjust", exact: true }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("heading", { name: "Adjust balance · Ziraat TRY" })).toBeVisible();
    await sheet.getByLabel(/Balance the bank shows/).fill((before - 37.5).toFixed(2));
    await expect(sheet.getByText(/₺37\.50 will be taken off/)).toBeVisible();
    await sheet.getByLabel(/Reason/).fill("EFT fee");
    await page.screenshot({ path: `${SHOTS}/pocket-portfolio-adjust-light.png` });
    await sheet.getByRole("button", { name: "Record adjustment" }).click();
    await expect(sheet).toBeHidden();

    await expect.poll(() => read(balance(page))).toBeCloseTo(before - 37.5, 2);
    await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
    // at the top of the feed, under today
    const today = page.locator("[data-account-feed] section").first();
    await expect(today.locator("h3")).toContainText("Today");
    const first = today.locator("li").first();
    await expect(first).toContainText("EFT fee");
    await expect(first.getByText("Adjustment", { exact: true })).toBeVisible();
    await expect(first).toContainText("−₺37.50");
    const saved = (await store(page)).transactions.find((tx) => tx.description === "EFT fee");
    expect(saved).toMatchObject({ amount: 37.5, adjustment: true });
    await page.screenshot({ path: `${SHOTS}/pocket-portfolio-adjusted-light.png` });

    // the same row on Classic Portfolio at a desk
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/accounts");
    await page.getByRole("button", { name: /Ziraat TRY/ }).first().click();
    const classic = page.locator("li").filter({ hasText: "EFT fee" }).first();
    await expect(classic).toBeVisible();
    await expect(classic.getByText("Adjustment", { exact: true })).toBeVisible();
    await expect(classic).toContainText("−₺37.50");
    // and the Classic button is still there
    await expect(page.getByRole("button", { name: /Adjust balance/ })).toBeVisible();
  });

  test("a card offers Card payment instead; coins and archived accounts aren't adjusted", async ({ page }) => {
    await enterPocket(page, {
      edit: (s) => {
        s.accounts.find((a) => a.name === "Gram Gold")!.holdings = [{ type: "ceyrek", qty: 2 }];
      },
    });

    // the card: its due day, what it owes, and the statement payment
    await openAccount(page, "Bonus Card");
    await expect(balance(page)).toHaveText(/^−₺[\d,]+\.\d\d$/);
    await expect(page.locator("[data-account-balance]")).toContainText(/Due the 15th · owed ₺[\d,]+\.\d\d/);
    await expect(actions(page, "Bonus Card").getByRole("button", { name: "Adjust", exact: true })).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/pocket-portfolio-card-light.png` });
    await actions(page, "Bonus Card").getByRole("button", { name: "Card payment" }).click();
    await expect(page.getByRole("dialog").getByRole("heading", { name: /Record payment — Bonus Card/ })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Back" }).click();

    // gold held as coins: in lira, with what it holds
    await expect(row(page, "Gram Gold")).toContainText("Çeyrek");
    await openAccount(page, "Gram Gold");
    await expect(balance(page)).toHaveText(/^₺/);
    await expect(page.getByText("Holdings", { exact: true })).toBeVisible();
    await expect(actions(page, "Gram Gold").getByRole("button", { name: "Adjust", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Back" }).click();

    // archived: through More, and Adjust goes
    await openAccount(page, "EUR Savings");
    await expect(actions(page, "EUR Savings").getByRole("button", { name: "Adjust", exact: true })).toBeVisible();
    await actions(page, "EUR Savings").getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Archive" }).click();
    await expect(page.locator("[data-account-detail]").getByText("Archived", { exact: true })).toBeVisible();
    await expect(actions(page, "EUR Savings").getByRole("button", { name: "Adjust", exact: true })).toHaveCount(0);
    await expect(actions(page, "EUR Savings").getByRole("button", { name: "Unarchive" })).toBeVisible();
    await page.getByRole("button", { name: "Back" }).click();

    // folded away at the foot of the list, remembered open
    await expect(row(page, "EUR Savings")).toHaveCount(0);
    const fold = page.getByRole("button", { name: "Archived (1)" });
    await expect(fold).toHaveAttribute("aria-expanded", "false");
    await fold.click();
    await expect(fold).toHaveAttribute("aria-expanded", "true");
    await expect(row(page, "EUR Savings")).toContainText("Archived");
    await page.screenshot({ path: `${SHOTS}/pocket-portfolio-archived-light.png`, fullPage: true });
    await page.reload();
    await expect(page.getByRole("button", { name: "Archived (1)" })).toHaveAttribute("aria-expanded", "true");
  });

  test("Add and Transfer open the add sheet on this account", async ({ page }) => {
    await enterPocket(page);
    await openAccount(page, "Wise USD");
    await actions(page, "Wise USD").getByRole("button", { name: "Add", exact: true }).click();
    let sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("group", { name: "Pay with" }).getByRole("button", { name: /Wise USD/ })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();

    await actions(page, "Wise USD").getByRole("button", { name: "Transfer", exact: true }).click();
    sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("group", { name: "From" }).getByRole("button", { name: /Wise USD/ })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await page.keyboard.press("Escape");
  });

  test("a new account at zero: the empty switch hides it, and Delete needs a second tap", async ({ page }) => {
    await enterPocket(page);
    await page.getByRole("button", { name: "New account" }).click();
    const form = page.getByRole("dialog");
    await form.getByLabel("Name").fill("Cash drawer");
    await form.getByRole("button", { name: "Save" }).click();
    await expect(form).toBeHidden();
    await expect(row(page, "Cash drawer")).toBeVisible();

    const toggle = page.getByRole("switch", { name: "Show empty accounts (1)" });
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect(row(page, "Cash drawer")).toHaveCount(0);
    // the Classic page's own setting
    expect(await page.evaluate(() => localStorage.getItem("renovator-portfolio-hide-empty"))).toBe("on");
    await toggle.click();
    await expect(row(page, "Cash drawer")).toBeVisible();

    await openAccount(page, "Cash drawer");
    await actions(page, "Cash drawer").getByRole("button", { name: "More", exact: true }).click();
    const more = page.getByRole("dialog");
    await expect(more).toContainText("Deleting an account also deletes all its transactions");
    await page.screenshot({ path: `${SHOTS}/pocket-portfolio-more-light.png` });
    await more.getByRole("button", { name: /^Delete/ }).click();
    await expect(more.getByRole("button", { name: "Tap again to confirm" })).toBeVisible();
    await more.getByRole("button", { name: "Tap again to confirm" }).click();
    await expect(page).toHaveURL(/\/accounts$/);
    await expect(page.getByRole("heading", { level: 1, name: "Portfolio" })).toBeVisible();
    await expect(row(page, "Cash drawer")).toHaveCount(0);
    await expect.poll(async () => (await store(page)).accounts.some((a) => a.name === "Cash drawer")).toBe(false);
  });

  test("an account that isn't there falls back to the list", async ({ page }) => {
    await enterPocket(page);
    await page.goto("/accounts?account=not-an-account");
    await expect(page.getByRole("heading", { level: 1, name: "Portfolio" })).toBeVisible({ timeout: 15_000 });
    await expect(hero(page)).toBeVisible();
  });

  test("reads in Turkish", async ({ page }) => {
    await enterPocket(page, { locale: "tr" });
    await expect(page.getByRole("heading", { level: 1, name: "Portföy" })).toBeVisible();
    expect(await headings(page)).toEqual(["Nakit ve banka", "Kripto ve altın", "Kredi kartları", "Borç"]);
    await expect(page.getByRole("radiogroup").getByRole("radio", { name: "Varlıklar" })).toBeVisible();
    await openAccount(page, "Ziraat TRY");
    await expect(actions(page, "Ziraat TRY").getByRole("button", { name: "Düzelt", exact: true })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/pocket-portfolio-account-tr-light.png` });
  });
});

test.describe("Pocket portfolio, dark", () => {
  test.use({ colorScheme: "dark" });

  test("list and account pages", async ({ page }) => {
    await enterPocket(page);
    await expect(page.locator("html")).toHaveClass(/dark/);
    await page.screenshot({ path: `${SHOTS}/pocket-portfolio-list-dark.png` });
    await page.mouse.wheel(0, 500);
    await expect(page.locator("[data-pocket-header]")).toHaveAttribute("data-condensed", "");
    await page.screenshot({ path: `${SHOTS}/pocket-portfolio-list-scrolled-dark.png` });
    await page.evaluate(() => window.scrollTo(0, 0));
    await openAccount(page, "Ziraat TRY");
    await page.screenshot({ path: `${SHOTS}/pocket-portfolio-account-dark.png` });
    await page.mouse.wheel(0, 600);
    await expect(page.locator("[data-pocket-header]")).toContainText("Ziraat TRY");
    await page.screenshot({ path: `${SHOTS}/pocket-portfolio-account-scrolled-dark.png` });
    await page.getByRole("button", { name: "Back" }).click();
    await openAccount(page, "Bonus Card");
    await page.screenshot({ path: `${SHOTS}/pocket-portfolio-card-dark.png` });
  });
});
