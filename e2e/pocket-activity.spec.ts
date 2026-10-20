import { expect, Locator, Page, test } from "@playwright/test";
import { pinRates } from "./support/rates";

// the same rates in every run, offline or in CI (see support/rates.ts)
test.beforeEach(async ({ page }) => {
  await pinRates(page);
});

/**
 * Pocket's Activity and Recurring (/transactions and ?tab=recurring): the
 * ledger as a phone list with what needs doing on top, and the recurring
 * items with their commitments. Runs in the demo at 390×844 with the Pocket
 * phone layout switched on; a last group checks 402 and 440 wide.
 */

const DEMO_KEY = "renovator-demo-v5";
const SHOTS = "e2e/screenshots";

interface StoredTx {
  id: string;
  accountId: string;
  description: string;
  amount: number;
  status: "planned" | "completed";
  dueDate: string;
  direction: "income" | "expense";
  transferGroupId: string | null;
  recurringTemplateId: string | null;
  createdAt: string;
}
interface StoredAccount {
  id: string;
  name: string;
}
interface Store {
  accounts: StoredAccount[];
  transactions: StoredTx[];
  templates: Array<{ id: string; name: string }>;
}

/** yyyy-mm-dd, local, `days` from today */
function isoFromToday(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** yyyy-mm-10, `months` before this month */
function monthsAgo(months: number): string {
  const d = new Date();
  d.setDate(10);
  d.setMonth(d.getMonth() - months);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-10`;
}

async function enterPocket(
  page: Page,
  opts: {
    path?: string;
    width?: number;
    locale?: "tr";
    edit?: (store: Store) => void;
    prefs?: Record<string, string>;
  } = {}
) {
  await page.setViewportSize({ width: opts.width ?? 390, height: 844 });
  await page.goto("/welcome");
  await page.getByRole("button", { name: /demo/i }).click();
  await expect(page.getByText(/Net worth|Toplam varlık/).first()).toBeVisible({ timeout: 15_000 });
  await page.evaluate(
    ({ locale, prefs }) => {
      localStorage.setItem("renovator-phone-layout", "pocket");
      for (const key of [
        "renovator-pocket-upcoming-range",
        "renovator-recurring-status",
        "renovator-recurring-direction",
        "renovator-label-toConfirm",
        "renovator-pocket-hide-amounts",
      ]) {
        localStorage.removeItem(key);
      }
      for (const [key, value] of Object.entries(prefs)) localStorage.setItem(key, value);
      if (locale) localStorage.setItem("renovator-locale", locale);
    },
    { locale: opts.locale, prefs: opts.prefs ?? {} }
  );
  if (opts.edit) {
    const saved = await store(page);
    opts.edit(saved);
    await page.evaluate(([key, value]) => localStorage.setItem(key, value), [DEMO_KEY, JSON.stringify(saved)] as const);
  }
  await page.goto(opts.path ?? "/transactions");
  await expect(page.locator("[data-pocket-shell]")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("h1[data-pocket-title]")).toBeVisible({ timeout: 15_000 });
  if ((opts.path ?? "").includes("tab=recurring")) {
    await expect(page.locator("[data-commitments]")).toBeVisible({ timeout: 15_000 });
  } else {
    await expect(monthHeads(page).first().or(page.getByText(/No transactions match|eşleşen işlem yok/i))).toBeVisible({
      timeout: 15_000,
    });
  }
}

const store = (page: Page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}") as Store, DEMO_KEY);
const findTx = async (page: Page, id: string) => (await store(page)).transactions.find((t) => t.id === id);

const tabs = (page: Page) => page.getByRole("group", { name: /^(Transactions|İşlemler)$/ });
const search = (page: Page) => page.getByRole("searchbox");
const chips = (page: Page) => page.getByRole("group", { name: /^(Filters|Filtreler)$/ });
const chip = (page: Page, name: string | RegExp) => chips(page).getByRole("button", { name, exact: typeof name === "string" });
const needs = (page: Page) => page.locator("#needs-action");
/** month separators: "October 2026" */
const monthHeads = (page: Page) => page.locator("main h2").filter({ hasText: /^\p{L}+ \d{4}$/u });
/** rows under the day headers (the history), not the card above */
const historyRows = (page: Page) => page.locator("main section[aria-labelledby] li");
const historyRow = (page: Page, text: string) => historyRows(page).filter({ hasText: text });
const sheet = (page: Page) => page.getByRole("dialog");
const snackbar = (page: Page) => page.locator("[role=status]").filter({ hasText: /Marked paid|Ödendi|Saved|Kaydedildi/ });
const recurringRows = (page: Page) => page.locator("[data-recurring-list] > li");

/** "−$2,158.38" → -2158.38; "+₺1.234,50" isn't used (the demo runs in English unless asked) */
const amountOf = (text: string) => Number(text.replace("−", "-").replace(/[^0-9.-]/g, ""));

/** Each month separator's net: "October 2026" → −992.23 (no figure means zero). */
async function pocketMonthNets(page: Page): Promise<Map<string, number>> {
  const nets = new Map<string, number>();
  for (const head of await monthHeads(page).all()) {
    const label = (await head.innerText()).trim();
    const figure = head.locator("xpath=following-sibling::*[@data-amount][1]");
    nets.set(label, (await figure.count()) ? amountOf(await figure.innerText()) : 0);
  }
  return nets;
}

/** The Classic month cards' "▾ October 4 … = +$950.62", by "October 2026" (the demo's history is this year's). */
async function classicMonthNets(page: Page): Promise<Map<string, number>> {
  const nets = new Map<string, number>();
  const year = new Date().getFullYear();
  const texts = await page.locator("main button").evaluateAll((els) => els.map((el) => el.textContent ?? ""));
  for (const text of texts) {
    const month = /^[▾▸]\s*(\p{L}+)\s*\d+/u.exec(text)?.[1];
    const net = /= ([+−])\$([\d,]+\.\d\d)/.exec(text);
    if (!month || !net) continue;
    nets.set(`${month} ${year}`, (net[1] === "−" ? -1 : 1) * Number(net[2].replace(/,/g, "")));
  }
  return nets;
}

async function noSideScroll(page: Page, width: number) {
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(width);
  // every row stays inside the screen, and no figure breaks onto a second line
  const rows = await page.locator("main li").evaluateAll((els) => els.map((el) => el.getBoundingClientRect().right));
  for (const right of rows) expect(right).toBeLessThanOrEqual(width + 0.5);
  const figures = await page
    .locator("main li [data-amount]")
    .evaluateAll((els) => els.map((el) => ({ text: el.textContent, lines: el.getClientRects().length })));
  for (const f of figures) expect(f.lines, `"${f.text}" on one line`).toBe(1);
}

async function bottomOf(locator: Locator): Promise<number> {
  const box = await locator.boundingBox();
  if (!box) throw new Error("not on screen");
  return box.y + box.height;
}

test.describe("Pocket activity", () => {
  test("the ledger: title, tabs, search and chips, then what needs doing above the history", async ({ page }) => {
    await enterPocket(page);
    await expect(page.getByRole("heading", { level: 1, name: "Transactions" })).toBeVisible();
    await expect(tabs(page).getByRole("button", { name: "Transactions" })).toHaveAttribute("aria-pressed", "true");
    await expect(tabs(page).getByRole("button", { name: "Recurring" })).toHaveAttribute("aria-pressed", "false");
    await expect(search(page)).toHaveAccessibleName("Search descriptions, categories, accounts");
    await expect(search(page)).toHaveCSS("font-size", "16px");

    // the chips, in order: the account opens a sheet, the rest toggle
    const account = chip(page, "Account: All accounts");
    await expect(account).toHaveAttribute("aria-haspopup", "dialog");
    for (const name of ["Planned", "Income", "Expense"]) await expect(chip(page, name)).toHaveAttribute("aria-pressed", "false");
    await expect(chip(page, /^Overdue \(\d+\)/)).toHaveAttribute("aria-pressed", "false");
    await expect(chip(page, "Order: Latest first")).toBeVisible();

    // overdue (red) and coming up, above the first month
    await expect(needs(page)).toHaveAccessibleName("Needs attention");
    const overdue = needs(page).locator("#overdue");
    await expect(overdue).toHaveText(/^Overdue · \d+ · [+−]\$[\d,]+\.\d\d$/);
    await expect(overdue.getByRole("button")).toHaveClass(/text-red-600/);
    await expect(needs(page).getByRole("heading", { name: /^Coming up · \d+/ })).toBeVisible();
    await expect(needs(page).getByRole("button", { name: /^Later: \d+ planned$/ })).toBeVisible();
    const count = Number(/Overdue · (\d+)/.exec(await overdue.innerText())![1]);
    await expect(chip(page, `Overdue (${count})`)).toBeVisible();
    expect(await bottomOf(needs(page))).toBeLessThan((await monthHeads(page).first().boundingBox())!.y);

    // the history is what was done: no planned row in it, rows at least 60px
    await expect(historyRow(page, "Weekly market")).toBeVisible();
    await expect(historyRows(page).filter({ hasText: "Dentist follow-up" })).toHaveCount(0);
    for (const row of (await historyRows(page).all()).slice(0, 5)) {
      expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(60);
    }
    // day headers are h3s inside labelled sections, and stick under the header
    const day = page.locator("main section[aria-labelledby]").first();
    await expect(day.locator("h3")).toHaveText(/^(Today|Yesterday|\w{3}, \d+ \w+) · \d+/);
    await expect(day.locator("h3").locator("xpath=..")).toHaveCSS("position", "sticky");

    await page.screenshot({ path: `${SHOTS}/pocket-activity-ledger-light.png` });
  });

  test("month nets equal the Classic month header for the same filter", async ({ page }) => {
    await enterPocket(page);
    const pocket = await pocketMonthNets(page);
    expect(pocket.size).toBeGreaterThanOrEqual(3);
    await chip(page, "Income").click();
    await expect(chip(page, "Income")).toHaveAttribute("aria-pressed", "true");
    const pocketIncome = await pocketMonthNets(page);

    // the same session at desk width is Classic
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(page.locator("[data-pocket-shell]")).toHaveCount(0);
    await expect(page.getByRole("tablist", { name: "Transactions" })).toBeVisible();
    const status = page.locator("select").filter({ has: page.locator('option[value="completed"]') });
    const direction = page.locator("select").filter({ has: page.locator('option[value="income"]') });
    await status.selectOption("completed");
    const classic = await classicMonthNets(page);
    await direction.selectOption("income");
    const classicIncome = await classicMonthNets(page);

    for (const [expected, actual] of [
      [classic, pocket],
      [classicIncome, pocketIncome],
    ]) {
      expect(expected.size).toBeGreaterThan(0);
      for (const [month, net] of expected) expect(actual.get(month) ?? 0, month).toBeCloseTo(net, 2);
      for (const [month, net] of actual) expect(net, month).toBeCloseTo(expected.get(month) ?? 0, 2);
    }
  });

  test("Show 30 days is kept, Later turns Planned on, and ?show=due scrolls to the card", async ({ page }) => {
    const in12 = isoFromToday(12);
    await enterPocket(page, {
      edit: (s) => {
        s.transactions.find((t) => t.description === "Dentist follow-up")!.dueDate = in12;
      },
    });
    const coming = needs(page).getByRole("heading", { name: /^Coming up/ });
    await expect(needs(page).getByText("Dentist follow-up")).toHaveCount(0);
    await needs(page).getByRole("button", { name: "Show 30 days" }).click();
    await expect(needs(page).getByRole("button", { name: "Show 7 days" })).toBeVisible();
    await expect(needs(page).getByText("Dentist follow-up")).toBeVisible();
    await expect(coming).toHaveText(/^Coming up · [1-9]\d* · [+−]\$/);
    expect(await page.evaluate(() => localStorage.getItem("renovator-pocket-upcoming-range"))).toBe("30");

    await page.reload();
    await expect(needs(page).getByRole("button", { name: "Show 7 days" })).toBeVisible({ timeout: 15_000 });
    await expect(needs(page).getByText("Dentist follow-up")).toBeVisible();

    // a folded block keeps its heading
    await needs(page).getByRole("button", { name: /^Coming up/ }).click();
    await expect(needs(page).getByText("Dentist follow-up")).toHaveCount(0);
    await expect(needs(page).getByRole("button", { name: /^Coming up/ })).toHaveAttribute("aria-expanded", "false");

    // Later: n planned › lists every planned row, soonest first
    await needs(page).getByRole("button", { name: /^Later: \d+ planned$/ }).click();
    await expect(chip(page, "Planned")).toHaveAttribute("aria-pressed", "true");
    await expect(chip(page, "Order: Oldest first")).toBeVisible();
    await expect(needs(page)).toHaveCount(0);
    await expect(historyRows(page).first()).toContainText("Planned");

    await page.goto("/transactions?show=due");
    await expect(needs(page)).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(50);
    const header = await bottomOf(page.locator("[data-pocket-header]"));
    const top = (await needs(page).boundingBox())!.y;
    expect(top).toBeGreaterThanOrEqual(header - 1);
    expect(top).toBeLessThanOrEqual(header + 24);
  });

  test("a row opens its actions; Edit saves through the add sheet", async ({ page }) => {
    await enterPocket(page);
    await historyRow(page, "Weekly market").getByRole("button").first().click();
    const actions = sheet(page);
    await expect(actions.getByRole("heading", { name: "Weekly market" })).toBeVisible();
    await expect(actions).toContainText("−₺4,350.75");
    await expect(actions).toContainText("Ziraat TRY · Groceries");
    const items = await actions.locator("[data-pocket-sheet-body] button").allInnerTexts();
    const labels = items.map((s) => s.trim()).filter(Boolean);
    expect(labels.slice(0, 5)).toEqual(["Edit", "Duplicate", "Reopen", "Mark as legacy", "Delete"]);
    await page.screenshot({ path: `${SHOTS}/pocket-activity-sheet-light.png` });

    await actions.getByRole("button", { name: "Edit", exact: true }).click();
    const form = sheet(page);
    await expect(form.getByRole("heading", { name: "Edit transaction" })).toBeVisible();
    const note = form.getByLabel("Note");
    await expect(note).toHaveValue("Weekly market");
    await note.fill("Weekly market — Migros");
    await form.getByRole("button", { name: "Save changes" }).click();
    await expect(form).toBeHidden();
    await expect.poll(async () => (await store(page)).transactions.some((t) => t.description === "Weekly market — Migros")).toBe(true);
    await expect(historyRow(page, "Weekly market — Migros")).toBeVisible();
  });

  test("a transfer across currencies is one row, with what landed beside it", async ({ page }) => {
    await enterPocket(page);
    const row = historyRow(page, "To Ziraat TRY");
    await expect(row).toHaveCount(1);
    await expect(historyRows(page).filter({ hasText: "From Wise USD" })).toHaveCount(0);
    await expect(row).toContainText("Wise USD → Ziraat TRY");
    await expect(row).toContainText("$500.00");
    await expect(row).toContainText("→ ₺20,350.00");
    await row.getByRole("button").first().click();
    await expect(sheet(page).getByRole("button", { name: "Duplicate" })).toBeVisible();
    await expect(sheet(page).getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
    await expect(sheet(page).getByRole("button", { name: "Reopen", exact: true })).toHaveCount(0);
  });

  test("the ✓ on a planned row marks it paid, and Undo puts it back", async ({ page }) => {
    await enterPocket(page);
    const check = needs(page).getByRole("button", { name: "Mark VICTVS retainer as paid" });
    await expect(check).toBeEnabled();
    const victvs = (await store(page)).templates.find((t) => t.name === "VICTVS retainer")!;
    const row = (await store(page)).transactions.find(
      (t) => t.recurringTemplateId === victvs.id && t.status === "planned" && t.dueDate < isoFromToday(0)
    )!;

    await check.click();
    await expect(snackbar(page)).toContainText("Marked paid · +$900.00");
    await expect.poll(async () => (await findTx(page, row.id))?.status).toBe("completed");
    await expect(needs(page).getByText("VICTVS retainer")).toHaveCount(0);

    await snackbar(page).getByRole("button", { name: "Undo" }).click();
    await expect.poll(async () => (await findTx(page, row.id))?.status).toBe("planned");
    await expect(needs(page).getByText("VICTVS retainer")).toBeVisible();
  });

  test("Planned and Overdue exclude each other, as do Income and Expense; Clear filters resets", async ({ page }) => {
    await enterPocket(page);
    const overdueCount = Number(/\((\d+)\)/.exec(await chip(page, /^Overdue/).innerText())![1]);

    await chip(page, "Planned").click();
    await expect(chip(page, "Planned")).toHaveAttribute("aria-pressed", "true");
    await expect(needs(page)).toHaveCount(0);
    await chip(page, /^Overdue/).click();
    await expect(chip(page, /^Overdue/)).toHaveAttribute("aria-pressed", "true");
    await expect(chip(page, "Planned")).toHaveAttribute("aria-pressed", "false");
    await expect(historyRows(page)).toHaveCount(overdueCount);
    await expect(historyRows(page).first()).toContainText(/days? late|Planned/);

    await chip(page, "Income").click();
    await expect(chip(page, "Income")).toHaveAttribute("aria-pressed", "true");
    await chip(page, "Expense").click();
    await expect(chip(page, "Expense")).toHaveAttribute("aria-pressed", "true");
    await expect(chip(page, "Income")).toHaveAttribute("aria-pressed", "false");
    await page.screenshot({ path: `${SHOTS}/pocket-activity-chips-light.png` });

    await search(page).fill("nothing is called this");
    await expect(page.getByText("No transactions match.")).toBeVisible();
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(search(page)).toHaveValue("");
    for (const name of ["Planned", "Income", "Expense"]) await expect(chip(page, name)).toHaveAttribute("aria-pressed", "false");
    await expect(chip(page, /^Overdue/)).toHaveAttribute("aria-pressed", "false");
    await expect(needs(page)).toBeVisible();
  });

  test("search finds 'dentist' whatever its case", async ({ page }) => {
    await enterPocket(page);
    for (const query of ["dentist", "DENTIST", "Dentıst", "health", "ziraat"]) {
      await search(page).fill(query);
      await expect(historyRow(page, "Dentist follow-up"), query).toBeVisible();
    }
    // a search looks through planned rows too, and the card makes way
    await expect(historyRow(page, "Dentist follow-up")).toContainText("Planned");
    await expect(needs(page)).toHaveCount(0);
    await page.getByRole("button", { name: "Clear search" }).click();
    await expect(search(page)).toHaveValue("");
    await expect(needs(page)).toBeVisible();
  });

  test("a search opens at this month; the planned months after it wait behind a button", async ({ page }) => {
    await enterPocket(page);
    // Ziraat carries the rent and the loan: a year of planned rows ahead
    await search(page).fill("ziraat");
    const thisMonth = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });
    await expect(monthHeads(page).first()).toHaveText(thisMonth);
    await expect(historyRow(page, "Dentist follow-up")).toBeVisible();
    const later = page.getByRole("button", { name: "Show later months" });
    await expect(later).toBeVisible();
    expect((await later.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await later.focus();
    await page.keyboard.press("Enter");
    await expect(later).toHaveCount(0);
    // the later months open above, in view, newest first, with focus on the first
    await expect(monthHeads(page).first()).not.toHaveText(thisMonth);
    await expect(monthHeads(page).first()).toBeInViewport();
    await expect(monthHeads(page).first()).toBeFocused();
    await expect(monthHeads(page).filter({ hasText: thisMonth })).toHaveCount(1);
    // oldest first lists from the start, nothing folded above it (the
    // button under the list pages on, as it always does)
    await chips(page).getByRole("button", { name: /^Order/ }).click();
    await expect(monthHeads(page).first()).not.toHaveText(thisMonth);
    const lastHead = (await monthHeads(page).last().boundingBox())!;
    if (await later.count()) expect((await later.boundingBox())!.y).toBeGreaterThan(lastHead.y);
    // a new search folds them again: Rent starts this month, so oldest
    // first opens there and runs on; newest first folds what comes after
    await search(page).fill("rent");
    await expect(historyRow(page, "Car loan installment")).toHaveCount(0);
    await expect(monthHeads(page).first()).toHaveText(thisMonth);
    await expect(monthHeads(page)).not.toHaveCount(1);
    await chips(page).getByRole("button", { name: /^Order/ }).click();
    await expect(monthHeads(page)).toHaveCount(1);
    await expect(monthHeads(page).first()).toHaveText(thisMonth);
    await expect(later).toBeVisible();
  });

  test("in Turkish, the dotted İ and dotless ı fold into i", async ({ page }) => {
    await enterPocket(page, {
      locale: "tr",
      edit: (s) => {
        s.transactions.find((t) => t.description === "Dentist follow-up")!.description = "DENTİST kontrolü";
      },
    });
    for (const query of ["dentist", "DENTIST", "dentıst", "Dentİst"]) {
      await search(page).fill(query);
      await expect(historyRow(page, "DENTİST kontrolü"), query).toBeVisible();
    }
    await page.screenshot({ path: `${SHOTS}/pocket-activity-search-tr-light.png` });
  });

  test("the account chip opens a radio sheet; one account's history is in its currency", async ({ page }) => {
    await enterPocket(page);
    await chip(page, "Account: All accounts").click();
    const picker = sheet(page);
    await expect(picker.getByRole("heading", { name: "Which account?" })).toBeVisible();
    const radios = picker.getByRole("radio");
    await expect(picker.getByRole("radio", { name: /All accounts/ })).toHaveAttribute("aria-checked", "true");
    await expect(picker.getByRole("radio", { name: /All accounts/ })).toBeFocused();
    await expect(picker.getByRole("radio", { name: /Bonus Card/ })).toHaveCount(0);
    for (const box of await radios.all()) expect((await box.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: `${SHOTS}/pocket-activity-accounts-light.png` });

    await picker.getByRole("radio", { name: /Ziraat TRY/ }).click();
    await expect(picker).toBeHidden();
    await expect(chip(page, "Account: Ziraat TRY")).toBeVisible();
    await expect(monthHeads(page).first().locator("xpath=following-sibling::*[@data-amount][1]")).toHaveText(/₺/);
    // one account's history lists the leg that landed on it
    await expect(historyRow(page, "From Wise USD")).toContainText("+₺20,350.00");
    await expect(historyRows(page).filter({ hasText: "Contract work" })).toHaveCount(0);
  });

  test("deep links set the filters: ?filter=overdue, ?account= and ?q=", async ({ page }) => {
    await enterPocket(page, { path: "/transactions?filter=overdue" });
    await expect(chip(page, /^Overdue/)).toHaveAttribute("aria-pressed", "true");
    await expect(needs(page)).toHaveCount(0);

    const wise = (await store(page)).accounts.find((a) => a.name === "Wise USD")!;
    await page.goto(`/transactions?account=${wise.id}`);
    await expect(chip(page, "Account: Wise USD")).toBeVisible({ timeout: 15_000 });

    await page.goto("/transactions?q=market");
    await expect(search(page)).toHaveValue("market", { timeout: 15_000 });
    await expect(historyRow(page, "Weekly market")).toBeVisible();
    await expect(historyRows(page).filter({ hasText: "Electricity" })).toHaveCount(0);
  });

  test("history shows three months, then three more at a time", async ({ page }) => {
    await enterPocket(page, {
      edit: (s) => {
        const model = s.transactions.find((t) => t.description === "Weekly market")!;
        for (let i = 4; i <= 7; i++) {
          s.transactions.push({ ...model, id: crypto.randomUUID(), description: `Older market ${i}`, dueDate: monthsAgo(i) });
        }
      },
    });
    await expect(monthHeads(page)).toHaveCount(3);
    const more = page.getByRole("button", { name: "Show earlier months" });
    await expect(more).toBeVisible();
    expect((await more.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await more.click();
    await expect(monthHeads(page)).toHaveCount(6);
    await more.click();
    await expect(monthHeads(page)).toHaveCount(7);
    await expect(more).toHaveCount(0);
  });

  test("without live rates, Mark paid waits and says why", async ({ page }) => {
    await enterPocket(page);
    await page.route("**/api/rates**", () => {});
    await page.reload();
    await expect(needs(page)).toBeVisible({ timeout: 15_000 });
    const check = needs(page).getByRole("button", { name: /as paid\. Waiting for live rates…$/ }).first();
    await expect(check).toBeDisabled();
    await needs(page).locator("li").first().getByRole("button").first().click();
    await expect(sheet(page).getByRole("button", { name: /Mark as paid/ })).toBeDisabled();
    await expect(sheet(page)).toContainText("Waiting for live rates…");
    await page.unrouteAll({ behavior: "ignoreErrors" });
  });
});

test.describe("Pocket recurring", () => {
  test("the segment keeps the tab in the URL; commitments read Yearly = Monthly × 12", async ({ page }) => {
    await enterPocket(page);
    await tabs(page).getByRole("button", { name: "Recurring" }).click();
    await expect(page).toHaveURL(/\/transactions\?tab=recurring$/);
    await expect(tabs(page).getByRole("button", { name: "Recurring" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("heading", { level: 2, name: "Commitments" })).toBeVisible();

    const out = page.locator('[data-commitment="out"] [data-amount]');
    const income = page.locator('[data-commitment="in"] [data-amount]');
    await expect(out).toHaveText(/^−\$[\d,]+\.\d\d$/);
    await expect(income).toHaveText(/^\+\$[\d,]+\.\d\d$/);
    const monthly = { out: amountOf(await out.innerText()), in: amountOf(await income.innerText()) };
    await expect(page.locator("[data-commitments] + p, [data-commitments] ~ p").last()).toHaveText(
      /^Next: .+ (today|tomorrow|in \d+ days)$/
    );
    await page.screenshot({ path: `${SHOTS}/pocket-activity-recurring-light.png` });

    await page.getByRole("group", { name: "Period" }).getByRole("button", { name: "Yearly" }).click();
    await expect(page.getByRole("group", { name: "Period" }).getByRole("button", { name: "Yearly" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await expect.poll(async () => amountOf(await out.innerText())).not.toBe(monthly.out);
    expect(Math.abs(amountOf(await out.innerText()) - monthly.out * 12)).toBeLessThanOrEqual(0.06);
    expect(Math.abs(amountOf(await income.innerText()) - monthly.in * 12)).toBeLessThanOrEqual(0.06);

    // back to the ledger
    await tabs(page).getByRole("button", { name: "Transactions" }).click();
    await expect(page).toHaveURL(/\/transactions$/);
    await expect(needs(page)).toBeVisible();
  });

  test("rows: to confirm first, then by next date, in the label colours chosen in Settings", async ({ page }) => {
    await enterPocket(page, { path: "/transactions?tab=recurring" });
    const texts = await recurringRows(page).allInnerTexts();
    expect(texts.length).toBeGreaterThanOrEqual(3);
    const confirm = texts.map((t) => /\d+ to confirm/.test(t));
    const lastConfirm = confirm.lastIndexOf(true);
    const firstOther = confirm.indexOf(false);
    expect(lastConfirm).toBeGreaterThanOrEqual(0);
    if (firstOther >= 0) expect(lastConfirm).toBeLessThan(firstOther);
    // the rest by next date: "in n days" never goes down
    const days = texts.filter((_, i) => !confirm[i]).map((t) => Number(/in (\d+) days/.exec(t)?.[1] ?? NaN)).filter((n) => !Number.isNaN(n));
    expect(days).toEqual([...days].sort((a, b) => a - b));
    for (const row of await recurringRows(page).all()) expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(64);

    // tags: Loan (sky) and Auto, and "1 to confirm" in the default amber
    await expect(recurringRows(page).filter({ hasText: "Car loan installment" }).getByText("Loan", { exact: true })).toBeVisible();
    await expect(recurringRows(page).filter({ hasText: "Rent" }).getByText("Auto", { exact: true })).toBeVisible();
    const tag = recurringRows(page).first().getByText(/^\d+ to confirm$/);
    await expect(tag).toHaveClass(/bg-amber-100/);

    await page.evaluate(() => {
      localStorage.setItem("renovator-label-toConfirm", "violet");
      window.dispatchEvent(new Event("renovator-label-colors"));
    });
    await expect(recurringRows(page).first().getByText(/^\d+ to confirm$/)).toHaveClass(/bg-violet-100/);
  });

  test("a template's sheet confirms its due item; Edit is TemplateModal as a sheet", async ({ page }) => {
    await enterPocket(page, { path: "/transactions?tab=recurring" });
    const victvs = (await store(page)).templates.find((t) => t.name === "VICTVS retainer")!;
    const due = (await store(page)).transactions.find(
      (t) => t.recurringTemplateId === victvs.id && t.status === "planned" && t.dueDate <= isoFromToday(0)
    )!;
    await recurringRows(page).filter({ hasText: "VICTVS retainer" }).getByRole("button").click();
    const actions = sheet(page);
    await expect(actions.getByRole("heading", { name: "VICTVS retainer" })).toBeVisible();
    const items = actions.getByRole("region", { name: "Waiting to be confirmed" }).locator("[data-due-item]");
    await expect(items).toHaveCount(1);
    await expect(items.getByRole("button", { name: "Paid a different amount…" })).toBeVisible();
    await expect(actions.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
    await expect(actions.getByRole("button", { name: "See its items" })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/pocket-activity-template-sheet-light.png` });

    await items.getByRole("button", { name: /^Mark VICTVS retainer, .+ as paid$/ }).click();
    await expect(actions).toBeHidden();
    await expect(snackbar(page)).toContainText("Marked paid");
    await expect.poll(async () => (await findTx(page, due.id))?.status).toBe("completed");
    await expect(recurringRows(page).filter({ hasText: "VICTVS retainer" })).not.toContainText("to confirm");
    await snackbar(page).getByRole("button", { name: "Undo" }).click();
    await expect.poll(async () => (await findTx(page, due.id))?.status).toBe("planned");

    await recurringRows(page).filter({ hasText: "VICTVS retainer" }).getByRole("button").click();
    await sheet(page).getByRole("button", { name: "Edit", exact: true }).click();
    const form = sheet(page);
    await expect(form.getByRole("heading", { name: "Edit" })).toBeVisible();
    await expect(form.locator("[data-pocket-legacy-form]")).toBeVisible();
    await expect(form.getByRole("textbox").first()).toHaveValue("VICTVS retainer");
    await page.keyboard.press("Escape");
    await expect(form).toBeHidden();
  });

  test("a loan's template opens its loan; See its items searches the ledger", async ({ page }) => {
    await enterPocket(page, { path: "/transactions?tab=recurring" });
    await recurringRows(page).filter({ hasText: "Car loan installment" }).getByRole("button").click();
    await expect(sheet(page).getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
    await sheet(page).getByRole("button", { name: "Managed by its loan — open the loan" }).click();
    await expect(page).toHaveURL(/\/accounts\?view=debts&loan=[^&]+$/);
    await expect(page.locator("[data-loan-detail]")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Car loan — Garanti" })).toBeVisible();

    await page.goto("/transactions?tab=recurring");
    await expect(page.locator("[data-commitments]")).toBeVisible({ timeout: 15_000 });
    // from further down the list: the search still opens at its top
    await recurringRows(page).last().scrollIntoViewIfNeeded();
    await recurringRows(page).filter({ hasText: "Rent" }).getByRole("button").click();
    await sheet(page).getByRole("button", { name: "See its items" }).click();
    await expect(page).toHaveURL(/\/transactions\?q=Rent$/);
    await expect(search(page)).toHaveValue("Rent");
    await expect(search(page)).toBeInViewport();
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await expect(tabs(page).getByRole("button", { name: "Transactions" })).toHaveAttribute("aria-pressed", "true");
    await expect(historyRow(page, "Rent").first()).toBeVisible();
    // Back returns to the list it came from, Forward to the search
    await page.goBack();
    await expect(page).toHaveURL(/\/transactions\?tab=recurring$/);
    await expect(page.locator("[data-commitments]")).toBeVisible();
    await page.goForward();
    await expect(page).toHaveURL(/\/transactions\?q=Rent$/);
    await expect(search(page)).toHaveValue("Rent");
  });

  test("opened at ?tab=recurring, the segment still moves between the tabs", async ({ page }) => {
    // a production build once ignored a router call to the same page with
    // another query after loading with one (lib/ui/shallowUrl.ts)
    await enterPocket(page, { path: "/transactions?tab=recurring" });
    await tabs(page).getByRole("button", { name: "Transactions" }).click();
    await expect(page).toHaveURL(/\/transactions$/);
    await expect(needs(page)).toBeVisible();
    await tabs(page).getByRole("button", { name: "Recurring" }).click();
    await expect(page).toHaveURL(/\/transactions\?tab=recurring$/);
    await expect(page.locator("[data-commitments]")).toBeVisible();

    // the tab bar's Activity, from the page itself and from another
    const bar = page.getByRole("navigation", { name: "Sections" });
    await page.goto("/transactions?tab=recurring");
    await expect(page.locator("[data-commitments]")).toBeVisible({ timeout: 15_000 });
    await bar.getByRole("link", { name: "Activity" }).click();
    await expect(page).toHaveURL(/\/transactions$/);
    await expect(needs(page)).toBeVisible();
    await page.goto("/transactions?tab=recurring");
    await expect(page.locator("[data-commitments]")).toBeVisible({ timeout: 15_000 });
    await bar.locator('a[href="/"]').click();
    await expect(page).toHaveURL(/\/$/);
    await bar.getByRole("link", { name: "Activity" }).click();
    await expect(page).toHaveURL(/\/transactions$/);
    await expect(needs(page)).toBeVisible();
  });

  test("+ opens TemplateModal as a sheet, and a new item lands in the list", async ({ page }) => {
    await enterPocket(page, { path: "/transactions?tab=recurring" });
    await page.locator("[data-pocket-header]").getByRole("button", { name: "New recurring item" }).click();
    const form = sheet(page);
    await expect(form.getByRole("heading", { name: "New recurring item" })).toBeVisible();
    await form.getByRole("textbox").first().fill("Gym");
    await form.getByRole("spinbutton").first().fill("1500");
    await form.getByRole("button", { name: "Save", exact: true }).click();
    await expect(form).toBeHidden();
    await expect(snackbar(page)).toContainText("Saved");
    await expect(recurringRows(page).filter({ hasText: "Gym" })).toBeVisible();
    await expect.poll(async () => (await store(page)).templates.some((t) => t.name === "Gym")).toBe(true);
  });
});

