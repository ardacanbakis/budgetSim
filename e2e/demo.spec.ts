import { expect, Page, test } from "@playwright/test";

/**
 * Demo-mode smoke: enter without credentials, exercise the core flows, and
 * capture screenshots at phone (incl. iPhone 16 Pro / Pro Max) / tablet /
 * desktop / 21:9 ultrawide sizes.
 */

const VIEWPORTS = [
  { name: "iphone16pro-402", width: 402, height: 874 },
  { name: "iphone16promax-440", width: 440, height: 956 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "desktop-1280", width: 1280, height: 800 },
  { name: "ultrawide-3440", width: 3440, height: 1440 },
] as const;

async function enterDemo(page: Page) {
  await page.goto("/welcome");
  await page.getByRole("button", { name: /demo/i }).click();
  await expect(page.getByText(/Net worth|Toplam varlık/)).toBeVisible({ timeout: 15_000 });
}

for (const vp of VIEWPORTS) {
  test(`demo mode renders at ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });

    // welcome screen first (neon THEO grid + footer)
    await page.goto("/welcome");
    await page.waitForTimeout(2600); // intro animations settle
    await page.screenshot({ path: `e2e/screenshots/welcome-${vp.name}.png` });

    await page.getByRole("button", { name: /demo/i }).click();
    await expect(page.getByText(/Net worth|Toplam varlık/)).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `e2e/screenshots/dashboard-${vp.name}.png`, fullPage: false });

    for (const route of ["victvs", "transactions", "purchases", "accounts", "loans", "reports", "projections"] as const) {
      await page.goto(`/${route}`);
      await page.waitForTimeout(700);
      await page.screenshot({ path: `e2e/screenshots/${route}-${vp.name}.png`, fullPage: false });
    }
  });
}

test("portfolio: selecting an item shows its history", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await enterDemo(page);
  await page.goto("/accounts");
  await expect(page.getByText(/Select an account|Geçmişini görmek/)).toBeVisible();
  await page.getByRole("button", { name: /Bonus Card/ }).click();
  await expect(page.getByRole("heading", { name: /History|Geçmiş/i })).toBeVisible();
  await expect(page.getByText(/iPhone 17 \(1\/6\)/).first()).toBeVisible();
  await page.screenshot({ path: "e2e/screenshots/portfolio-detail.png" });
});

test("recurring: a template started in the past backfills its earlier items", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await enterDemo(page);

  await page.goto("/recurring");
  await page.getByRole("button", { name: /new recurring item|yeni düzenli/i }).click();
  await page.getByLabel(/name|ad/i).first().fill("Backfill Salary");
  await page.getByRole("button", { name: /^income$|gelir/i }).click();
  await page.getByLabel(/amount|tutar/i).first().fill("2000");

  // start four months ago — the already-past months must materialize too
  const now = new Date();
  const past = new Date(now.getFullYear(), now.getMonth() - 4, 5);
  const iso = `${past.getFullYear()}-${String(past.getMonth() + 1).padStart(2, "0")}-05`;
  await page.locator('input[type="date"]').first().fill(iso);
  await page.getByRole("button", { name: /^save$|kaydet/i }).click();
  await page.waitForTimeout(700);

  // the specific past-dated (overdue) occurrence now exists in the ledger,
  // not just the ones from today forward
  await page.goto("/transactions");
  await page.waitForTimeout(500);
  await expect(page.getByText(new RegExp(iso)).first()).toBeVisible();
});

test("victvs v2: month groups, half-month select, new paste formats", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await enterDemo(page);
  await page.goto("/victvs");

  // month sections with half-month quick select
  await expect(page.getByRole("button", { name: /1st half|İlk yarı/i }).first()).toBeVisible();
  await page.getByRole("button", { name: /1st half|İlk yarı/i }).first().click();
  await page.screenshot({ path: "e2e/screenshots/victvs-groups.png" });

  // paste with the real email formats
  await page.getByRole("button", { name: /paste|yapıştır/i }).click();
  await page
    .getByRole("textbox")
    .fill(
      "CIPS OR Exam 37324 - Wed 15 Jul 26\nV3 - ONLINE - 83849, PTS, 788, Jakarta, Indonesia - 08 Jul 26 - 1500\n21 Jan 26\tCIPS CR Exam \t36951\t60"
    );
  await page.getByRole("button", { name: /preview|önizle/i }).click();
  await expect(page.getByText(/3 sessions recognized|3 seans tanındı/)).toBeVisible();
  // defaults prefilled: CIPS OR 37.5, IWCF 60
  await expect(page.locator('input[value="37.5"]')).toBeVisible();
  await page.screenshot({ path: "e2e/screenshots/victvs-paste-preview.png" });
});

test("wave10: date format, dashboard nav, quick-add toggle, card payment day", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await enterDemo(page);

  // dashboard card navigation: the VICTVS tile drills into /victvs
  await page.getByText(/Unpaid VICTVS|Ödenmemiş/i).click();
  await expect(page).toHaveURL(/\/victvs$/);

  // date format setting reformats displayed dates (dd.mm.yyyy)
  await page.goto("/settings");
  const dateSelect = page.locator("select").filter({ has: page.locator("option", { hasText: /\d{2}\.\d{2}\.\d{4}/ }) });
  await dateSelect.selectOption({ label: "09.03.2026" });
  await page.goto("/victvs");
  await expect(page.getByText(/\d{2}\.\d{2}\.\d{4}/).first()).toBeVisible();

  // quick-add toggle hides the floating + shortcut
  await page.goto("/settings");
  const fab = page.getByRole("button", { name: /new transaction|yeni işlem/i });
  await expect(fab).toBeVisible();
  await page.getByText(/Quick-add button|Hızlı ekle/i).click();
  await expect(fab).toHaveCount(0);

  // credit card statement due day shows on the card detail
  await page.goto("/accounts");
  await page.getByRole("button", { name: /Bonus Card/ }).click();
  await expect(page.getByText(/Statement due|Ekstre/i)).toBeVisible();
});

test("wave11: month groups with net, edit transaction, report category filter, settings tabs", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await enterDemo(page);

  // transactions grouped by year → month with an income − expense = net line
  await page.goto("/transactions");
  await expect(page.getByText(/^▾ 20\d\d/).first()).toBeVisible();
  await expect(page.getByText(/=/).first()).toBeVisible();

  // edit a transaction's description via the ✎ button
  await page.getByRole("button", { name: /edit transaction|işlemi düzenle/i }).first().click();
  const desc = page.getByLabel(/description|açıklama/i).first();
  await desc.fill("Edited by test");
  await page.getByRole("button", { name: /^save$|kaydet/i }).click();
  await expect(page.getByText("Edited by test").first()).toBeVisible();

  // reports: picking a category chip filters and shows the hint
  await page.goto("/reports");
  await page.getByRole("button", { name: /^Groceries$/ }).click();
  await expect(page.getByText(/1 categories selected|1 kategori seçili/)).toBeVisible();

  // settings tabs switch content
  await page.goto("/settings");
  await expect(page.getByText(/Display currency|Görüntüleme para birimi/).first()).toBeVisible();
  await page.getByRole("button", { name: /VICTVS$/ }).last().click();
  await expect(page.getByText(/Default deposit account|Varsayılan yatan hesap/)).toBeVisible();
});

test("wave11: retroactive taksit goes legacy; card payment covers this month's installments", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await enterDemo(page);

  // purchase with the first installment due the 28th of this month (planned)
  await page.goto("/purchases");
  await page.getByRole("button", { name: /new purchase|yeni alım/i }).click();
  await page.getByLabel(/name|ad/i).first().fill("Fridge");
  await page.getByLabel(/amount|tutar/i).first().fill("9000");
  await page.getByRole("checkbox").first().check();
  await page.getByLabel(/number of installments|taksit sayısı/i).fill("3");
  const now = new Date();
  const firstDue = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-28`;
  await page.getByLabel(/first installment|ilk taksit/i).fill(firstDue);
  await page.getByRole("button", { name: /^save$|kaydet/i }).click();
  await page.waitForTimeout(700);

  // the card-payment reminder's modal lists the installment in its breakdown
  await page.goto("/");
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: /record payment|ödemeyi kaydet/i }).first().click();
  await expect(page.getByText(/Fridge \(1\/3\)/).first()).toBeVisible();

  // confirming records the transfer AND posts the installment
  await page.getByRole("button", { name: /^confirm$|onayla/i }).click();
  await page.waitForTimeout(700);
  await page.goto("/transactions");
  const row = page.locator("li").filter({ hasText: "Fridge (1/3)" }).first();
  await expect(row).toBeVisible();
  expect(await row.textContent()).not.toContain("Planned");
});

