import { expect, Page, test } from "@playwright/test";
import { pinRates } from "./support/rates";

// the same rates in every run, offline or in CI (see support/rates.ts)
test.beforeEach(async ({ page }) => {
  await pinRates(page);
});

/**
 * Pocket's smaller extras: the new-card sheet that opens as a card, the
 * quotes in the display-currency sheet, pull-to-refresh, and swiping a row.
 * Runs in the demo at 390×844 with the Pocket phone layout switched on.
 */

const DEMO_KEY = "renovator-demo-v5";

interface StoredAccount {
  id: string;
  name: string;
  kind: string;
  archived: boolean;
}
interface Store {
  accounts: StoredAccount[];
  transactions: Array<{ id: string; description: string; status: string }>;
}

const store = (page: Page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}") as Store, DEMO_KEY);

async function enterPocket(page: Page, opts: { path?: string; locale?: "tr"; edit?: (store: Store) => void } = {}) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/welcome");
  await page.getByRole("button", { name: /demo/i }).click();
  await expect(page.getByText(/Net worth|Toplam varlık/).first()).toBeVisible({ timeout: 15_000 });
  await page.evaluate(
    ({ locale }) => {
      localStorage.setItem("renovator-phone-layout", "pocket");
      localStorage.removeItem("renovator-cards-tab");
      localStorage.removeItem("renovator-pocket-hide-amounts");
      if (locale) localStorage.setItem("renovator-locale", locale);
    },
    { locale: opts.locale }
  );
  if (opts.edit) {
    const saved = await store(page);
    opts.edit(saved);
    await page.evaluate(([key, value]) => localStorage.setItem(key, value), [DEMO_KEY, JSON.stringify(saved)] as const);
  }
  await page.goto(opts.path ?? "/");
  await expect(page.locator("[data-pocket-shell]")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("h1[data-pocket-title]")).toBeVisible({ timeout: 15_000 });
}

test.describe("Pocket: a new card opens as a card", () => {
  test("Cards' New account starts with Credit card ticked", async ({ page }) => {
    // no active card, so Cards offers to add one
    await enterPocket(page, {
      path: "/cards",
      edit: (s) => {
        for (const a of s.accounts) if (a.kind === "credit_card") a.archived = true;
      },
    });
    await expect(page.getByText("No active cards.")).toBeVisible();
    await page.getByRole("button", { name: "New account" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("button", { name: /Credit card/ })).toHaveAttribute("aria-pressed", "true");
    await expect(sheet.getByRole("button", { name: "Bank / cash" })).toHaveAttribute("aria-pressed", "false");
    // the card fields are there without a tap
    await expect(sheet.getByText("Payment day")).toBeVisible();

    await sheet.getByLabel("Name").fill("Travel Card");
    await sheet.getByRole("button", { name: "Save" }).click();
    await expect(sheet).toBeHidden();
    await expect.poll(async () => (await store(page)).accounts.find((a) => a.name === "Travel Card")?.kind).toBe("credit_card");
  });

  test("Portfolio's New account still starts as a bank account", async ({ page }) => {
    await enterPocket(page, { path: "/accounts" });
    await page.getByRole("button", { name: "New account" }).first().click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("button", { name: /Credit card/ })).toHaveAttribute("aria-pressed", "false");
  });
});

test.describe("Pocket: quotes in the currency sheet", () => {
  test("every currency shows how it's quoted", async ({ page }) => {
    await enterPocket(page);
    await page.getByRole("button", { name: /Display currency/ }).click();
    const sheet = page.getByRole("dialog");
    const radios = sheet.getByRole("radio");
    await expect(radios).toHaveCount(5);
    // pinned rates: 41.80 TRY a dollar, 1.09 dollars a euro, 78.50 dollars a gram
    // in the order the sheet lists them: TRY, USD, EUR, BTC, gold
    const expected = ["TRY/USD 0.0239", "USD/TRY 41.80", "EUR/TRY 45.56", "BTC/USD 104,000", "GRAM GOLD/TRY 3,281"];
    for (const [i, quote] of expected.entries()) {
      await expect(radios.nth(i).locator("[data-quote]")).toHaveText(quote);
    }
    // the pinned table has no day-old figures, so no row invents a move
    await expect(sheet.locator("[data-quote]").filter({ hasText: /[▲▼]/ })).toHaveCount(0);
  });

  test("a day's move shows where the rates have one", async ({ page }) => {
    await pinRates(page, { prevUsdPer: { TRY: 1 / 41, EUR: 1.08 } });
    await enterPocket(page);
    await page.getByRole("button", { name: /Display currency/ }).click();
    const sheet = page.getByRole("dialog");
    // EUR/TRY has both legs a day back; USD and gold have no history
    const radios = sheet.getByRole("radio");
    await expect(radios.nth(2).locator("[data-quote]")).toContainText(/^EUR\/TRY 45\.56 ▲ \d+\.\d\d%$/);
    await expect(radios.nth(1).locator("[data-quote]")).toHaveText("USD/TRY 41.80");
    await expect(radios.nth(4).locator("[data-quote]")).not.toContainText(/[▲▼]/);
  });
});

