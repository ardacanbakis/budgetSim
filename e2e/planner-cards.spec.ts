import { expect, Locator, Page, test } from "@playwright/test";
import { pinRates } from "./support/rates";

// the same rates in every run, offline or in CI (see support/rates.ts)
test.beforeEach(async ({ page }) => {
  await pinRates(page);
});

/**
 * The Plan page's cards share one frame (components/plannerCard.tsx) and one
 * size system (lib/ui/plannerCards.ts): the same header, padding and footer
 * everywhere, a preset height that content scrolls inside instead of
 * stretching, rows of equal cards, a custom canvas that still opens a layout
 * saved before the presets, and Pocket without a scroll inside a card.
 */

const FORECAST_CARDS = [
  "chart",
  "projections",
  "milestones",
  "dev",
  "lost",
  "savings",
  "victvs",
  "funding",
  "items",
  "debt",
  "sales",
  "budgets",
];

async function enterDemo(page: Page, width = 1440, height = 1000) {
  await page.setViewportSize({ width, height });
  await page.goto("/welcome");
  await page.getByRole("button", { name: /demo/i }).click();
  await expect(page.getByText(/Net worth|Toplam varlık/).first()).toBeVisible({ timeout: 15_000 });
}

async function openPlan(page: Page, query = "") {
  await page.goto(`/planner${query}`);
  await expect(page.locator("main h1").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("[data-plan-card]").first()).toBeVisible({ timeout: 15_000 });
}

const box = async (el: Locator) => (await el.boundingBox())!;

test("every Forecast card sits in the shared frame, with one header height and one body padding", async ({ page }) => {
  await enterDemo(page);
  await openPlan(page);
  await expect(page.getByRole("button", { name: "Two columns" })).toHaveClass(/shadow-sm/);

  for (const id of FORECAST_CARDS) await expect(page.locator(`[data-plan-card="${id}"]`)).toHaveCount(1);
  // every card heading on the tab is a frame's heading
  const headings = page.locator("main h2");
  const count = await headings.count();
  expect(count).toBeGreaterThanOrEqual(FORECAST_CARDS.length);
  for (let i = 0; i < count; i++) {
    expect(await headings.nth(i).evaluate((h) => h.closest("[data-plan-card]") != null), await headings.nth(i).textContent() ?? "").toBe(true);
  }
  // the headline is a row of equal tiles
  const tiles = page.locator("[data-plan-tile]");
  expect(await tiles.count()).toBeGreaterThanOrEqual(4);
  const tileBoxes = await tiles.evaluateAll((els) => els.map((el) => el.parentElement!.getBoundingClientRect()).map((r) => ({ w: r.width, h: r.height })));
  for (const t of tileBoxes) {
    expect(Math.abs(t.w - tileBoxes[0].w)).toBeLessThanOrEqual(1);
    expect(Math.abs(t.h - tileBoxes[0].h)).toBeLessThanOrEqual(1);
  }

  // one header height, one body padding
  const headers = await page.locator("[data-plan-card-header]").evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
  for (const h of headers) expect(Math.abs(h - headers[0])).toBeLessThanOrEqual(0.5);
  const paddings = await page
    .locator("[data-plan-card-body]:not([data-fill])")
    .evaluateAll((els) => els.map((el) => { const s = getComputedStyle(el); return `${s.paddingTop} ${s.paddingRight} ${s.paddingBottom} ${s.paddingLeft}`; }));
  expect(new Set(paddings).size).toBe(1);

  // every card is its preset's height: S 272, M 416, L 560
  const heights: Record<string, number> = { S: 272, M: 416, L: 560 };
  for (const id of FORECAST_CARDS) {
    const card = page.locator(`[data-plan-card="${id}"]`);
    const size = (await card.getAttribute("data-size"))!;
    expect(Math.abs((await box(card)).height - heights[size]), id).toBeLessThanOrEqual(1);
  }
});

