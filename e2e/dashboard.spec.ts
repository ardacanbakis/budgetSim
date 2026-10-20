import { expect, Page, test } from "@playwright/test";
import { pinRates } from "./support/rates";

// the same rates in every run, offline or in CI (see support/rates.ts)
test.beforeEach(async ({ page }) => {
  await pinRates(page);
});

/**
 * The dashboards' cards and accounts: the layout the user keeps for them
 * (lib/ui/dashboardLayout.ts), synced in user_settings.dashboard_layout, and
 * what Classic, version 2 and Settings do with it. Runs in the demo.
 */

const DEMO_KEY = "renovator-demo-v5";

interface StoredLayout {
  order: string[];
  hidden: string[];
  shown?: string[];
  accounts?: { hidden: string[]; hideEmpty: boolean; limit: number | null };
  upcomingDays?: number;
}

async function enterDemo(page: Page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/welcome");
  await page.getByRole("button", { name: /demo/i }).click();
  await expect(page.getByText(/Net worth|Toplam varlık/)).toBeVisible({ timeout: 15_000 });
}

const storedLayout = (page: Page) =>
  page.evaluate(
    (key) => (JSON.parse(localStorage.getItem(key) ?? "{}").settings?.dashboardLayout ?? null) as StoredLayout | null,
    DEMO_KEY
  );

const card = (page: Page, id: string) => page.locator(`[data-card="${id}"]`);

test.describe("Classic dashboard layout", () => {
  test("a hidden card comes back from a translated chip, and the choice survives a reload", async ({ page }) => {
    await enterDemo(page);
    await expect(card(page, "goals")).toBeVisible();
    // the gold lens has never been on Classic, and still isn't
    await expect(card(page, "gold-lens")).toHaveCount(0);
    // nothing is written just by looking
    expect(await storedLayout(page)).toBeNull();

    await page.getByRole("button", { name: /Edit layout/ }).click();
    const chips = page.locator("[data-cards-off] button");
    // the cards that are off by default are offered too, by name
    await expect(chips).toHaveText(["+ In gold"]);
    await expect(page.getByRole("link", { name: /More options/ })).toHaveAttribute("href", "/settings?tab=dashboard");

    await card(page, "goals").getByRole("button", { name: "Hide" }).click();
    await expect(card(page, "goals")).toHaveCount(0);
    await expect(chips).toHaveText(["+ Goals", "+ In gold"]);
    await expect.poll(async () => (await storedLayout(page))?.hidden).toEqual(["goals"]);

    await page.reload();
    await expect(card(page, "net-worth")).toBeVisible({ timeout: 15_000 });
    await expect(card(page, "goals")).toHaveCount(0);

    await page.getByRole("button", { name: /Edit layout/ }).click();
    await page.getByRole("button", { name: "+ Goals" }).click();
    await expect(card(page, "goals")).toBeVisible();
    await expect(chips).toHaveText(["+ In gold"]);
    await expect.poll(async () => (await storedLayout(page))?.hidden).toEqual([]);

    // and a card that was off by default is turned on the same way
    await page.getByRole("button", { name: "+ In gold" }).click();
    await expect(card(page, "gold-lens")).toBeVisible();
    // an explicit choice either way, so it holds in every style
    await expect.poll(async () => (await storedLayout(page))?.shown).toEqual(["goals", "gold-lens"]);
  });

  test("the arrows move a card among those on screen and the order is saved", async ({ page }) => {
    await enterDemo(page);
    await page.getByRole("button", { name: /Edit layout/ }).click();
    await card(page, "safe-to-spend").getByRole("button", { name: "Move up" }).click();
    await expect.poll(async () => (await storedLayout(page))?.order.slice(0, 2)).toEqual(["safe-to-spend", "net-worth"]);
    await expect(page.locator("[data-card]").first()).toHaveAttribute("data-card", "safe-to-spend");

    await page.reload();
    await expect(page.locator("[data-card]").first()).toHaveAttribute("data-card", "safe-to-spend", { timeout: 15_000 });
  });

  test("names the cards in Turkish", async ({ page }) => {
    await enterDemo(page);
    await page.evaluate(() => localStorage.setItem("renovator-locale", "tr"));
    await page.reload();
    await page.getByRole("button", { name: /Düzeni düzenle/ }).click();
    await expect(page.locator("[data-cards-off] button")).toHaveText(["+ Altın cinsinden"]);
    await expect(page.getByRole("link", { name: /Diğer seçenekler/ })).toBeVisible();
  });
});

/**
 * Changes the stored demo data the way another device's save would, then
 * reloads: a zero-balance account (the demo has none) and the dashboards'
 * account choices.
 */
