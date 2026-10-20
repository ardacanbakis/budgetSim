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

