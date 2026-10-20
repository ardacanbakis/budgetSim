import { expect, Locator, Page, test } from "@playwright/test";
import { pinRates } from "./support/rates";

// the same rates in every run, offline or in CI (see support/rates.ts)
test.beforeEach(async ({ page }) => {
  await pinRates(page);
});

/**
 * The desk pages inside Pocket: Debt, Reports, Planner and Evim sistemi keep
 * their Classic markup, and marker classes fix what breaks on a phone. Runs in
 * the demo at 390×844 with the Pocket phone layout switched on, then checks
 * that the same classes do nothing with Pocket off.
 */

const DESK = ["loans", "reports", "planner", "savings"] as const;

async function enterDemo(page: Page, width = 390, height = 844) {
  await page.setViewportSize({ width, height });
  await page.goto("/welcome");
  await page.getByRole("button", { name: /demo/i }).click();
  await expect(page.getByText(/Net worth|Toplam varlık/).first()).toBeVisible({ timeout: 15_000 });
}

async function enterPocket(page: Page, width = 390, height = 844) {
  await enterDemo(page, width, height);
  await page.evaluate(() => {
    localStorage.setItem("renovator-phone-layout", "pocket");
    // the "easier on a larger screen" note is remembered per route; start with it showing
    for (const key of Object.keys(localStorage)) if (key.startsWith("renovator-pocket-note")) localStorage.removeItem(key);
  });
  await page.reload();
  await expect(page.locator("[data-pocket-shell]")).toBeVisible({ timeout: 15_000 });
}

async function open(page: Page, route: (typeof DESK)[number]) {
  await page.goto(`/${route}`);
  await expect(page.locator("main h1").first()).toBeVisible({ timeout: 15_000 });
}

/** the rendered extent of an element's text, which can spill past its box */
const textRect = (el: Locator) =>
  el.evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const r = range.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
  });

type Rect = { left: number; right: number; top: number; bottom: number };
const overlaps = (a: Rect, b: Rect) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;

/** a scroller that no longer scrolls: no cap, nothing hidden inside it */
const scrollState = (el: Locator) =>
  el.evaluate((node) => {
    const style = getComputedStyle(node);
    return { maxHeight: style.maxHeight, overflowY: style.overflowY, trapped: node.scrollHeight > node.clientHeight + 1 };
  });

/** the button row of a Classic form in a Pocket sheet stays pinned while the fields scroll */
async function expectSheetWithPinnedButtons(page: Page, title: RegExp, primary: RegExp, shot: string) {
  const sheet = page.locator("[data-pocket-sheet]");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("heading", { name: title })).toBeVisible();
  const button = sheet.getByRole("button", { name: primary });
  await expect(button).toBeVisible();
  const row = button.locator("xpath=..");
  expect(await row.evaluate((node) => getComputedStyle(node).position)).toBe("sticky");
  const rowBox = (await row.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(rowBox.y + rowBox.height).toBeLessThanOrEqual(viewport.height + 1);
  await page.waitForTimeout(400); // the sheet has finished sliding up
  await page.screenshot({ path: `e2e/screenshots/pocket-desk-${shot}.png` });
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
}