test("victvs bulk delete: appears on multi-select, confirms, removes rows", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await enterDemo(page);
  await page.goto("/victvs");

  // filter to unpaid so every visible row is deletable, then select two rows
  await page.getByRole("button", { name: /^Unpaid$/ }).first().click();
  const rowsBefore = await page.getByRole("checkbox").count();
  await page.getByRole("checkbox").nth(0).check();
  await page.getByRole("checkbox").nth(1).check();

  // bulk delete only shows for 2+ selected
  const bulkBtn = page.getByRole("button", { name: /Delete selected|Seçilenleri sil/i });
  await expect(bulkBtn).toBeVisible();
  await page.screenshot({ path: "e2e/screenshots/victvs-bulk-delete.png" });

  page.once("dialog", (d) => d.accept());
  await bulkBtn.click();
  await page.waitForTimeout(400);
  const rowsAfter = await page.getByRole("checkbox").count();
  expect(rowsAfter).toBeLessThan(rowsBefore);
});

test("scenario overlay and quick-add shortcut", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await enterDemo(page);

  await page.goto("/projections");
  await page.getByText(/TRY devaluation|TL devalüasyonu/).click();
  await page.waitForTimeout(600);
  await expect(page.getByText(/TRY −25%/)).toBeVisible();

  await page.locator("h1").click();
  await page.keyboard.press("n");
  await expect(page.getByRole("heading", { name: /new transaction|yeni işlem/i })).toBeVisible();
  await page.keyboard.press("Escape");
});

