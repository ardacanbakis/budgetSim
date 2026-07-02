import { expect, Page, test } from "@playwright/test";

/**
 * Demo-mode smoke: enter without credentials, exercise the core flows, and
 * capture screenshots at phone / tablet / desktop / 21:9 ultrawide sizes.
 */

const VIEWPORTS = [
  { name: "mobile-390", width: 390, height: 844 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "desktop-1280", width: 1280, height: 800 },
  { name: "ultrawide-3440", width: 3440, height: 1440 },
] as const;

async function enterDemo(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: /demo/i }).click();
  await expect(page.getByText(/Net worth|Toplam varlık/)).toBeVisible({ timeout: 15_000 });
}

for (const vp of VIEWPORTS) {
  test(`demo mode renders at ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await enterDemo(page);
    await page.waitForTimeout(1200); // charts settle
    await page.screenshot({ path: `e2e/screenshots/dashboard-${vp.name}.png`, fullPage: false });

    for (const route of ["victvs", "transactions", "purchases", "loans", "reports", "projections"] as const) {
      await page.goto(`/${route}`);
      await page.waitForTimeout(800);
      await page.screenshot({ path: `e2e/screenshots/${route}-${vp.name}.png`, fullPage: false });
    }
  });
}

test("purchases: create installment purchase on the card", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await enterDemo(page);
  await page.goto("/purchases");

  await page.getByRole("button", { name: /new purchase|yeni alım/i }).click();
  await page.getByPlaceholder("iPhone 17").fill("MacBook Air");
  await page.getByLabel(/amount/i).first().fill("120000");
  await page.getByLabel(/number of installments|taksit sayısı/i).fill("12");
  await page.getByRole("button", { name: /^save$|^kaydet$/i }).click();

  // appears under the card with an installment badge and progress line
  await expect(page.getByText("MacBook Air")).toBeVisible();
  await expect(page.getByText(/12×/)).toBeVisible();
  await page.screenshot({ path: "e2e/screenshots/purchase-created.png" });

  // its planned installments exist in transactions
  await page.goto("/transactions");
  await expect(page.getByText("MacBook Air (1/12)")).toBeVisible();
});

test("scenario overlay and quick-add shortcut", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await enterDemo(page);

  // TRY devaluation overlay adds a dashed line + legend
  await page.goto("/projections");
  await page.getByText(/TRY devaluation|TL devalüasyonu/).click();
  await page.waitForTimeout(600);
  await expect(page.getByText(/TRY −25%/)).toBeVisible();
  await page.screenshot({ path: "e2e/screenshots/projections-scenario.png" });

  // keyboard shortcut opens the shared quick-add modal (blur the checkbox first)
  await page.locator("h1").click();
  await page.keyboard.press("n");
  await expect(page.getByRole("heading", { name: /new transaction|yeni işlem/i })).toBeVisible();
  await page.keyboard.press("Escape");
});

test("demo flows: complete planned, transfer, victvs paste preview", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await enterDemo(page);

  // transfer modal with market-rate prefill
  await page.goto("/transactions");
  await page.getByRole("button", { name: /transfer/i }).first().click();
  await page.getByLabel(/amount sent|gönderilen/i).fill("100");
  const received = page.getByLabel(/amount received|alınan/i);
  await expect(received).not.toHaveValue("");
  await page.screenshot({ path: "e2e/screenshots/transfer-modal.png" });
  await page.keyboard.press("Escape");

  // victvs paste → preview grid
  await page.goto("/victvs");
  await page.getByRole("button", { name: /paste|yapıştır/i }).click();
  await page
    .getByRole("textbox")
    .fill("12/01/2026\tPearson VUE Invigilation\t$120\n13.01.2026\tRemote Proctoring\t95.50 USD\nbroken line without numbers here");
  await page.getByRole("button", { name: /preview|önizle/i }).click();
  await expect(page.getByText(/2 sessions recognized|2 seans tanındı/)).toBeVisible();
  await page.screenshot({ path: "e2e/screenshots/victvs-paste-preview.png" });
});
