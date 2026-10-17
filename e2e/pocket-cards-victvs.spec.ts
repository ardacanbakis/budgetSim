import { expect, Locator, Page, test } from "@playwright/test";

/**
 * Pocket's Cards (/cards) and VICTVS (/victvs): a tile per card with this
 * statement, what's owed and Record payment; big purchases with a sheet for
 * Reflect and Delete; VICTVS sessions selected by tap or by half-month and
 * marked paid from a bar above the tab bar. Runs in the demo at 390×844 with
 * the Pocket phone layout switched on (and once with it off, for parity).
 */

const DEMO_KEY = "renovator-demo-v5";
const SHOTS = "e2e/screenshots";
const TAB_BAR = 56;

interface StoredAccount {
  id: string;
  name: string;
  creditLimit?: number | null;
}
interface StoredPurchase {
  id: string;
  name: string;
  reflected: boolean;
}
interface StoredSession {
  id: string;
  date: string;
  sessionNo: string;
  amount: number;
  status: "unpaid" | "paid";
}
interface Store {
  accounts: StoredAccount[];
  purchases: StoredPurchase[];
  transactions: Array<{ id: string; purchaseId?: string | null }>;
  victvsSessions: StoredSession[];
  victvsPayouts: Array<{ id: string; total: number; accountId: string }>;
  settings: { victvsAccountId: string | null };
}

async function enterDemo(page: Page, opts: { pocket?: boolean; locale?: "tr"; edit?: (store: Store) => void } = {}) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/welcome");
  await page.getByRole("button", { name: /demo/i }).click();
  await expect(page.getByText(/Net worth|Toplam varlık/).first()).toBeVisible({ timeout: 15_000 });
  await page.evaluate(
    ({ pocket, locale }) => {
      if (pocket) localStorage.setItem("renovator-phone-layout", "pocket");
      else localStorage.removeItem("renovator-phone-layout");
      localStorage.removeItem("renovator-cards-tab");
      localStorage.removeItem("renovator-pocket-hide-amounts");
      if (locale) localStorage.setItem("renovator-locale", locale);
    },
    { pocket: opts.pocket ?? true, locale: opts.locale }
  );
  if (opts.edit) {
    const saved = await store(page);
    opts.edit(saved);
    await page.evaluate(([key, value]) => localStorage.setItem(key, value), [DEMO_KEY, JSON.stringify(saved)] as const);
  }
  await page.reload();
}

async function openCards(page: Page, opts: Parameters<typeof enterDemo>[1] = {}) {
  await enterDemo(page, opts);
  await page.goto("/cards");
  await expect(page.locator("[data-pocket-shell]")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("[data-card-tile]").first()).toBeVisible({ timeout: 15_000 });
}

async function openVictvs(page: Page, opts: Parameters<typeof enterDemo>[1] = {}) {
  await enterDemo(page, opts);
  await page.goto("/victvs");
  await expect(page.locator("[data-pocket-shell]")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("[data-victvs-summary]")).toBeVisible({ timeout: 15_000 });
}

const store = (page: Page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}") as Store, DEMO_KEY);
const tile = (page: Page, name: string) => page.locator(`[data-card-tile="${name}"]`);
const sheet = (page: Page) => page.getByRole("dialog");
const bar = (page: Page) => page.locator("[data-selection-bar]");
const sessionRow = (page: Page, no: string) => page.locator(`[data-session-row="${no}"]`);

/** yyyy-mm of this month and the one before, as the demo seeds them. */
function demoMonths() {
  const now = new Date();
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const last = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastDay = new Date(last.getFullYear(), last.getMonth() + 1, 0).getDate();
  const name = (d: Date, style: "long" | "short") => new Intl.DateTimeFormat("en-US", { month: style }).format(d);
  return { thisMonth: iso(now), lastMonth: iso(last), lastLong: name(last, "long"), lastShort: name(last, "short"), lastDay };
}