/** A finger on the screen, through the DevTools protocol: real touch events, in order. */
async function finger(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  const send = (type: "touchStart" | "touchMove" | "touchEnd", x = 0, y = 0) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
  return {
    /** press at (x, y), then move in steps to (x + dx, y + dy); the finger stays down */
    async drag(x: number, y: number, dx: number, dy: number, steps = 8) {
      await send("touchStart", x, y);
      for (let i = 1; i <= steps; i++) await send("touchMove", x + (dx * i) / steps, y + (dy * i) / steps);
    },
    /** the finger, still down, moves to (x, y) */
    moveTo: (x: number, y: number) => send("touchMove", x, y),
    lift: () => send("touchEnd"),
  };
}

test.describe("Pocket: pull to refresh", () => {
  test.use({ hasTouch: true });

  const indicator = (page: Page) => page.locator("[data-pull-indicator]");
  const status = (page: Page) => page.locator("[data-pull-status]");

  test("a pull down from the top fetches everything again", async ({ page }) => {
    const rateCalls: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/rates")) rateCalls.push(r.url());
    });
    await enterPocket(page);
    await expect.poll(() => rateCalls.length).toBeGreaterThan(0);
    const before = rateCalls.length;

    const f = await finger(page);
    await f.drag(195, 200, 0, 40);
    await expect(indicator(page)).toHaveAttribute("data-pull-indicator", "pulling");
    await f.moveTo(195, 420);
    await expect(indicator(page)).toHaveAttribute("data-pull-indicator", "armed");
    await expect(status(page)).toHaveText("Release to refresh");
    await f.lift();
    await expect(status(page)).toHaveText("Up to date");
    await expect(indicator(page)).toHaveAttribute("data-pull-indicator", "idle");
    expect(rateCalls.length).toBeGreaterThan(before);
  });

  test("a short pull puts it back without refreshing", async ({ page }) => {
    await enterPocket(page);
    const f = await finger(page);
    await f.drag(195, 200, 0, 50);
    await expect(indicator(page)).toHaveAttribute("data-pull-indicator", "pulling");
    await f.lift();
    await expect(indicator(page)).toHaveAttribute("data-pull-indicator", "idle");
    await expect(status(page)).toHaveText("");
  });

  test("never with a sheet open, below the top, or for a sideways drag", async ({ page }) => {
    await enterPocket(page, { path: "/transactions" });
    const f = await finger(page);

    // sideways first: that's a row's swipe or a strip's scroll
    await f.drag(100, 300, 60, 20);
    await f.moveTo(160, 520);
    await expect(indicator(page)).toHaveAttribute("data-pull-indicator", "ignored");
    await f.lift();

    // below the top of the page
    await page.evaluate(() => window.scrollTo(0, 300));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    await f.drag(195, 300, 0, 220);
    await expect(indicator(page)).toHaveAttribute("data-pull-indicator", "ignored");
    await f.lift();
    await page.evaluate(() => window.scrollTo(0, 0));

    // a sheet open
    await page.getByRole("button", { name: /Display currency/ }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await f.drag(195, 60, 0, 220);
    await expect(indicator(page)).toHaveAttribute("data-pull-indicator", "ignored");
    await f.lift();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(status(page)).toHaveText("");
  });

  test("in Turkish", async ({ page }) => {
    await enterPocket(page, { locale: "tr" });
    const f = await finger(page);
    await f.drag(195, 200, 0, 220);
    await expect(status(page)).toHaveText("Yenilemek için bırak");
    await f.lift();
    await expect(status(page)).toHaveText("Güncel");
  });
});