test.describe("Pocket desk pages", () => {
  test("Debt: tracked loans first, simulator figures apart, schedule without an inner scroll", async ({ page }) => {
    await enterPocket(page);
    await open(page, "loans");

    const tracked = page.getByText("Tracked loans", { exact: true });
    const simulator = page.getByText("Simulator", { exact: true });
    await expect(tracked).toBeVisible();
    expect((await tracked.boundingBox())!.y).toBeLessThan((await simulator.boundingBox())!.y);

    // each result's figure stays inside its own column and clear of its neighbours
    const results = page.locator("main .pocket-cols-2");
    await expect(results.getByText("Total payback")).toBeVisible();
    const columns = await results.evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(" ").length);
    expect(columns).toBe(2);
    const box = (await results.boundingBox())!;
    const figures = results.locator(":scope > div > div:last-child");
    const count = await figures.count();
    expect(count).toBeGreaterThanOrEqual(4);
    const rects: Rect[] = [];
    for (let i = 0; i < count; i++) rects.push(await textRect(figures.nth(i)));
    for (const r of rects) {
      expect(r.left).toBeGreaterThanOrEqual(box.x - 0.5);
      expect(r.right).toBeLessThanOrEqual(box.x + box.width + 0.5);
    }
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) expect(overlaps(rects[i], rects[j]), `figures ${i} and ${j}`).toBe(false);

    // the schedule reads in the page's own scroll, two figures to a line
    await page.getByText("Payment schedule").click();
    const scroller = page.locator("main .pocket-unscroll");
    expect(await scrollState(scroller)).toEqual({ maxHeight: "none", overflowY: "visible", trapped: false });
    const firstRow = scroller.locator("tbody tr").first();
    await expect(firstRow.locator("td")).toHaveCount(5);
    const cells = await firstRow.locator("td").evaluateAll((tds) => tds.map((td) => td.getBoundingClientRect().top));
    expect(cells[1]).toBeCloseTo(cells[2], 0); // date and installment share a line
    expect((await firstRow.boundingBox())!.height).toBeLessThan(120);


    // TrackModal opens as a Pocket sheet with its buttons pinned
    await page.getByRole("button", { name: "Track this loan" }).click();
    await expectSheetWithPinnedButtons(page, /Track this loan/, /^Confirm$/, "loans-track-sheet");
  });

  test("Reports: legend fits, chips in one row, month by month is a real table, no Print", async ({ page }) => {
    await enterPocket(page);
    await open(page, "reports");

    await expect(page.getByRole("button", { name: /Print monthly report/ })).toBeHidden();

    // category chips: one row that scrolls sideways
    const chips = page.locator("main .pocket-scroll-x");
    const tops = await chips.locator("button").evaluateAll((buttons) => buttons.map((b) => Math.round(b.getBoundingClientRect().top)));
    expect(tops.length).toBeGreaterThan(3);
    expect(new Set(tops).size).toBe(1);
    expect(await chips.evaluate((node) => node.scrollWidth > node.clientWidth && getComputedStyle(node).overflowX === "auto")).toBe(true);

    // allocation: every currency in the legend, inside the card
    const allocation = page.locator("main .pocket-auto-h");
    const card = (await allocation.boundingBox())!;
    for (const currency of ["TRY", "USD", "EUR", "BTC", "GOLD"]) {
      const entry = allocation.getByText(currency, { exact: true });
      await expect(entry).toBeVisible();
      const row = (await entry.locator("xpath=..").boundingBox())!;
      expect(row.x).toBeGreaterThanOrEqual(card.x);
      expect(row.x + row.width).toBeLessThanOrEqual(card.x + card.width + 0.5);
      expect(row.y + row.height).toBeLessThanOrEqual(card.y + card.height + 0.5);
    }

    // month by month: a 4-column table, a month to a line
    const monthly = page.locator("main table", { has: page.locator("th", { hasText: "Expenses" }) });
    expect(await monthly.evaluate((node) => getComputedStyle(node).display)).toBe("table");
    for (const head of ["Month", "Income", "Expenses", "Net"]) await expect(monthly.locator("thead").getByText(head, { exact: true })).toBeVisible();
    const row = monthly.locator("tbody tr").first();
    const rowTops = await row.locator("td").evaluateAll((tds) => tds.map((td) => Math.round(td.getBoundingClientRect().top)));
    expect(rowTops).toHaveLength(4);
    expect(new Set(rowTops).size).toBe(1);
    const labels = await row.locator("td").first().evaluate((td) => getComputedStyle(td, "::before").display);
    expect(labels).toBe("none");
    // the table fits the card without a sideways scroll
    expect(await monthly.locator("xpath=..").evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);

  });

  test("Evim sistemi: a schedule instalment takes about half the height, every column kept", async ({ page }) => {
    await enterPocket(page);
    await open(page, "savings");
    await expect(page.getByText("This page is easier on a larger screen", { exact: false })).toBeVisible();

    const schedule = page.locator("main table", { has: page.locator("td[data-label='Cash out']") });
    const rows = schedule.locator("tbody tr");
    expect(await rows.count()).toBeGreaterThan(3);
    for (const i of [0, 1, 2]) {
      const row = rows.nth(i);
      const sizes = await row.locator("td").evaluateAll((tds) => tds.map((td) => td.getBoundingClientRect()).map((r) => r.width * r.height));
      expect(sizes).toHaveLength(8);
      for (const size of sizes) expect(size).toBeGreaterThan(0);
      // stacked one per line this was ~280px; two to a line it's about half
      // (with room for fonts that render a little taller on another machine)
      expect((await row.boundingBox())!.height).toBeLessThan(210);
    }
    const tops = await rows.first().locator("td").evaluateAll((tds) => tds.map((td) => Math.round(td.getBoundingClientRect().top)));
    expect(tops[1]).toBe(tops[2]); // date and instalment side by side

  });

  test("Planner: the note dismisses, no Export JSON, projections without a scroll trap, modals as sheets", async ({ page }) => {
    await enterPocket(page);
    await open(page, "planner");

    const note = page.getByText("This page is easier on a larger screen", { exact: false });
    await expect(note).toBeVisible();
    await expect(page.getByRole("button", { name: "Export JSON" })).toBeHidden();
    await expect(page.getByRole("button", { name: "Duplicate" })).toBeVisible();

    const scroller = page.locator("main .pocket-unscroll");
    expect(await scrollState(scroller)).toEqual({ maxHeight: "none", overflowY: "visible", trapped: false });
    const month = scroller.locator("tbody tr").first();
    await expect(month.locator("td")).toHaveCount(5);
    const tops = await month.locator("td").evaluateAll((tds) => tds.map((td) => Math.round(td.getBoundingClientRect().top)));
    expect(tops[1]).toBe(tops[2]); // income and expense side by side
    // a month still opens its detail row, which spans the card
    await month.locator("button").first().click();
    const detail = scroller.locator("tbody tr.stack-attach").first();
    await expect(detail).toBeVisible();
    const detailCell = (await detail.locator("td").boundingBox())!;
    expect(detailCell.width).toBeGreaterThan((await month.boundingBox())!.width * 0.8);

    await page.getByRole("button", { name: "+ New scenario" }).click();
    await expectSheetWithPinnedButtons(page, /New scenario/, /^Save$/, "planner-scenario-sheet");

    await page.locator("main").getByRole("button", { name: "Dismiss" }).click();
    await expect(note).toBeHidden();
    await page.reload();
    await expect(page.locator("main h1").first()).toBeVisible({ timeout: 15_000 });
    await expect(note).toBeHidden();
  });

  test("More → Phone layout opens the card, from another page and from Settings on another tab", async ({ page }) => {
    await enterPocket(page);
    const card = page.locator("#phone-layout");
    const row = async () => {
      await page.getByRole("button", { name: /^More/ }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Phone layout · Pocket" }).click();
    };
    const inView = () => card.evaluate((el) => el.getBoundingClientRect().top).then((top) => top >= 0 && top < 200);

    await page.evaluate(() => localStorage.setItem("renovator-settings-tab", "data"));
    await page.goto("/");
    await expect(page.locator("[data-pocket-shell]")).toBeVisible({ timeout: 15_000 });
    await row();
    await expect(page).toHaveURL(/\/settings\?tab=preferences#phone-layout$/);
    await expect(card).toBeAttached({ timeout: 15_000 });
    await expect.poll(inView).toBe(true);

    // already on Settings, with another tab open: a link to the page would change nothing
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByRole("button", { name: "⇅ Data", exact: true }).click();
    await expect(card).toHaveCount(0);
    await row();
    await expect(card).toBeAttached();
    await expect(page.getByRole("button", { name: "⚙ Preferences", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect.poll(inView).toBe(true);
  });

  test("screenshots: every desk page at 390 (light and dark), 402 and 440", async ({ page }) => {
    test.setTimeout(300_000);
    await enterPocket(page);
    const runs = [
      { width: 390, height: 844, scheme: "light" as const, tag: "390" },
      { width: 390, height: 844, scheme: "dark" as const, tag: "390-dark" },
      { width: 402, height: 874, scheme: "light" as const, tag: "402" },
      { width: 440, height: 956, scheme: "light" as const, tag: "440" },
    ];
    // the part of each page its fixes are about
    const details: Record<(typeof DESK)[number], Array<{ part: string; find: (p: Page) => Locator }>> = {
      loans: [
        { part: "results", find: (p) => p.locator("main .pocket-cols-2") },
        { part: "schedule", find: (p) => p.locator("main .pocket-unscroll") },
      ],
      reports: [
        { part: "allocation", find: (p) => p.locator("main .pocket-auto-h") },
        { part: "monthly", find: (p) => p.locator("main table", { has: p.locator("th", { hasText: "Expenses" }) }) },
      ],
      planner: [
        { part: "budgets", find: (p) => p.getByText("Monthly budgets", { exact: true }) },
        { part: "projections", find: (p) => p.locator("main .pocket-unscroll") },
      ],
      savings: [{ part: "schedule", find: (p) => p.locator("main table", { has: p.locator("td[data-label='Cash out']") }) }],
    };
    for (const run of runs) {
      await page.setViewportSize({ width: run.width, height: run.height });
      await page.emulateMedia({ colorScheme: run.scheme });
      for (const route of DESK) {
        await open(page, route);
        await page.waitForTimeout(600);
        // nothing on the page reaches past the screen's edge
        const wide = await page.evaluate(() => document.scrollingElement!.scrollWidth - document.documentElement.clientWidth);
        expect(wide, `${route} at ${run.tag}`).toBeLessThanOrEqual(0);
        await page.screenshot({ path: `e2e/screenshots/pocket-desk-${route}-${run.tag}.png` });
        if (route === "loans") await page.getByText("Payment schedule").click();
        for (const { part, find } of details[route]) {
          // below the 44px header, centred when it fits above the tab bar
          await find(page).evaluate((node) => {
            const r = node.getBoundingClientRect();
            const room = window.innerHeight - 44 - 72;
            window.scrollTo(0, window.scrollY + r.top - 44 - Math.max(12, (room - r.height) / 2));
          });
          await page.mouse.move(0, 0); // no chart tooltip left open under the pointer
          await page.waitForTimeout(200);
          await page.screenshot({ path: `e2e/screenshots/pocket-desk-${route}-${part}-${run.tag}.png` });
        }
      }
    }
  });
});

test("Pocket off: the desk markers change nothing", async ({ page }) => {
  await enterDemo(page);
  await expect(page.locator("[data-pocket-shell]")).toHaveCount(0);

  await open(page, "loans");
  const results = page.locator("main .pocket-cols-2");
  await expect(results.getByText("Total payback")).toBeVisible();
  expect(await results.evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(" ").length)).toBe(3);
  expect(await page.locator("main .pocket-unscroll").evaluate((node) => getComputedStyle(node).maxHeight)).not.toBe("none");
  const tracked = (await page.getByText("Tracked loans", { exact: true }).boundingBox())!;
  expect(tracked.y).toBeGreaterThan((await page.getByText("Simulator", { exact: true }).boundingBox())!.y);

  await open(page, "reports");
  await expect(page.getByRole("button", { name: /Print monthly report/ })).toBeVisible();
  const monthly = page.locator("main table", { has: page.locator("th", { hasText: "Expenses" }) });
  // still the stacked cards Classic shows on a phone
  expect(await monthly.evaluate((node) => getComputedStyle(node).display)).toBe("block");

  await open(page, "planner");
  await expect(page.getByRole("button", { name: "Export JSON" })).toBeVisible();
  expect(await page.locator("main .pocket-unscroll").evaluate((node) => getComputedStyle(node).overflowY)).toBe("auto");
});