/** Let transitions (the segment's pill, the header's border) finish before a screenshot. */
async function settle(page: Page) {
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

async function bottomOf(locator: Locator): Promise<number> {
  const box = await locator.boundingBox();
  if (!box) throw new Error("not on screen");
  return box.y + box.height;
}

/** The demo's three unpaid sessions from last month, by session number. */
const SEP = { first: ["32138", "79668"], second: ["36951"] };

test.describe("Pocket off: Cards and VICTVS stay Classic", () => {
  test("a phone without the setting gets the Classic pages", async ({ page }) => {
    await enterDemo(page, { pocket: false });
    await page.goto("/cards");
    await expect(page.getByRole("heading", { level: 1, name: "Cards" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "+ New purchase" })).toBeVisible();
    await expect(page.locator("[data-pocket-shell]")).toHaveCount(0);
    await expect(page.locator("[data-card-tile]")).toHaveCount(0);

    await page.goto("/victvs");
    await expect(page.getByRole("heading", { level: 1, name: "VICTVS Sessions" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "1st half" }).first()).toBeVisible();
    await expect(page.locator("[data-pocket-shell]")).toHaveCount(0);
    await expect(page.locator("[data-victvs-summary]")).toHaveCount(0);
  });
});

test.describe("Pocket cards", () => {
  test("the Bonus Card tile: this statement, what's owed, and Record payment with the Cards page's figure", async ({ page }) => {
    await openCards(page);
    await expect(page.getByRole("heading", { level: 1, name: "Cards" })).toBeVisible();

    const tabs = page.getByRole("tablist", { name: "Cards" });
    await expect(tabs.getByRole("tab")).toHaveText(["Cards", "Big purchases"]);
    await expect(tabs.getByRole("tab", { name: "Cards" })).toHaveAttribute("aria-selected", "true");
    await expect(tabs.getByRole("tab", { name: "Big purchases" })).toHaveAttribute("aria-selected", "false");

    const card = tile(page, "Bonus Card");
    await expect(card.getByRole("heading", { level: 2, name: "Bonus Card" })).toBeVisible();
    const statement = card.locator("[data-card-statement]");
    await expect(statement).toContainText("This statement");
    await expect(statement.locator("[data-figure=xl]")).toHaveText("₺20,220.30");
    // large: the hero size, not a row's
    const size = await statement.locator("[data-figure=xl]").evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(size).toBeGreaterThanOrEqual(28);
    await expect(card.locator("[data-card-owed]")).toHaveText("Total owed ₺90,220.30 · 5 months to go");
    await expect(card.locator("[data-card-due]")).toHaveText(/^Due [A-Z][a-z]{2} 15 · (Today|Tomorrow|in \d+ days|\d+ days? late)$/);

    // the months still to pay after this one, as chips
    await expect(card.locator("[data-card-timeline] li")).toHaveCount(5);
    await expect(card.locator("[data-card-timeline] li").first()).toContainText("₺14,000.00");

    // Record payment: full width, 44px, and the Cards page's suggestion
    const pay = card.getByRole("button", { name: "Record payment — Bonus Card" });
    const payBox = (await pay.boundingBox())!;
    const tileBox = (await card.boundingBox())!;
    expect(payBox.height).toBeGreaterThanOrEqual(44);
    expect(payBox.width).toBeGreaterThanOrEqual(tileBox.width - 34);
    await page.screenshot({ path: `${SHOTS}/pocket-cards-cards-light.png` });

    await pay.click();
    await expect(sheet(page).getByRole("heading", { name: /Record payment — Bonus Card/ })).toBeVisible();
    await expect(sheet(page).getByLabel("Amount (TRY)")).toHaveValue("20220.3");
    await page.keyboard.press("Escape");
    await expect(sheet(page)).toBeHidden();
  });

  test("recording the payment marks the month paid and moves what's owed", async ({ page }) => {
    await openCards(page);
    const card = tile(page, "Bonus Card");
    await card.getByRole("button", { name: "Record payment — Bonus Card" }).click();
    const s = sheet(page);
    await expect(s.getByLabel("Amount (TRY)")).toHaveValue("20220.3");
    await s.getByRole("button", { name: "Record payment" }).click();
    await expect(s).toBeHidden();

    await expect(card.locator("[data-card-due]")).toHaveText("Paid this month");
    await expect(card.locator("[data-card-statement]")).toContainText("Nothing to pay this month");
    await expect(card.locator("[data-card-owed]")).toHaveText("Total owed ₺70,000.00 · 5 months to go");
    await expect(card.getByText("Payments recorded")).toBeVisible();
    await expect(card.locator("li").filter({ hasText: "Bonus Card statement" })).toContainText("−₺20,220.30");
  });

  test("a credit limit draws the bar: amber from 80%", async ({ page }) => {
    await openCards(page, {
      edit: (s) => {
        s.accounts.find((a) => a.name === "Bonus Card")!.creditLimit = 100000;
      },
    });
    const limit = tile(page, "Bonus Card").locator("[data-card-limit]");
    await expect(limit).toContainText("Used ₺90,220.30 of ₺100,000.00");
    const bar = limit.getByRole("progressbar");
    await expect(bar).toHaveAttribute("aria-valuenow", "90");
    await expect(bar.locator("div")).toHaveClass(/bg-amber-500/);
    const height = (await bar.boundingBox())!.height;
    expect(height).toBe(6);
  });

  test("⋯ edits the card in a sheet", async ({ page }) => {
    await openCards(page);
    await tile(page, "Bonus Card").getByRole("button", { name: "Options for Bonus Card" }).click();
    await expect(sheet(page).getByRole("heading", { name: "Bonus Card" })).toBeVisible();
    // the card owes money, so it can't be retired
    await expect(sheet(page).getByRole("button", { name: /Retire this card/ })).toHaveCount(0);
    await sheet(page).getByRole("button", { name: "Edit" }).click();
    await expect(sheet(page).getByRole("heading", { name: "Edit" })).toBeVisible();
    await expect(sheet(page).locator("input").first()).toHaveValue("Bonus Card");
    await page.keyboard.press("Escape");
    await expect(sheet(page)).toBeHidden();
  });

  test("big purchases: grouped by card, progress on the row, Reflect warns in the sheet", async ({ page }) => {
    await openCards(page);
    await tile(page, "Bonus Card").getByRole("button", { name: "1 big purchase on this card" }).click();
    const tabs = page.getByRole("tablist", { name: "Cards" });
    await expect(tabs.getByRole("tab", { name: "Big purchases" })).toHaveAttribute("aria-selected", "true");

    await expect(page.locator("[data-purchase-group]")).toHaveCount(2);
    await expect(page.locator("[data-purchase-group]").nth(0).getByRole("heading")).toHaveText("Bonus Card");
    await expect(page.locator("[data-purchase-group]").nth(1).getByRole("heading")).toHaveText("Other accounts");

    const phone = page.locator('[data-purchase-row="iPhone 17"]');
    await expect(phone).toContainText(/\d\/6 · ₺[\d,]+\.\d\d left/);
    await expect(phone).toContainText("₺84,000.00");
    expect((await phone.boundingBox())!.height).toBeGreaterThanOrEqual(56);
    await settle(page);
    await page.screenshot({ path: `${SHOTS}/pocket-cards-purchases-light.png` });

    // Reflect: the warning shows in the sheet, never a browser confirm
    page.on("dialog", () => {
      throw new Error("window.confirm should not be used");
    });
    await phone.click();
    const s = sheet(page);
    await expect(s.getByRole("heading", { name: "iPhone 17" })).toBeVisible();
    const reflect = s.getByRole("switch", { name: "Reflect on the account" });
    await expect(reflect).toHaveAttribute("aria-checked", "true");
    await reflect.click();
    await expect(s.locator("[data-reflect-warning]")).toContainText("Turning this off deletes the purchase's transactions");
    await page.screenshot({ path: `${SHOTS}/pocket-cards-purchase-sheet-light.png` });
    await s.getByRole("button", { name: "Cancel" }).click();
    await expect(s.locator("[data-reflect-warning]")).toHaveCount(0);
    await expect(reflect).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");

    // turning Reflect on for the log-only washing machine writes its transactions
    const before = await store(page);
    const machine = before.purchases.find((p) => p.name === "Washing machine")!;
    expect(machine.reflected).toBe(false);
    await page.locator('[data-purchase-row="Washing machine"]').click();
    await sheet(page).getByRole("switch", { name: "Reflect on the account" }).click();
    await expect(sheet(page).locator("[data-reflect-warning]")).toContainText("This will (re)create the purchase's transactions");
    await sheet(page).getByRole("button", { name: "Confirm" }).click();
    await expect(sheet(page).getByRole("switch", { name: "Reflect on the account" })).toHaveAttribute("aria-checked", "true");
    await expect
      .poll(async () => (await store(page)).transactions.filter((tx) => tx.purchaseId === machine.id).length)
      .toBeGreaterThan(0);
  });

  test("deleting a reflected purchase asks whether its transactions go too", async ({ page }) => {
    await openCards(page);
    await page.getByRole("tab", { name: "Big purchases" }).click();
    const phoneId = (await store(page)).purchases.find((p) => p.name === "iPhone 17")!.id;
    await page.locator('[data-purchase-row="iPhone 17"]').click();
    const s = sheet(page);
    await s.getByRole("button", { name: "Delete purchase" }).click();
    await expect(s.getByRole("button", { name: "Tap again to confirm" })).toBeVisible();
    await s.getByRole("button", { name: "Tap again to confirm" }).click();
    await expect(s.getByRole("button", { name: "Also delete its transactions (posted and planned)" })).toBeVisible();
    await s.getByRole("button", { name: "Keep its transactions in the ledger" }).click();
    await expect(s).toBeHidden();
    await expect(page.locator('[data-purchase-row="iPhone 17"]')).toHaveCount(0);
    const after = await store(page);
    expect(after.purchases.some((p) => p.id === phoneId)).toBe(false);
  });

  test("the Add menu's Card purchase opens the purchase form as a sheet, and the link is cleared", async ({ page }) => {
    await openCards(page);
    await page.goto("/");
    await expect(page.locator("[data-pocket-shell]")).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Add", exact: true }).click({ button: "right" });
    await sheet(page).getByRole("button", { name: "Card purchase" }).click();
    await expect(page).toHaveURL(/\/cards$/);
    await expect(sheet(page).getByRole("heading", { name: "New purchase" })).toBeVisible({ timeout: 15_000 });
    await expect(sheet(page).getByLabel("Name")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet(page)).toBeHidden();
    // the link is spent: a reload doesn't open the form again
    await page.reload();
    await expect(page.locator("[data-card-tile]").first()).toBeVisible({ timeout: 15_000 });
    await expect(sheet(page)).toHaveCount(0);
  });

  test("Turkish: the tile reads naturally", async ({ page }) => {
    await openCards(page, { locale: "tr" });
    const card = tile(page, "Bonus Card");
    await expect(card.locator("[data-card-statement]")).toContainText("Bu ekstre");
    await expect(card.locator("[data-card-owed]")).toHaveText("Toplam borç ₺90.220,30 · 5 ay kaldı");
    await expect(card.getByRole("button", { name: /^Ödeme kaydet/ })).toBeVisible();
  });
});

test.describe("Pocket VICTVS", () => {
  test("summary, months, and three taps make a selection bar above the tab bar", async ({ page }) => {
    const m = demoMonths();
    await openVictvs(page);
    await expect(page.getByRole("heading", { level: 1, name: "VICTVS" })).toBeVisible();
    const summary = page.locator("[data-victvs-summary]");
    await expect(summary.locator("[data-figure=xl]")).toHaveText("$187.50");
    await expect(summary).toContainText("4 sessions");
    await expect(summary).toHaveAccessibleName("Unpaid $187.50");

    // this month: one session, singular
    const current = page.locator(`[data-victvs-month="${m.thisMonth}"]`);
    await expect(current).toContainText("1 session · $30.00 · 1 unpaid");
    const last = page.locator(`[data-victvs-month="${m.lastMonth}"]`);
    await expect(last.getByRole("heading")).toHaveText(m.lastLong);
    await expect(last).toContainText("3 sessions · $157.50 · 3 unpaid");

    // rows are buttons: unpaid ones toggle, with the state in the name
    const rows = [...SEP.first, ...SEP.second].map((no) => sessionRow(page, no));
    for (const row of rows) {
      await expect(row).toHaveAttribute("aria-pressed", "false");
      await expect(row).toHaveAccessibleName(/, Unpaid$/);
      expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(56);
    }
    await page.screenshot({ path: `${SHOTS}/pocket-cards-victvs-light.png` });

    for (const row of rows) await row.click();
    for (const row of rows) await expect(row).toHaveAttribute("aria-pressed", "true");
    await expect(bar(page).locator("[data-selection-summary]")).toHaveText("3 selected · $157.50");
    await expect(bar(page).getByRole("button", { name: "Mark paid" })).toBeEnabled();
    expect(await bottomOf(bar(page))).toBeLessThanOrEqual(844 - TAB_BAR);
    await page.screenshot({ path: `${SHOTS}/pocket-cards-victvs-selected-light.png` });

    // tapping again takes one away
    await rows[2].click();
    await expect(bar(page).locator("[data-selection-summary]")).toHaveText("2 selected · $97.50");
    await bar(page).getByRole("button", { name: "Clear selection" }).click();
    await expect(bar(page)).toHaveCount(0);
  });

  test("Mark paid opens the form on the default account, and saving clears the selection", async ({ page }) => {
    await openVictvs(page);
    const s0 = await store(page);
    const wise = s0.accounts.find((a) => a.id === s0.settings.victvsAccountId)!;
    for (const no of [...SEP.first, ...SEP.second]) await sessionRow(page, no).click();
    await bar(page).getByRole("button", { name: "Mark paid" }).click();

    const s = sheet(page);
    await expect(s.getByRole("heading", { name: "Mark 3 sessions as paid" })).toBeVisible();
    await expect(s.getByLabel(/Deposit account/)).toHaveValue(wise.id);
    await s.getByRole("button", { name: "Confirm" }).click();
    await expect(s).toBeHidden();
    await expect(bar(page)).toHaveCount(0);
    await expect(page.locator("[role=status]").filter({ hasText: "Marked paid · $157.50" })).toBeVisible();

    const after = await store(page);
    const nos = new Set([...SEP.first, ...SEP.second]);
    expect(after.victvsSessions.filter((x) => nos.has(x.sessionNo)).every((x) => x.status === "paid")).toBe(true);
    expect(after.victvsPayouts).toHaveLength(1);
    expect(after.victvsPayouts[0]).toMatchObject({ total: 157.5, accountId: wise.id });
    await expect(page.locator("[data-victvs-summary] [data-figure=xl]")).toHaveText("$30.00");

    // and the payout can be undone, armed by a second tap
    await page.getByRole("button", { name: "Payouts (1)" }).click();
    await expect(page.locator("[data-victvs-payouts]")).toContainText("+$157.50");
    await expect(page.locator("[data-victvs-payouts]")).toContainText(`3 sessions → ${wise.name}`);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await settle(page);
    await page.screenshot({ path: `${SHOTS}/pocket-cards-victvs-payouts-light.png` });
    await page.getByRole("button", { name: "Undo payout" }).click();
    await page.getByRole("button", { name: "Tap again to confirm" }).click();
    await expect(page.locator("[data-victvs-summary] [data-figure=xl]")).toHaveText("$187.50");
    expect((await store(page)).victvsPayouts).toHaveLength(0);
  });

  test("a month's Select ▾ → 1–15 selects exactly the first-half unpaid sessions", async ({ page }) => {
    const m = demoMonths();
    await openVictvs(page);
    const last = page.locator(`[data-victvs-month="${m.lastMonth}"]`);
    await last.getByRole("button", { name: `Select sessions in ${m.lastLong}` }).click();
    const s = sheet(page);
    await expect(s.getByRole("heading", { name: `Select sessions in ${m.lastLong}` })).toBeVisible();
    await expect(s.getByRole("button", { name: `16–${m.lastDay} ${m.lastShort} (1)` })).toBeVisible();
    await expect(s.getByRole("button", { name: `All unpaid in ${m.lastLong} (3)` })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/pocket-cards-victvs-range-light.png` });
    await s.getByRole("button", { name: `1–15 ${m.lastShort} (2)` }).click();
    await expect(s).toBeHidden();

    for (const no of SEP.first) await expect(sessionRow(page, no)).toHaveAttribute("aria-pressed", "true");
    for (const no of SEP.second) await expect(sessionRow(page, no)).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator('[data-session-row][aria-pressed="true"]')).toHaveCount(2);
    await expect(bar(page).locator("[data-selection-summary]")).toHaveText("2 selected · $97.50");
  });

  test("a paid row opens Mark unpaid; an unpaid row's long-press offers Delete, armed", async ({ page }) => {
    await openVictvs(page);
    const paid = sessionRow(page, "71455");
    await expect(paid).toHaveAccessibleName(/, Paid$/);
    await expect(paid).not.toHaveAttribute("aria-pressed", /.*/);
    await paid.click();
    await expect(sheet(page).getByRole("button", { name: "Mark unpaid" })).toBeVisible();
    await expect(sheet(page).getByRole("button", { name: /Delete/ })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(sheet(page)).toBeHidden();

    // the context menu is the long-press's keyboard and mouse twin
    const row = sessionRow(page, "36951");
    await row.click({ button: "right" });
    const s = sheet(page);
    await expect(s.getByRole("button", { name: "Select" })).toBeVisible();
    await s.getByRole("button", { name: "Delete session" }).click();
    await s.getByRole("button", { name: "Tap again to confirm" }).click();
    await expect(s).toBeHidden();
    await expect(sessionRow(page, "36951")).toHaveCount(0);
    expect((await store(page)).victvsSessions.some((x) => x.sessionNo === "36951")).toBe(false);

    // a press and hold does the same as the context menu
    const hold = sessionRow(page, "79668");
    const box = (await hold.boundingBox())!;
    await page.mouse.move(box.x + 40, box.y + box.height / 2);
    await page.mouse.down();
    await expect(sheet(page).getByRole("button", { name: "Delete session" })).toBeVisible({ timeout: 2_000 });
    await page.mouse.up();
    // the hold isn't also a tap
    await expect(hold).toHaveAttribute("aria-pressed", "false");
    await page.keyboard.press("Escape");
  });

  test("the selection's ⋯ deletes, armed", async ({ page }) => {
    await openVictvs(page);
    await sessionRow(page, "41002").click();
    await bar(page).getByRole("button", { name: "More actions" }).click();
    const s = sheet(page);
    await s.getByRole("button", { name: "Delete 1 session" }).click();
    await s.getByRole("button", { name: "Tap again to confirm" }).click();
    await expect(s).toBeHidden();
    await expect(bar(page)).toHaveCount(0);
    expect((await store(page)).victvsSessions.some((x) => x.sessionNo === "41002")).toBe(false);
  });

  test("the Add menu's VICTVS session opens the new-session form, and the link is cleared", async ({ page }) => {
    await openVictvs(page);
    await page.getByRole("button", { name: "Add", exact: true }).click({ button: "right" });
    await sheet(page).getByRole("button", { name: "VICTVS session" }).click();
    await expect(sheet(page).getByRole("heading", { name: "Add session" })).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/victvs$/);
    await sheet(page).getByLabel("Session no").fill("55501");
    await sheet(page).getByRole("button", { name: "Save" }).click();
    await expect(sheet(page)).toBeHidden();
    await expect(sessionRow(page, "55501")).toBeVisible();
  });

  test("Turkish: counts and the summary", async ({ page }) => {
    await openVictvs(page, { locale: "tr" });
    await expect(page.locator("[data-victvs-summary]")).toContainText("4 seans");
    await expect(page.getByRole("button", { name: "Ödenmemişlerin tümünü seç" })).toBeVisible();
    await page.getByRole("button", { name: "Ödenmemişlerin tümünü seç" }).click();
    await expect(bar(page).locator("[data-selection-summary]")).toHaveText("4 seçili · $187,50");
    await page.screenshot({ path: `${SHOTS}/pocket-cards-victvs-tr-light.png` });
  });
});

test.describe("Pocket cards and VICTVS, dark", () => {
  test.use({ colorScheme: "dark" });

  test("cards, big purchases and VICTVS in dark mode", async ({ page }) => {
    await openCards(page, {
      edit: (s) => {
        s.accounts.find((a) => a.name === "Bonus Card")!.creditLimit = 100000;
      },
    });
    await page.screenshot({ path: `${SHOTS}/pocket-cards-cards-dark.png` });
    await page.getByRole("tab", { name: "Big purchases" }).click();
    await expect(page.locator('[data-purchase-row="iPhone 17"]')).toBeVisible();
    await settle(page);
    await page.screenshot({ path: `${SHOTS}/pocket-cards-purchases-dark.png` });

    await page.goto("/victvs");
    await expect(page.locator("[data-victvs-summary]")).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: `${SHOTS}/pocket-cards-victvs-dark.png` });
    for (const no of [...SEP.first, ...SEP.second]) await sessionRow(page, no).click();
    await expect(bar(page)).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/pocket-cards-victvs-selected-dark.png` });
  });
});
