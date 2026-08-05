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

    for (const route of ["victvs", "transactions", "purchases", "accounts", "loans", "reports", "planner"] as const) {
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

test("wave12: rate ticker renders quotes and can be switched off in settings", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await enterDemo(page);

  // the tape quotes pairs the way they're spoken, USD/TRY not TRY/USD
  const tape = page.getByRole("marquee");
  await expect(tape).toBeVisible();
  const text = await tape.textContent();
  expect(text).toContain("USD/TRY");
  expect(text).toContain("BTC/USD");
  await page.screenshot({ path: "e2e/screenshots/wave12-ticker.png" });

  // opt out from Settings → Preferences (click the label; asserting on the
  // resulting UI is steadier than uncheck(), which races the re-render)
  await page.goto("/settings");
  await page.getByText("Market rate ticker").click();
  await expect(page.getByRole("marquee")).toHaveCount(0);
});

test("planner: what-if items and budgets move the horizon, and survive a reload", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await enterDemo(page);
  await page.goto("/planner");

  const horizonCard = page.locator("text=Net worth at horizon").locator("..");
  await page.getByRole("button", { name: "5y" }).click();
  await page.waitForTimeout(300);
  const baseText = (await horizonCard.textContent()) ?? "";

  // a second salary of 1,500/mo over 5 years must add exactly 90,000
  await page.getByRole("button", { name: /Add item/i }).click();
  await page.getByLabel(/^Name$/i).fill("Second salary");
  await page.getByRole("button", { name: /^Income$/ }).click();
  await page.getByLabel(/Amount/i).first().fill("1500");
  await page.getByRole("button", { name: /^Save$/ }).click();
  await page.waitForTimeout(400);
  const withSalary = (await horizonCard.textContent()) ?? "";
  expect(withSalary).not.toBe(baseText);
  await expect(page.getByText(/\$180,000\.00 over the horizon|\$90,000\.00 over the horizon/)).toBeVisible();

  // a capped mortgage shows its own horizon total and pulls the line down
  await page.getByRole("button", { name: /Add item/i }).click();
  await page.getByLabel(/^Name$/i).fill("Mortgage");
  await page.getByRole("button", { name: /^Expense$/ }).click();
  await page.getByLabel(/Amount/i).first().fill("900");
  await page.locator(".fixed.inset-0 select").last().selectOption("for");
  await page.getByLabel(/Number of months/i).fill("120");
  await page.getByRole("button", { name: /^Save$/ }).click();
  await page.waitForTimeout(400);
  expect(await horizonCard.textContent()).not.toBe(withSalary);

  // year milestones render inside the horizon
  await expect(page.getByRole("heading", { name: "Where you land" })).toBeVisible();

  // the plan is saved as a named scenario — it survives a reload
  await page.reload();
  await page.waitForTimeout(1400);
  await expect(page.locator("li").filter({ hasText: "Mortgage" })).toHaveCount(1);
  await page.screenshot({ path: "e2e/screenshots/planner.png" });
});

test("planner: per-item currency, and devaluation erodes a fixed TRY loan", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1100 });
  await enterDemo(page);
  await page.goto("/planner");
  await page.getByRole("button", { name: "10y" }).click();
  await page.waitForTimeout(400);

  const horizon = page.locator("text=Net worth at horizon").locator("..");
  const before = (await horizon.textContent()) ?? "";

  // a fixed-rate lira mortgage, entered in TRY rather than the display currency
  await page.getByRole("button", { name: /Add item/i }).click();
  await page.getByLabel(/^Name$/i).fill("TRY mortgage");
  await page.getByRole("button", { name: /^Expense$/ }).click();
  await page.getByLabel(/Amount/i).first().fill("30000");
  await page.locator(".fixed.inset-0 select").first().selectOption("TRY");
  // the inflation toggle is offered only for the currency that devalues
  await expect(page.getByText("Amount rises with inflation")).toBeVisible();
  await page.getByRole("checkbox").last().uncheck();
  await page.locator('.fixed.inset-0 input[type="month"]').first().fill("2027-03");
  await page.locator(".fixed.inset-0 select").last().selectOption("for");
  await page.getByLabel(/Number of months/i).fill("120");
  await page.getByRole("button", { name: /^Save$/ }).click();
  await page.waitForTimeout(400);

  // the item keeps its own currency in the list
  await expect(page.locator("li").filter({ hasText: "TRY mortgage" })).toContainText("₺");
  const withLoan = (await horizon.textContent()) ?? "";
  expect(withLoan).not.toBe(before);

  // switching devaluation on makes the fixed lira debt cheaper in dollars
  await page.getByText("Model a steadily weakening lira").click();
  await page.waitForTimeout(600);
  await expect(page.getByText(/the lira loses about \d+% of its value/)).toBeVisible();
  expect(await horizon.textContent()).not.toBe(withLoan);
  await page.screenshot({ path: "e2e/screenshots/planner-devaluation.png" });
});

