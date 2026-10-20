import { expect, Page, test } from "@playwright/test";
import { pinRates } from "./support/rates";

// the same rates in every run, offline or in CI (see support/rates.ts)
test.beforeEach(async ({ page }) => {
  await pinRates(page);
});

/**
 * Pocket's bottom sheet closes from its header's ✕. The header is also where
 * a drag to dismiss starts, and capturing the pointer there once sent the
 * ✕'s click to the header instead, so the sheet stayed open.
 */

async function enterPocket(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/welcome");
  await page.getByRole("button", { name: /demo/i }).click();
  await expect(page.getByText(/Net worth|Toplam varlık/).first()).toBeVisible({ timeout: 15_000 });
  await page.evaluate(() => localStorage.setItem("renovator-phone-layout", "pocket"));
  await page.goto("/");
  await expect(page.locator("[data-pocket-shell]")).toBeVisible({ timeout: 15_000 });
}

const openCurrencySheet = async (page: Page) => {
  await page.getByRole("button", { name: /^Display currency/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
};

test("the ✕ closes a sheet, by click", async ({ page }) => {
  await enterPocket(page);
  await openCurrencySheet(page);
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test.describe("on a touch screen", () => {
  test.use({ hasTouch: true });

  test("the ✕ closes a sheet, by tap", async ({ page }) => {
    await enterPocket(page);
    await openCurrencySheet(page);
    await page.getByRole("dialog").getByRole("button", { name: "Close" }).tap();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});