async function seedAccounts(page: Page, accounts: Partial<NonNullable<StoredLayout["accounts"]>> | null, addEmpty = true) {
  await page.evaluate(
    ({ key, accounts, addEmpty }) => {
      const store = JSON.parse(localStorage.getItem(key) ?? "{}");
      if (addEmpty && !store.accounts.some((a: { name: string }) => a.name === "Empty drawer")) {
        const template = store.accounts.find((a: { name: string }) => a.name === "Ziraat TRY");
        store.accounts.push({ ...template, id: "e2e-empty-drawer", name: "Empty drawer", openingBalance: 0 });
      }
      const ziraat = store.accounts.find((a: { name: string }) => a.name === "Ziraat TRY").id;
      if (accounts) {
        const layout = store.settings.dashboardLayout ?? { order: [], hidden: [] };
        layout.accounts = {
          hidden: [],
          hideEmpty: false,
          limit: 5,
          ...accounts,
          // "ziraat" stands in for the demo's generated id
          ...(accounts.hidden ? { hidden: accounts.hidden.map((id) => (id === "ziraat" ? ziraat : id)) } : {}),
        };
        store.settings.dashboardLayout = layout;
      }
      localStorage.setItem(key, JSON.stringify(store));
    },
    { key: DEMO_KEY, accounts, addEmpty }
  );
  await page.reload();
  await expect(card(page, "net-worth")).toBeVisible({ timeout: 15_000 });
}

const accountsCard = (page: Page) => card(page, "accounts");

test.describe("Dashboard accounts", () => {
  test("Classic lists accounts by value with cards as owed, up to its limit", async ({ page }) => {
    await enterDemo(page);
    const rows = accountsCard(page).locator("div.flex.justify-between");
    // six open accounts, five shown: the biggest first, then "+1 more"
    await expect(rows).toHaveCount(5);
    await expect(accountsCard(page).getByRole("link", { name: "+1 more →" })).toHaveAttribute("href", "/accounts");
    await expect(accountsCard(page)).not.toContainText("Bonus Card");

    // with no limit the card comes last, at what it's owed
    await seedAccounts(page, { limit: null }, false);
    await expect(rows).toHaveCount(6);
    await expect(rows.last()).toContainText("Bonus Card");
    await expect(rows.last()).toContainText("−₺90,220.30");
  });

  test("hiding an account or the empty ones tidies every dashboard and moves no total", async ({ page }) => {
    await enterDemo(page);
    const netWorth = (await card(page, "net-worth").textContent())!;

    await seedAccounts(page, { limit: null });
    await expect(accountsCard(page)).toContainText("Empty drawer");
    await expect(card(page, "net-worth")).toHaveText(netWorth);

    await seedAccounts(page, { limit: null, hideEmpty: true, hidden: ["ziraat"] });
    await expect(accountsCard(page)).not.toContainText("Empty drawer");
    await expect(accountsCard(page)).not.toContainText("Ziraat TRY");
    await expect(accountsCard(page).locator("[data-accounts-left-out]")).toHaveText("1 hidden · 1 empty");
    await expect(accountsCard(page).locator("[data-accounts-left-out]")).toHaveAttribute(
      "href",
      "/settings?tab=dashboard#accounts"
    );
    await expect(card(page, "net-worth")).toHaveText(netWorth);

    // version 2 reads the same choices
    await page.evaluate(() => localStorage.setItem("renovator-ui-style", "calm"));
    await page.reload();
    await expect(page.getByText(/Net worth · USD/)).toBeVisible({ timeout: 15_000 });
    await expect(accountsCard(page).locator("[data-accounts-left-out]")).toHaveText("1 hidden · 1 empty");
    await expect(accountsCard(page)).toContainText("Wise USD");
    await expect(accountsCard(page)).not.toContainText("Ziraat TRY");
    await expect(accountsCard(page)).not.toContainText("Empty drawer");
  });
});

test.describe("Pocket accounts strip", () => {
  test("leaves out the hidden account and counts it on the end tile", async ({ page }) => {
    await enterDemo(page);
    await seedAccounts(page, { hidden: ["ziraat"] }, false);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => {
      localStorage.setItem("renovator-phone-layout", "pocket");
      localStorage.removeItem("renovator-pocket-home");
    });
    await page.reload();
    const strip = page.locator("section").filter({ has: page.getByRole("heading", { name: "Accounts" }) });
    await expect(strip.locator("li").last()).toContainText("All accounts", { timeout: 15_000 });
    await expect(strip.locator("li").last()).toContainText("+1");
    await expect(strip.getByRole("link", { name: /Wise USD/ })).toBeVisible();
    await expect(strip.getByRole("link", { name: /Ziraat TRY/ })).toHaveCount(0);
    // cards still come last among the tiles
    await expect(strip.locator("li").nth(-2)).toContainText("Bonus Card");
  });
});