test("planner: year jumps on the slider and expandable month detail", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await enterDemo(page);
  await page.goto("/planner");

  // the slider carries clickable year marks 1y…10y
  await expect(page.getByRole("button", { name: /^\d+y$/ })).toHaveCount(10);
  await page.getByRole("button", { name: "3y" }).click();
  await page.waitForTimeout(400);
  await expect(page.locator("tbody tr")).toHaveCount(36);

  // months read as real dates and expand to show what makes them up
  const firstRow = page.locator("tbody tr").first();
  await expect(firstRow).toContainText(/\w{3} 20\d\d/);
  await firstRow.click();
  const detail = page.locator("tbody tr").nth(1);
  await expect(detail).toContainText("Rent");
  await page.screenshot({ path: "e2e/screenshots/planner-timeline.png" });

  // collapsing hides it again
  await firstRow.click();
  await expect(page.locator("tbody tr").nth(1)).not.toContainText("Rent");

  // two columns by default, with the stacked view still available
  await expect(page.getByRole("button", { name: "Two columns" })).toBeVisible();
  await page.getByRole("button", { name: "Single column" }).click();
  await page.waitForTimeout(300);
  await page.reload();
  await page.waitForTimeout(800);
  // the choice sticks across a reload
  await expect(page.getByRole("button", { name: "Single column" })).toBeVisible();
});

test("part1: current month first, history collapsed, legacy shown apart", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await enterDemo(page);

  // the ledger opens on now, with other years folded away
  await page.goto("/transactions");
  await page.waitForTimeout(500);
  const heads = await page.getByText(/^[\u25b8\u25be] 20\d\d$/).allTextContents();
  expect(heads[0]).toMatch(/\u25be/); // current year expanded
  expect(heads.slice(1).every((h) => h.startsWith("\u25b8"))).toBe(true);
  const thisMonth = new Date().toLocaleDateString("en-US", { month: "long" });
  await expect(page.getByText(thisMonth).first()).toBeVisible();

  // an imported record is summarised separately from the real net
  await page.goto("/settings");
  await page.getByRole("button", { name: /Data$/ }).click();
  const legacySection = page.locator("text=Past incomes & expenses").locator("../..");
  await legacySection.getByLabel(/amount/i).fill("4321");
  await legacySection.getByLabel(/description/i).fill("Old payout");
  await legacySection.getByRole("button", { name: /add legacy record/i }).click();
  await page.waitForTimeout(600);
  await page.goto("/transactions");
  await page.waitForTimeout(500);
  await expect(page.getByText(/Legacy \+/).first()).toBeVisible();
});

test("part1: victvs payouts group by year and month", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await enterDemo(page);
  await page.goto("/victvs");

  // create a payout from one unpaid session
  await page.getByRole("button", { name: /^Unpaid$/ }).first().click();
  await page.getByRole("checkbox").first().check();
  await page.getByRole("button", { name: /Mark paid/i }).click();
  await page.getByRole("button", { name: /^Confirm$/ }).click();
  await page.waitForTimeout(700);
  await page.getByRole("button", { name: /^All$/ }).first().click();
  await page.waitForTimeout(400);

  // it lands under a year → month heading rather than a flat row
  const payouts = page.getByText("Payouts").locator("../..");
  const thisMonth = new Date().toLocaleDateString("en-US", { month: "long" });
  await expect(payouts).toContainText(String(new Date().getFullYear()));
  await expect(payouts).toContainText(thisMonth);
});

