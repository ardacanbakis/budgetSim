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

  // the plan is a scratchpad kept on this device — it survives a reload
  await page.reload();
  await page.waitForTimeout(800);
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