test.describe("Pocket: swiping a row", () => {
  test.use({ hasTouch: true });

  /** planned rows past their date, cloned from the demo's Weekly market */
  const overdueRows = (rows: Array<[string, number]>) => (s: Store) => {
    const model = s.transactions.find((t) => t.description === "Weekly market")!;
    for (const [description, daysAgo] of rows) {
      const d = new Date();
      d.setDate(d.getDate() - daysAgo);
      const dueDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      s.transactions.push({ ...model, id: crypto.randomUUID(), description, dueDate, status: "planned", completedAt: null } as Store["transactions"][number]);
    }
  };
  const needsRow = (page: Page, text: string) => page.locator("#needs-action li").filter({ hasText: text });
  const statusOf = async (page: Page, description: string) =>
    (await store(page)).transactions.find((t) => t.description === description)?.status;

  /** a sideways drag across a row, starting `from` px in from its left edge; the finger stays down */
  async function dragRow(page: Page, row: ReturnType<Page["locator"]>, from: number, dx: number) {
    // to the middle, not just "in view": a row at the bottom edge sits under
    // the fixed tab bar, and the swipe would land on the bar instead
    await row.evaluate((el) => el.scrollIntoView({ block: "center" }));
    const box = (await row.boundingBox())!;
    const f = await finger(page);
    await f.drag(box.x + from, box.y + box.height / 2, dx, 0, 10);
    return f;
  }

  test("right marks a planned row paid, with Undo; the hint shows while dragging", async ({ page }) => {
    await enterPocket(page, { path: "/transactions", edit: overdueRows([["Gym fee", 3]]) });
    const row = needsRow(page, "Gym fee");
    await expect(row).toBeVisible({ timeout: 15_000 });

    const f = await dragRow(page, row, 40, 140);
    await expect(row).toHaveAttribute("data-swipe", "right");
    await expect(row).toHaveAttribute("data-swipe-armed", "");
    await expect(row.locator("[data-swipe-hint=right]")).toHaveText("Paid");
    await f.lift();

    const snack = page.locator("[role=status]").filter({ hasText: /Marked paid/ });
    await expect(snack).toBeVisible();
    await expect.poll(() => statusOf(page, "Gym fee")).toBe("completed");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await snack.getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => statusOf(page, "Gym fee")).toBe("planned");
  });

  test("left opens the row's actions", async ({ page }) => {
    await enterPocket(page, { path: "/transactions", edit: overdueRows([["Gym fee", 3]]) });
    const row = needsRow(page, "Gym fee");
    await expect(row).toBeVisible({ timeout: 15_000 });
    const f = await dragRow(page, row, 320, -140);
    await expect(row).toHaveAttribute("data-swipe", "left");
    await expect(row.locator("[data-swipe-hint=left]")).toHaveText("Options");
    await f.lift();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("heading", { name: "Gym fee" })).toBeVisible();
    // nothing was written
    expect(await statusOf(page, "Gym fee")).toBe("planned");

    // a completed row in the history swipes left too
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    const done = page.locator("main section[aria-labelledby] li").first();
    const title = (await done.locator("span.block.truncate").first().textContent())!.trim();
    await (await dragRow(page, done, 320, -140)).lift();
    await expect(page.getByRole("dialog").getByRole("heading", { name: title, exact: true })).toBeVisible();
  });

  test("a short or vertical drag does nothing, and neither does a swipe in selection mode", async ({ page }) => {
    await enterPocket(page, { path: "/transactions", edit: overdueRows([["Gym fee", 3]]) });
    const row = needsRow(page, "Gym fee");
    await expect(row).toBeVisible({ timeout: 15_000 });

    // short of the threshold: the row goes back, no sheet, no write
    let f = await dragRow(page, row, 40, 50);
    await expect(row).toHaveAttribute("data-swipe", "right");
    await expect(row).not.toHaveAttribute("data-swipe-armed", "");
    await f.lift();
    await expect(row).not.toHaveAttribute("data-swipe", /.*/);
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // vertical: a scroll, not a swipe
    const box = (await row.boundingBox())!;
    f = await finger(page);
    await f.drag(box.x + 40, box.y + box.height / 2, 10, 120, 10);
    await expect(row).not.toHaveAttribute("data-swipe", /.*/);
    await f.lift();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // selection mode: rows choose, they don't swipe
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await expect(page.locator("[data-selection-bar]")).toBeVisible();
    f = await dragRow(page, row, 40, 140);
    await expect(row).not.toHaveAttribute("data-swipe", /.*/);
    await f.lift();
    expect(await statusOf(page, "Gym fee")).toBe("planned");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("in Turkish, and brought back before letting go does nothing", async ({ page }) => {
    await enterPocket(page, { path: "/transactions", locale: "tr", edit: overdueRows([["Gym fee", 3]]) });
    const row = needsRow(page, "Gym fee");
    await expect(row).toBeVisible({ timeout: 15_000 });
    const box = (await row.boundingBox())!;
    let f = await dragRow(page, row, 40, 140);
    await expect(row.locator("[data-swipe-hint=right]")).toHaveText("Ödendi");
    await expect(row).toHaveAttribute("data-swipe-armed", "");
    await f.moveTo(box.x + 50, box.y + box.height / 2);
    await expect(row).not.toHaveAttribute("data-swipe-armed", "");
    await f.lift();
    await expect(row).not.toHaveAttribute("data-swipe", /.*/);
    expect(await statusOf(page, "Gym fee")).toBe("planned");

    f = await dragRow(page, row, 320, -140);
    await expect(row.locator("[data-swipe-hint=left]")).toHaveText("Seçenekler");
    await f.lift();
    await expect(page.getByRole("dialog")).toBeVisible();
  });
});