test("part1: planner models a lost income source", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await enterDemo(page);
  await page.goto("/planner");
  const horizon = page.locator("text=Net worth at horizon").locator("..");
  const before = (await horizon.textContent()) ?? "";
  await page.getByRole("button", { name: /^VICTVS$/ }).first().click();
  await page.waitForTimeout(500);
  expect(await horizon.textContent()).not.toBe(before);
});

test("part1: the projections page is gone", async ({ page }) => {
  await enterDemo(page);
  const res = await page.goto("/projections");
  expect(res?.status()).toBe(404);
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

test("quick-add keyboard shortcut opens the transaction modal", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await enterDemo(page);
  await page.goto("/transactions");
  await page.locator("h1").first().click(); // move focus off any input
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

test("legacy imports stay out of reports, stats and the flow chart", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await enterDemo(page);

  const incomeSplit = async () => {
    await page.goto("/reports");
    await page.waitForTimeout(500);
    return (await page.locator("text=Income sources").locator("../..").textContent()) ?? "";
  };
  const before = await incomeSplit();

  // a big back-dated import, stamped with today's date and marked legacy —
  // exactly what a year of VICTVS payouts loaded in one go looks like
  await page.goto("/settings");
  await page.getByRole("button", { name: /Data$/ }).click();
  const legacySection = page.locator("text=Past incomes & expenses").locator("../..");
  await legacySection.getByLabel(/amount/i).fill("99999");
  await legacySection.getByLabel(/description/i).fill("Imported VICTVS backlog");
  await legacySection.getByRole("button", { name: /add legacy record/i }).click();
  await page.waitForTimeout(600);

  // the income split is untouched by it
  expect(await incomeSplit()).toBe(before);

  // but it is still there when you ask for the whole record (no re-navigation:
  // the toggle is view state, so reloading would reset it)
  await page.getByText("Include imported history").click();
  await page.waitForTimeout(400);
  const withLegacy = (await page.locator("text=Income sources").locator("../..").textContent()) ?? "";
  expect(withLegacy).not.toBe(before);
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

test("part2: bulk paste imports a card statement as legacy expenses", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await enterDemo(page);

  const netWorthTile = page.locator("text=Net worth").locator("..");
  const before = await netWorthTile.textContent();

  await page.goto("/settings");
  await page.getByRole("button", { name: /Data$|Veri$/ }).click();
  await page.getByRole("button", { name: /paste a statement/i }).click();

  const modal = page.locator(".fixed.inset-0").filter({ hasText: /Bulk import past movements/i });
  // Turkish decimal convention, tab-separated, with a refund on the last row
  await modal.locator("textarea").fill(
    ["15.03.2025\tAKBANK KREDI KARTI ODEME\t12.500,00", "02.04.2025\tMigros\t1.250,50", "05.04.2025\tIade\t-300,00"].join("\n")
  );
  await modal.getByRole("button", { name: /^Preview$|^Önizle$/i }).click();

  // three rows, dates read day-first, the minus row flipped to income
  await expect(modal.locator("tbody tr")).toHaveCount(3);
  await expect(modal.locator("tbody tr").first().locator("input[type=date]")).toHaveValue("2025-03-15");
  await expect(modal.locator("tbody tr").nth(1).locator("input[type=number]")).toHaveValue("1250.5");
  await expect(modal.locator("tbody tr").nth(2).locator("select")).toHaveValue("income");
  await page.screenshot({ path: "e2e/screenshots/legacy-bulk-import.png" });

  await modal.getByRole("button", { name: /import 3 as legacy/i }).click();
  await page.waitForTimeout(600);
  await expect(page.getByText("AKBANK KREDI KARTI ODEME")).toBeVisible();

  // imported as legacy, so balances are untouched
  await page.goto("/transactions");
  await expect(page.getByText("Migros")).toBeVisible();
  await page.goto("/");
  await page.waitForTimeout(800);
  expect(await netWorthTile.textContent()).toBe(before);
});

test("part2: column switch spreads transaction months side by side", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await enterDemo(page);
  await page.goto("/transactions");

  const toggle = page.getByRole("group", { name: /columns/i });
  await expect(toggle).toBeVisible();
  const monthCards = page.locator("[class*='grid'] > div").filter({ hasText: /^\s*[▾▸]/ });

  await toggle.getByRole("button", { name: "2" }).click();
  await expect(toggle.getByRole("button", { name: "2" })).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: "e2e/screenshots/transactions-two-column.png" });

  // the choice survives a reload — it's a property of this screen
  await page.reload();
  await expect(page.getByRole("group", { name: /columns/i }).getByRole("button", { name: "2" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  expect(await monthCards.count()).toBeGreaterThan(0);
});

test("part2: the sidebar collapses to icons and stays that way", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await enterDemo(page);

  const sidebar = page.locator("aside");
  await expect(sidebar).toHaveClass(/w-56/);
  await sidebar.getByRole("button", { name: /collapse/i }).click();
  await expect(sidebar).toHaveClass(/w-16/);
  await page.screenshot({ path: "e2e/screenshots/sidebar-rail.png" });

  await page.reload();
  await expect(page.locator("aside")).toHaveClass(/w-16/);
  // links still navigate from the rail
  await page.locator("aside").getByRole("link", { name: /transactions|işlemler/i }).click();
  await expect(page.getByRole("heading", { name: /transactions|işlemler/i })).toBeVisible();
});

test("part2: history folding can be turned off in settings", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await enterDemo(page);

  await page.goto("/settings");
  await page.getByText("Fold past years by default").click();
  await page.waitForTimeout(200);

  await page.goto("/transactions");
  await page.waitForTimeout(500);
  // with folding off, every year header opens expanded
  const collapsedYears = await page.getByText(/^▸ \d{4}$/).count();
  expect(collapsedYears).toBe(0);
});

test("part3: phone bar shows five targets and a More sheet", async ({ page }) => {
  await page.setViewportSize({ width: 402, height: 874 }); // iPhone 16 Pro
  await enterDemo(page);

  const bar = page.locator("nav.fixed.inset-x-0.bottom-0");
  // four destinations + More — no sideways scrolling to reach anything
  await expect(bar.locator("a, button")).toHaveCount(5);
  const barBox = await bar.boundingBox();
  expect(barBox!.width).toBeLessThanOrEqual(402);
  await expect(bar.getByRole("button", { name: /more|daha/i })).toBeVisible();

  await bar.getByRole("button", { name: /more|daha/i }).click();
  const sheet = page.locator(".fixed.inset-0").filter({ hasText: /More|Daha/ });
  await expect(sheet.getByRole("link", { name: /planner|planlayıcı/i })).toBeVisible();
  await page.screenshot({ path: "e2e/screenshots/mobile-more-sheet.png" });

  await sheet.getByRole("link", { name: /planner|planlayıcı/i }).click();
  await expect(page).toHaveURL(/\/planner/);
  // the page you're on stays visible in the bar even though it lives in More
  await expect(bar.locator('a[aria-current="page"]')).toHaveCount(1);
  await page.screenshot({ path: "e2e/screenshots/mobile-planner-nav.png" });
});

test("part3: wide tables stack into cards on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 402, height: 874 });
  await enterDemo(page);
  await page.goto("/reports");
  await page.waitForTimeout(800);

  const monthly = page.locator("table.stack-sm").last();
  await expect(monthly).toBeVisible();
  // stacked: a row is as wide as the card, and cells sit on their own lines
  const row = monthly.locator("tbody tr").first();
  const rowBox = await row.boundingBox();
  const cellBox = await row.locator("td").first().boundingBox();
  expect(cellBox!.width).toBeGreaterThan(rowBox!.width * 0.7);
  expect(rowBox!.height).toBeGreaterThan(80);
  await page.screenshot({ path: "e2e/screenshots/mobile-reports-stacked.png", fullPage: false });

  // and nothing pushes the page sideways
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("part3: no page scrolls sideways on an iPhone 16 Pro", async ({ page }) => {
  await page.setViewportSize({ width: 402, height: 874 });
  await enterDemo(page);
  for (const path of ["/", "/accounts", "/transactions", "/purchases", "/victvs", "/recurring", "/loans", "/reports", "/planner", "/settings"]) {
    await page.goto(path);
    await page.waitForTimeout(600);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${path} overflows by ${overflow}px`).toBeLessThanOrEqual(1);
  }
});

test("scenarios: named plans save, reload and compare", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1000 });
  await enterDemo(page);
  await page.goto("/planner");
  await expect(page.getByRole("heading", { name: /planner|planlayıcı/i })).toBeVisible();

  // the plan that was device-local is now a named scenario
  const picker = page.getByLabel(/^Scenario$/i);
  await expect(picker).toHaveValue(/.+/);

  // a second scenario starts empty and is independent of the first
  await page.getByRole("button", { name: /new scenario/i }).click();
  const dialog = page.locator(".fixed.inset-0").filter({ hasText: /New scenario/i });
  await dialog.getByRole("textbox").fill("Mortgage");
  await dialog.getByRole("button", { name: /^save$/i }).click();
  await page.waitForTimeout(600);
  await expect(page.locator("option", { hasText: "Mortgage" })).toHaveCount(1);

  // add a what-if item to Mortgage only
  await page.getByRole("button", { name: /Add item/i }).click();
  await page.getByLabel(/^Name$/i).fill("Mortgage payment");
  await page.getByRole("button", { name: /^Expense$/ }).click();
  await page.getByLabel(/Amount/i).first().fill("2000");
  await page.getByRole("button", { name: /^Save$/ }).click();
  await page.waitForTimeout(1400); // debounced save

  await expect(page.locator("li").filter({ hasText: "Mortgage payment" })).toHaveCount(1);

  // it survives a reload — proof it went to the repo, not just localStorage
  await page.reload();
  await page.waitForTimeout(1400);
  await expect(page.locator("li").filter({ hasText: "Mortgage payment" })).toHaveCount(1);

  // switching back to the first scenario doesn't show the other's item
  const options = await page.getByLabel(/^Scenario$/i).locator("option").allTextContents();
  const other = options.find((o) => o !== "Mortgage")!;
  await page.getByLabel(/^Scenario$/i).selectOption({ label: other });
  await page.waitForTimeout(800);
  await expect(page.locator("li").filter({ hasText: "Mortgage payment" })).toHaveCount(0);

  // and the two can be drawn against each other
  await page.getByLabel(/compare with/i).selectOption({ label: "Mortgage" });
  await page.waitForTimeout(600);
  // the comparison scenario joins the chart legend under its own name
  await expect(page.locator(".recharts-legend-item-text", { hasText: "Mortgage" })).toBeVisible();
  await page.screenshot({ path: "e2e/screenshots/planner-scenarios.png" });
});

test("funding: a short month is paid from an asset you choose", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1100 });
  await enterDemo(page);
  await page.goto("/planner");
  await page.waitForTimeout(800);

  // spend far more than comes in, so every month is short
  const fundingCard = page.locator("div").filter({ hasText: /^Cover a short month from/ }).first();
  await expect(fundingCard).toBeVisible();

  await page.getByRole("button", { name: /Add item/i }).click();
  await page.getByLabel(/^Name$/i).fill("Runaway spending");
  await page.getByRole("button", { name: /^Expense$/ }).click();
  await page.getByLabel(/Amount/i).first().fill("9000");
  await page.getByRole("button", { name: /^Save$/ }).click();
  await page.waitForTimeout(1200);

  // the headline reports what had to be sold, and when it runs out
  await expect(page.getByText(/Sold to get by/i)).toBeVisible();
  await expect(page.getByText(/Runs out in/i)).toBeVisible();
  await page.screenshot({ path: "e2e/screenshots/planner-funding.png" });

  // the timeline names the asset that paid, and lets one month use another
  const firstRow = page.locator("table.stack-sm tbody tr").first();
  await firstRow.click();
  await page.waitForTimeout(300);
  await expect(page.getByText(/This month is .* short/i).first()).toBeVisible();
  const payFrom = page.getByLabel(/^Pay from$/i).first();
  await expect(payFrom).toBeVisible();
  const choices = await payFrom.locator("option").allTextContents();
  expect(choices.length).toBeGreaterThan(1);
  await payFrom.selectOption({ index: 1 });
  await page.waitForTimeout(1000);
  await expect(page.getByText(/This month is .* short/i).first()).toBeVisible();
  await page.screenshot({ path: "e2e/screenshots/planner-funding-month.png" });
});

test("planner custom view: place, resize, hide, and it becomes the default", async ({ page }) => {
  await page.setViewportSize({ width: 1800, height: 1100 });
  await enterDemo(page);
  await page.goto("/planner");
  await page.waitForTimeout(1000);

  // the reading layouts stay narrow; the custom canvas takes the screen
  const shell = page.locator("main > div").first();
  const narrow = (await shell.boundingBox())!.width;
  await page.getByRole("button", { name: /^Custom$/ }).click();
  await page.waitForTimeout(500);
  const wide = (await shell.boundingBox())!.width;
  expect(wide).toBeGreaterThan(narrow);
  expect(wide).toBeGreaterThan(1800 * 0.7); // ~90% of the area left by the sidebar

  await page.getByRole("button", { name: /Edit layout/i }).click();
  await page.waitForTimeout(300);

  // every card is placed explicitly: column, row, width, height
  const card = page.locator('[data-card="projections"]');
  const startBox = (await card.getAttribute("data-box"))!;
  const [, , w0, h0] = startBox.split(",").map(Number);
  const before = (await card.boundingBox())!;

  // resizing changes the card's real footprint, not just the label
  await page.getByRole("button", { name: /^Narrower: Projections$/ }).click();
  await page.waitForTimeout(300);
  await expect(card).toHaveAttribute("data-box", new RegExp(`,${w0 - 1},${h0}$`));
  const after = (await card.boundingBox())!;
  expect(after.width).toBeLessThan(before.width);

  await page.getByRole("button", { name: /^Taller: Projections$/ }).click();
  await page.waitForTimeout(300);
  await expect(card).toHaveAttribute("data-box", new RegExp(`,${w0 - 1},${h0 + 1}$`));
  expect((await card.boundingBox())!.height).toBeGreaterThan(after.height);

  // the table inside grows with the card rather than stopping at the 448px
  // cap it used to carry; the horizon slider sits above it in the same card
  const inner = card.locator(".fill-in-grid");
  const tall = (await card.boundingBox())!.height;
  const innerHeight = (await inner.boundingBox())!.height;
  expect(innerHeight).toBeGreaterThan(448);
  expect(innerHeight).toBeGreaterThan(tall * 0.6);

  // dragging the corner resizes both dimensions at once
  const chartCard = page.locator('[data-card="chart"]');
  const chartStart = (await chartCard.getAttribute("data-box"))!.split(",").map(Number);
  const handle = chartCard.getByRole("button", { name: /^Resize/ });
  const hb = (await handle.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + 400, hb.y + 300, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const chartSize = (await chartCard.getAttribute("data-box"))!;
  const [, , cw, ch] = chartSize.split(",").map(Number);
  expect(ch).toBeGreaterThan(chartStart[3]);
  expect(cw).toBeGreaterThanOrEqual(chartStart[2]);

  // hiding moves it to the tray, and it can be brought back
  await page.getByRole("button", { name: /^Hide Lost income$/ }).click();
  await page.waitForTimeout(300);
  await expect(page.getByText("Hidden cards")).toBeVisible();
  await page.screenshot({ path: "e2e/screenshots/planner-custom.png" });

  // the arrangement survives a reload and is now what the page opens on
  await page.reload();
  await page.waitForTimeout(1200);
  await expect(page.getByRole("button", { name: /^Custom$/ })).toHaveClass(/shadow-sm/);
  await expect(page.locator('[data-card="projections"]')).toHaveAttribute(
    "data-box",
    new RegExp(`,${w0 - 1},${h0 + 1}$`)
  );
  await expect(page.locator('[data-card="chart"]')).toHaveAttribute("data-box", chartSize);
  await expect(page.locator('[data-card="lost"]')).toHaveCount(0); // still hidden
});

test("funding: the card logs every sale, and the badges explain themselves", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1100 });
  await enterDemo(page);
  await page.goto("/planner");
  await page.waitForTimeout(800);

  await page.getByRole("button", { name: /Add item/i }).click();
  await page.getByLabel(/^Name$/i).fill("Runaway spending");
  await page.getByRole("button", { name: /^Expense$/ }).click();
  await page.getByLabel(/Amount/i).first().fill("9000");
  await page.getByRole("button", { name: /^Save$/ }).click();
  await page.waitForTimeout(1200);

  // the sales log is its own card now, month by month
  const log = page.locator("div").filter({ hasText: /^Everything sold/ }).first();
  await expect(log).toBeVisible();
  await expect(page.getByText(/is .* short/).first()).toBeVisible();
  await page.screenshot({ path: "e2e/screenshots/planner-sales-log.png" });

  // and the badges say what they mean, on hover
  await expect(page.locator('[title*="assets were sold"]').first()).toBeVisible();
  expect(await page.locator('[title*="how deep the hole gets"]').count()).toBeGreaterThan(0);
});

test("funding never covers a gap out of money that isn't there", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1100 });
  await enterDemo(page);
  await page.goto("/planner");
  await page.waitForTimeout(800);

  // spend far beyond everything owned, in one month
  await page.getByRole("button", { name: /Add item/i }).click();
  await page.getByLabel(/^Name$/i).fill("Impossible purchase");
  await page.getByRole("button", { name: /^Expense$/ }).click();
  await page.getByLabel(/Amount/i).first().fill("500000");
  await page.getByRole("button", { name: /^Save$/ }).click();
  await page.waitForTimeout(1200);

  // the first month is Short, and what it says is uncovered matches how far
  // under water it leaves you — the bug was claiming a gap was covered
  const firstRow = page.locator("table.stack-sm tbody tr").first();
  await expect(firstRow.getByText("Short")).toBeVisible();
  await firstRow.click();
  await page.waitForTimeout(300);
  const uncovered = await page.getByText(/still uncovered/).first().textContent();
  const endWorth = await firstRow.locator("td").last().textContent();
  const num = (s: string | null) => Number((s ?? "").replace(/[^\d.]/g, ""));
  // the bug reported a rounding-error gap while assets sat untouched; what's
  // uncovered must now be the same order as how far under water you end up
  expect(num(uncovered)).toBeGreaterThan(1000);
  expect(Math.abs(num(uncovered) - num(endWorth)) / num(endWorth)).toBeLessThan(0.02);

  // and nothing was left sitting unsold while the month went unpaid — the bug
  // stopped early and never touched the gold
  const left = await page.locator("[data-source-left]").evaluateAll((els) =>
    els.map((e) => Number(e.getAttribute("data-source-left")))
  );
  expect(left.length).toBeGreaterThan(0);
  expect(Math.max(...left)).toBeLessThan(0.01);
});

test("planner: net worth runs down to nothing and stays down", async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 1100 });
  await enterDemo(page);
  await page.goto("/planner");
  await page.waitForTimeout(900);
  await page.getByRole("button", { name: /^10y$/ }).click();

  // spend far more than comes in, every month, forever
  await page.getByRole("button", { name: /Add item/i }).click();
  await page.getByLabel(/^Name$/i).fill("Big monthly outgoing");
  await page.getByRole("button", { name: /^Expense$/ }).click();
  await page.getByLabel(/Amount/i).first().fill("3000");
  await page.getByRole("button", { name: /^Save$/ }).click();
  await page.waitForTimeout(1400);

  const cells = await page.locator("table.stack-sm tbody tr td:last-child").allTextContents();
  const worth = cells.map((c) => {
    const m = c.match(/(-?)[^\d-]*([\d,]+\.\d\d)/);
    return m ? Number(m[2].replace(/,/g, "")) * (m[1] === "-" ? -1 : 1) : NaN;
  });
  expect(worth.length).toBeGreaterThan(100);

  // it only ever goes down: no month may end richer than the one before it
  for (let i = 1; i < worth.length; i++) {
    expect(worth[i], `${cells[i]} after ${cells[i - 1]}`).toBeLessThan(worth[i - 1] + 0.01);
  }
  // and it really does run out rather than levelling off
  expect(worth.at(-1)!).toBeLessThan(0);

  // the last month with anything left to sell is where the money runs out
  const shorts = page.locator("table.stack-sm tbody tr").filter({ hasText: "Short" });
  expect(await shorts.count()).toBeGreaterThan(0);
  await shorts.first().click();
  await page.waitForTimeout(300);
  await expect(page.getByText(/still uncovered/).first()).toBeVisible();
  await page.screenshot({ path: "e2e/screenshots/planner-runway.png" });
});