test.describe("Pocket activity, setting off", () => {
  test("the Classic page is untouched and /recurring still redirects", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/welcome");
    await page.getByRole("button", { name: /demo/i }).click();
    await expect(page.getByText(/Net worth|Toplam varlık/).first()).toBeVisible({ timeout: 15_000 });
    await page.goto("/transactions");
    await expect(page.getByRole("tablist", { name: "Transactions" })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("[data-pocket-shell]")).toHaveCount(0);
    await expect(page.locator("h1[data-pocket-title]")).toHaveCount(0);
    await page.goto("/recurring");
    await expect(page).toHaveURL(/\/transactions\?tab=recurring$/);
    await expect(page.getByRole("tab", { name: "Recurring" })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("[data-commitments]")).toHaveCount(0);
  });
});

test.describe("Pocket activity at other phone widths", () => {
  for (const width of [402, 440]) {
    test(`fits ${width}px: no sideways scroll, no wrapped figure, on both tabs`, async ({ page }) => {
      await enterPocket(page, { width });
      await expect(needs(page)).toBeVisible();
      await noSideScroll(page, width);
      await tabs(page).getByRole("button", { name: "Recurring" }).click();
      await expect(page.locator("[data-commitments]")).toBeVisible();
      await noSideScroll(page, width);
    });
  }
});