test("two columns: cards in a row line up, and a long card scrolls inside, then opens with Show all", async ({ page }) => {
  await enterDemo(page);
  await openPlan(page);

  const rows = page.locator('[data-plan-row][data-cols="2"]');
  const rowCount = await rows.count();
  let pairs = 0;
  for (let i = 0; i < rowCount; i++) {
    const cards = rows.nth(i).locator(":scope > [data-plan-card]");
    if ((await cards.count()) !== 2) continue;
    pairs++;
    const [a, b] = [await box(cards.nth(0)), await box(cards.nth(1))];
    expect(Math.abs(a.height - b.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(1);
    expect(b.x).toBeGreaterThan(a.x + a.width - 1); // side by side
  }
  expect(pairs).toBeGreaterThanOrEqual(4);

  // Everything sold holds years of months: it keeps its size and scrolls
  const sales = page.locator('[data-plan-card="sales"]');
  const budgets = page.locator('[data-plan-card="budgets"]');
  const body = sales.locator("[data-plan-card-body]");
  const toggle = sales.getByRole("button", { name: "Show all of Everything sold" });
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(sales.locator("[data-plan-card-fade]")).toBeVisible();
  expect(await body.evaluate((el) => getComputedStyle(el).overflowY)).toBe("auto");
  expect(await body.evaluate((el) => el.scrollHeight > el.clientHeight + 100)).toBe(true);
  const closed = await box(sales);
  expect(Math.abs(closed.height - 560)).toBeLessThanOrEqual(1);

  // scrolled to the end, the fade goes: there's nothing more below
  await body.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await expect(sales.locator("[data-plan-card-fade]")).toHaveCount(0);
  await body.evaluate((el) => el.scrollTo(0, 0));
  await expect(sales.locator("[data-plan-card-fade]")).toBeVisible();

  // Show all: the card grows to its content, the last month is in view on
  // the page, and its partner in the row stretches with it
  const lastMonth = body.locator(":scope > div > div > div").last();
  await toggle.click();
  const less = sales.getByRole("button", { name: "Show less of Everything sold" });
  await expect(less).toHaveAttribute("aria-expanded", "true");
  await expect(sales).toHaveAttribute("data-expanded", "true");
  expect(await body.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
  const open = await box(sales);
  expect(open.height).toBeGreaterThan(closed.height + 200);
  expect(Math.abs((await box(budgets)).height - open.height)).toBeLessThanOrEqual(1);
  await lastMonth.scrollIntoViewIfNeeded();
  await expect(lastMonth).toBeInViewport();
  await expect(sales.locator("[data-plan-card-fade]")).toHaveCount(0);

  // and back
  await less.click();
  await expect(sales.getByRole("button", { name: "Show all of Everything sold" })).toHaveAttribute("aria-expanded", "false");
  expect(Math.abs((await box(sales)).height - 560)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: "e2e/screenshots/planner-cards-two.png" });
});

test("single column: one card to a row, each at its preset height", async ({ page }) => {
  await enterDemo(page);
  await openPlan(page);
  await page.getByRole("button", { name: "Single column" }).click();
  await expect(page.locator('[data-plan-row][data-cols="2"]')).toHaveCount(0);
  const chart = await box(page.locator('[data-plan-card="chart"]'));
  const projections = await box(page.locator('[data-plan-card="projections"]'));
  expect(projections.y).toBeGreaterThan(chart.y + chart.height - 1);
  expect(Math.abs(projections.width - chart.width)).toBeLessThanOrEqual(1);
  expect(Math.abs((await box(page.locator('[data-plan-card="dev"]'))).height - 272)).toBeLessThanOrEqual(1);
});

test("custom canvas: a layout saved before the presets loads onto them", async ({ page }) => {
  await enterDemo(page);
  // an arrangement from the old free sizes: a 5-row table, a 3-wide card, a
  // 1×1 card, one id this build doesn't know, and no box for budgets at all
  await page.evaluate(() => {
    const boxes: Record<string, { x: number; y: number; w: number; h: number }> = {
      tiles: { x: 0, y: 0, w: 4, h: 1 },
      chart: { x: 0, y: 1, w: 2, h: 4 },
      projections: { x: 2, y: 1, w: 2, h: 5 },
      sales: { x: 0, y: 5, w: 3, h: 7 },
      dev: { x: 3, y: 6, w: 1, h: 1 },
      lost: { x: 3, y: 7, w: 1, h: 2 },
      victvs: { x: 0, y: 12, w: 2, h: 3 },
      funding: { x: 2, y: 12, w: 2, h: 4 },
      items: { x: 0, y: 16, w: 2, h: 3 },
      savings: { x: 2, y: 16, w: 2, h: 3 },
      debt: { x: 0, y: 19, w: 2, h: 3 },
      milestones: { x: 2, y: 19, w: 2, h: 2 },
      gone: { x: 0, y: 30, w: 2, h: 3 },
    };
    localStorage.setItem("renovator-planner-grid-v2", JSON.stringify({ boxes, hidden: [] }));
    localStorage.setItem("renovator-plan-view", "custom");
  });
  await openPlan(page);
  await expect(page.getByRole("button", { name: /^Custom$/ })).toHaveClass(/shadow-sm/);

  const boxOf = async (id: string) => (await page.locator(`[data-card="${id}"]`).getAttribute("data-box"))!.split(",").map(Number);
  expect(await boxOf("chart")).toEqual([0, 1, 2, 4]);
  expect(await boxOf("projections")).toEqual([2, 1, 2, 6]); // 5 rows → the next step, 6
  const sales = await boxOf("sales");
  expect(sales[2]).toBe(2); // 3 columns → 2
  expect(sales[3]).toBe(6); // 7 rows → 6
  expect(await boxOf("dev")).toEqual([3, 7, 1, 1]); // pushed clear of the taller projections
  // budgets had no box: it goes below everything placed
  const placed = await page.locator("[data-card]").evaluateAll((els) =>
    els.filter((el) => el.getAttribute("data-card") !== "budgets").map((el) => el.getAttribute("data-box")!.split(",").map(Number))
  );
  const floor = Math.max(...placed.map(([, y, , h]) => y + h));
  const budgets = await boxOf("budgets");
  expect(budgets[1]).toBeGreaterThanOrEqual(floor);
  expect(budgets.slice(2)).toEqual([2, 4]); // its preset, L

  // each frame fills its cell exactly
  for (const id of ["chart", "projections", "sales", "budgets"]) {
    const cell = await box(page.locator(`[data-card="${id}"]`));
    const frame = await box(page.locator(`[data-plan-card="${id}"]`));
    expect(Math.abs(frame.height - cell.height), id).toBeLessThanOrEqual(1);
  }
  // cards in a row of the canvas line up
  const chartBox = await box(page.locator('[data-plan-card="chart"]'));
  expect(Math.abs((await box(page.locator('[data-plan-card="victvs"]'))).height - (await box(page.locator('[data-plan-card="items"]'))).height)).toBeLessThanOrEqual(1);
  expect(chartBox.height).toBeGreaterThan(500);

  // Show all on the canvas grows the card over what's below, then closes
  const card = page.locator('[data-plan-card="sales"]');
  const before = await box(card);
  await card.getByRole("button", { name: "Show all of Everything sold" }).click();
  await expect(card).toHaveAttribute("data-expanded", "true");
  expect((await box(card)).height).toBeGreaterThan(before.height);
  await card.getByRole("button", { name: "Show less of Everything sold" }).click();
  expect(Math.abs((await box(card)).height - before.height)).toBeLessThanOrEqual(1);

  // the editor steps through the allowed sizes
  await page.getByRole("button", { name: /Edit layout/i }).click();
  await page.getByRole("button", { name: /^Narrower: Projections$/ }).click();
  expect(await boxOf("projections")).toEqual([2, 1, 1, 6]);
  await page.getByRole("button", { name: /^Shorter: Projections$/ }).click();
  expect(await boxOf("projections")).toEqual([2, 1, 1, 4]);
  await page.screenshot({ path: "e2e/screenshots/planner-cards-custom.png" });
});

test("Evim sistemi and the loan simulator use the same frame", async ({ page }) => {
  await enterDemo(page);
  for (const [query, ids] of [
    ["?tab=evim", ["evim-inputs", "evim-compliance", "evim-summary", "evim-chart", "evim-delay", "evim-schedule"]],
    ["?tab=loan", ["loan-simulator", "loan-tracked"]],
  ] as const) {
    await openPlan(page, query);
    for (const id of ids) await expect(page.locator(`[data-plan-card="${id}"]`)).toHaveCount(1);
    const headings = page.locator("main h2");
    const count = await headings.count();
    for (let i = 0; i < count; i++) expect(await headings.nth(i).evaluate((h) => h.closest("[data-plan-card]") != null)).toBe(true);
  }
  // the long schedule keeps to its size behind Show all
  await openPlan(page, "?tab=evim");
  const schedule = page.locator('[data-plan-card="evim-schedule"]');
  await expect(schedule.getByRole("button", { name: /^Show all of Schedule$/ })).toHaveAttribute("aria-expanded", "false");
});

test.describe("Pocket", () => {
  async function enterPocket(page: Page) {
    await enterDemo(page, 390, 844);
    await page.evaluate(() => localStorage.setItem("renovator-phone-layout", "pocket"));
    await page.reload();
    await expect(page.locator("[data-pocket-shell]")).toBeVisible({ timeout: 15_000 });
  }

  /** elements in main that scroll on their own, rather than with the page */
  const innerScrollers = (page: Page) =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll("main *"))
        .filter((el) => {
          const s = getComputedStyle(el);
          return /(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 1;
        })
        .map((el) => el.getAttribute("data-plan-card") ?? el.className.toString().slice(0, 60))
    );

  test("390px: full-width cards, no sideways scroll, nothing scrolling inside a card", async ({ page }) => {
    await enterPocket(page);
    for (const query of ["", "?tab=evim", "?tab=loan"]) {
      await openPlan(page, query);
      await page.waitForTimeout(400);
      const wide = await page.evaluate(() => document.scrollingElement!.scrollWidth - document.documentElement.clientWidth);
      expect(wide, query).toBeLessThanOrEqual(0);
      expect(await innerScrollers(page), query).toEqual([]);
      // stacked, every one as wide as the next
      const widths = await page.locator("[data-plan-card]").evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().width)));
      expect(widths.length).toBeGreaterThan(1);
      for (const w of widths) expect(Math.abs(w - widths[0])).toBeLessThanOrEqual(1);
      expect(widths[0]).toBeGreaterThan(390 - 2 * 24);
    }

    // a long card shows its first part; Show all opens the rest in the page
    await openPlan(page);
    const sales = page.locator('[data-plan-card="sales"]');
    const body = sales.locator("[data-plan-card-body]");
    expect(await body.evaluate((el) => getComputedStyle(el).overflowY)).toBe("clip");
    const toggle = sales.getByRole("button", { name: "Show all of Everything sold" });
    await toggle.scrollIntoViewIfNeeded();
    await expect(toggle).toBeVisible();
    const closed = await box(sales);
    await toggle.click();
    await expect(sales).toHaveAttribute("data-expanded", "true");
    expect(await body.evaluate((el) => getComputedStyle(el).overflowY)).toBe("visible");
    expect((await box(sales)).height).toBeGreaterThan(closed.height + 200);
    expect(await innerScrollers(page)).toEqual([]);

    // the chart keeps its proportions
    const chart = await box(page.locator('[data-plan-card="chart"] [data-plan-card-body]'));
    expect(chart.height).toBeGreaterThan(chart.width * 0.6);
    expect(chart.height).toBeLessThan(chart.width);
    await page.screenshot({ path: "e2e/screenshots/planner-cards-pocket.png", fullPage: true });
  });
});
