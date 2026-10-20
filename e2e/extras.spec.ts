import { expect, Page, test } from "@playwright/test";
import { pinRates } from "./support/rates";

// the same rates in every run, offline or in CI (see support/rates.ts)
test.beforeEach(async ({ page }) => {
  await pinRates(page);
});

/**
 * The smaller extras outside Pocket: the quick jump (⌘K) in every style.
 */

async function enterDemo(page: Page) {
  await page.goto("/welcome");
  await page.getByRole("button", { name: /demo/i }).click();
  await expect(page.getByText(/Net worth|Toplam varlık/)).toBeVisible({ timeout: 15_000 });
}

const palette = (page: Page) => page.getByRole("dialog", { name: /Quick jump|Hızlı geçiş/i });

test.describe("quick jump in Classic", () => {
  test("⌘K opens it, and it finds a page, an account and Dashboard settings", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await enterDemo(page);
    // Classic is the demo's style: no Quick jump button in the header
    await expect(page.getByRole("button", { name: /Quick jump/i })).toHaveCount(0);

    await page.keyboard.press("Control+k");
    await expect(palette(page)).toBeVisible();
    await expect(palette(page).getByRole("textbox")).toBeFocused();
    await page.keyboard.type("plnr");
    await expect(palette(page).getByRole("button", { name: /Planner/ })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/planner$/);
    await expect(palette(page)).toHaveCount(0);

    await page.keyboard.press("Control+k");
    await page.keyboard.type("ziraat");
    await expect(palette(page).getByRole("button", { name: /Ziraat/ }).first()).toBeVisible();
    // ⌘K again closes it, as Escape does
    await page.keyboard.press("Control+k");
    await expect(palette(page)).toHaveCount(0);

    await page.keyboard.press("Control+k");
    await page.keyboard.type("dashboard set");
    const entry = palette(page).getByRole("button", { name: /Dashboard settings/ });
    await expect(entry).toBeVisible();
    await entry.click();
    await expect(page).toHaveURL(/\/settings\?tab=dashboard$/);
  });

  test("in Turkish too", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await enterDemo(page);
    await page.evaluate(() => localStorage.setItem("renovator-locale", "tr"));
    await page.reload();
    await expect(page.getByText(/Toplam varlık/)).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press("Control+k");
    await page.keyboard.type("özet ay");
    await expect(palette(page).getByRole("button", { name: /Özet ayarları/ })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(palette(page)).toHaveCount(0);
  });
});