test.describe("Pocket activity, Turkish", () => {
  test("reads naturally", async ({ page }) => {
    await enterPocket(page, { locale: "tr" });
    await expect(needs(page).locator("#overdue")).toHaveText(/^Gecikmiş · \d+ · [+−]\$/);
    await expect(chip(page, "Hesap: Tüm hesaplar")).toBeVisible();
    await expect(monthHeads(page).first()).toHaveText(/^\p{L}+ \d{4}$/u);
    await page.screenshot({ path: `${SHOTS}/pocket-activity-ledger-tr-light.png` });
    await tabs(page).getByRole("button", { name: "Düzenli" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Taahhütler" })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/pocket-activity-recurring-tr-light.png` });
  });
});

test.describe("Pocket activity, dark", () => {
  test.use({ colorScheme: "dark" });

  test("screenshots", async ({ page }) => {
    await enterPocket(page);
    await page.screenshot({ path: `${SHOTS}/pocket-activity-ledger-dark.png` });
    await page.mouse.wheel(0, 700);
    await expect(page.locator("[data-pocket-header]")).toHaveAttribute("data-condensed", "");
    await page.screenshot({ path: `${SHOTS}/pocket-activity-ledger-scrolled-dark.png` });
    await page.evaluate(() => window.scrollTo(0, 0));

    await historyRow(page, "To Ziraat TRY").getByRole("button").first().click();
    await expect(sheet(page)).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/pocket-activity-sheet-dark.png` });
    await page.keyboard.press("Escape");
    await expect(sheet(page)).toBeHidden();

    await chip(page, "Account: All accounts").click();
    await expect(sheet(page)).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/pocket-activity-accounts-dark.png` });
    await sheet(page).getByRole("radio", { name: /Ziraat TRY/ }).click();
    await chip(page, "Planned").click();
    await page.screenshot({ path: `${SHOTS}/pocket-activity-chips-dark.png` });

    await page.goto("/transactions?tab=recurring");
    await expect(page.locator("[data-commitments]")).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: `${SHOTS}/pocket-activity-recurring-dark.png` });
    await recurringRows(page).filter({ hasText: "VICTVS retainer" }).getByRole("button").click();
    await expect(sheet(page)).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/pocket-activity-template-sheet-dark.png` });
  });
});

test.describe("Pocket activity: selection mode", () => {
  /** planned rows past their date, cloned from the demo's Weekly market */
  const overdueRows =
    (rows: Array<[string, string]>) =>
    (s: Store) => {
      const model = s.transactions.find((t) => t.description === "Weekly market")!;
      for (const [description, dueDate] of rows) {
        s.transactions.push({ ...model, id: crypto.randomUUID(), description, dueDate, status: "planned", completedAt: null } as StoredTx);
      }
    };
  const selectButton = (page: Page) => page.getByRole("button", { name: "Select", exact: true });
  const bar = (page: Page) => page.locator("[data-selection-bar]");
  const summary = (page: Page) => page.locator("[data-selection-summary]");
  const cardRow = (page: Page, text: string) => needs(page).locator("li").filter({ hasText: text }).getByRole("button").first();
  const byDescription = async (page: Page, description: string) =>
    (await store(page)).transactions.find((t) => t.description === description) as (StoredTx & { legacy?: boolean }) | undefined;

  test("choose two overdue rows and mark them paid", async ({ page }) => {
    await enterPocket(page, { edit: overdueRows([["Gym fee", isoFromToday(-3)], ["Phone bill", isoFromToday(-6)]]) });
    await expect(needs(page).getByText("Gym fee")).toBeVisible();

    await selectButton(page).click();
    await expect(selectButton(page)).toHaveAttribute("aria-pressed", "true");
    await expect(summary(page)).toHaveText("Tap entries to select them");
    // the ✓ steps aside; a tap chooses instead of opening the sheet
    await expect(needs(page).getByRole("button", { name: /^Mark Gym fee as paid/ })).toHaveCount(0);
    await cardRow(page, "Gym fee").click();
    await expect(sheet(page)).toHaveCount(0);
    await expect(cardRow(page, "Gym fee")).toHaveAttribute("aria-pressed", "true");
    await cardRow(page, "Phone bill").click();
    await expect(summary(page)).toHaveText("2 selected");
    // a second tap lets one go, a third takes it back
    await cardRow(page, "Phone bill").click();
    await expect(summary(page)).toHaveText("1 selected");
    await cardRow(page, "Phone bill").click();
    await expect(summary(page)).toHaveText("2 selected");

    await bar(page).getByRole("button", { name: "Mark as paid" }).click();
    await expect(sheet(page)).toContainText("Mark 2 entries as paid");
    const choices = sheet(page).getByRole("listitem");
    // neither is long overdue: plain first
    await expect(choices.first()).toHaveText(/^Mark as paid$/);
    await expect(choices.nth(1)).toContainText("Mark as paid, as legacy");
    await choices.first().getByRole("button").click();

    await expect(page.locator("[role=status]").filter({ hasText: "Marked 2 paid" })).toBeVisible();
    await expect.poll(async () => (await byDescription(page, "Gym fee"))?.status).toBe("completed");
    expect((await byDescription(page, "Phone bill"))?.status).toBe("completed");
    expect((await byDescription(page, "Gym fee"))?.legacy).toBe(false);
    // done: selection mode ends
    await expect(bar(page)).toHaveCount(0);
    await expect(selectButton(page)).toHaveAttribute("aria-pressed", "false");
    await expect(needs(page).getByText("Gym fee")).toHaveCount(0);
  });

  test("rows long overdue offer legacy first", async ({ page }) => {
    await enterPocket(page, { edit: overdueRows([["Old gym fee", monthsAgo(5)], ["Old phone bill", monthsAgo(6)]]) });
    await selectButton(page).click();
    await cardRow(page, "Old gym fee").click();
    await cardRow(page, "Old phone bill").click();
    await expect(summary(page)).toHaveText("2 selected");
    await bar(page).getByRole("button", { name: "Mark as paid" }).click();
    const choices = sheet(page).getByRole("listitem");
    await expect(choices.first()).toContainText("Mark as paid, as legacy");
    await choices.first().getByRole("button").click();
    await expect.poll(async () => (await byDescription(page, "Old gym fee"))?.status).toBe("completed");
    expect((await byDescription(page, "Old gym fee"))?.legacy).toBe(true);
    expect((await byDescription(page, "Old phone bill"))?.legacy).toBe(true);
  });

  test("delete asks for a second tap", async ({ page }) => {
    await enterPocket(page, { edit: overdueRows([["Gym fee", isoFromToday(-3)], ["Phone bill", isoFromToday(-6)]]) });
    await selectButton(page).click();
    await cardRow(page, "Gym fee").click();
    await cardRow(page, "Phone bill").click();
    await bar(page).getByRole("button", { name: "Delete" }).click();
    await expect(sheet(page)).toContainText("Delete 2 entries");
    const remove = sheet(page).getByRole("button", { name: "Delete 2 entries" });
    await remove.click();
    await expect(sheet(page).getByRole("button", { name: "Tap again to confirm" })).toBeVisible();
    expect(await byDescription(page, "Gym fee")).toBeDefined();
    await sheet(page).getByRole("button", { name: "Tap again to confirm" }).click();
    await expect(page.locator("[role=status]").filter({ hasText: "Deleted 2" })).toBeVisible();
    await expect.poll(async () => await byDescription(page, "Gym fee")).toBeUndefined();
    expect(await byDescription(page, "Phone bill")).toBeUndefined();
  });

  test("the writes stop at the first that fails; the rest stay chosen", async ({ page }) => {
    // demo saves throw once window.__savesLeft runs out, the way a full localStorage does
    await page.addInitScript(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key: string, value: string) {
        const w = window as unknown as { __savesLeft?: number };
        if (key === "renovator-demo-v5" && w.__savesLeft != null && w.__savesLeft-- <= 0) {
          throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
        }
        return original.call(this, key, value);
      };
    });
    await enterPocket(page, {
      edit: overdueRows([
        ["Gym fee", isoFromToday(-3)],
        ["Phone bill", isoFromToday(-4)],
        ["Water bill", isoFromToday(-5)],
      ]),
    });
    await selectButton(page).click();
    for (const name of ["Gym fee", "Phone bill", "Water bill"]) await cardRow(page, name).click();
    await expect(summary(page)).toHaveText("3 selected");
    await page.evaluate(() => ((window as unknown as { __savesLeft?: number }).__savesLeft = 1));
    await bar(page).getByRole("button", { name: "Mark as paid" }).click();
    await sheet(page).getByRole("listitem").first().getByRole("button").click();

    await expect(page.getByRole("alert").filter({ hasText: /Couldn't save/ })).toBeVisible();
    await expect(page.locator("[role=status]").filter({ hasText: "Stopped after 1 of 3" })).toBeVisible();
    // the first went through; the one that failed and the one after it are still planned, and still chosen
    await expect(summary(page)).toHaveText("2 selected");
    const states = await page.evaluate(() => {
      (window as unknown as { __savesLeft?: number }).__savesLeft = undefined;
      const s = JSON.parse(localStorage.getItem("renovator-demo-v5") ?? "{}") as { transactions: Array<{ description: string; status: string }> };
      return Object.fromEntries(s.transactions.filter((t) => /^(Gym fee|Phone bill|Water bill)$/.test(t.description)).map((t) => [t.description, t.status]));
    });
    const completedFirst = Object.values(states).filter((v) => v === "completed").length;
    expect(completedFirst).toBe(1);
    expect(Object.values(states).filter((v) => v === "planned").length).toBe(2);
  });
});