test("legacy import: shows in history but never moves net worth", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await enterDemo(page);

  const netWorthTile = page.locator("text=Net worth").locator("..");
  const before = await netWorthTile.textContent();

  await page.goto("/settings");
  await page.getByRole("button", { name: /Data$|Veri$/ }).click();
  const legacySection = page.locator("text=Past incomes & expenses").locator("../..");
  await legacySection.getByLabel(/amount/i).fill("9999");
  await legacySection.getByLabel(/description/i).fill("Old salary 2024");
  await legacySection.getByRole("button", { name: /add legacy record/i }).click();
  await page.waitForTimeout(500);
  await expect(page.getByText("Old salary 2024")).toBeVisible();
  await page.screenshot({ path: "e2e/screenshots/legacy-settings.png" });

  // transactions list shows it with the Legacy badge
  await page.goto("/transactions");
  await expect(page.getByText("Old salary 2024")).toBeVisible();

  // dashboard net worth unchanged
  await page.goto("/");
  await page.waitForTimeout(800);
  const after = await netWorthTile.textContent();
  expect(after).toBe(before);
});

test("complete as legacy: planned item completes without moving net worth", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await enterDemo(page);

  const netWorthTile = page.locator("text=Net worth").locator("..");
  const before = await netWorthTile.textContent();

  // complete a planned item with the legacy checkbox ticked
  await page.goto("/transactions");
  await page.getByRole("button", { name: /^Complete$/ }).first().click();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: /^Confirm$/ }).click();
  await page.waitForTimeout(500);
  // it now shows completed + Legacy badge
  await expect(page.getByText("Legacy").first()).toBeVisible();
  await page.screenshot({ path: "e2e/screenshots/complete-legacy.png" });

  // dashboard net worth unchanged
  await page.goto("/");
  await page.waitForTimeout(800);
  expect(await netWorthTile.textContent()).toBe(before);
});

test("themes: mocha applies tinted surfaces", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await enterDemo(page);
  await page.goto("/settings");
  await page.getByRole("button", { name: /^mocha$/i }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "mocha");
  await page.waitForTimeout(400);
  await page.screenshot({ path: "e2e/screenshots/theme-mocha.png" });
});
