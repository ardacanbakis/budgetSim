import { expect, Page, test } from "@playwright/test";
import { pinRates } from "./support/rates";

// the same rates in every run, offline or in CI (see support/rates.ts)
test.beforeEach(async ({ page }) => {
  await pinRates(page);
});

/**
 * Pocket's Timeline (/transactions?tab=timeline): the third segment of
 * Activity. Runs in the demo at 390×844 with the Pocket phone layout on;
 * the segment's fit is checked at 390, 402 and 440 in both languages.
 */

const DEMO_KEY = "renovator-demo-v5";
const SHOTS = "e2e/screenshots";

interface StoredAccount {
  id: string;
  name: string;
  paymentDay: number | null;
}
interface Store {
  accounts: StoredAccount[];
  transactions: Array<{ id: string; accountId: string; description: string; dueDate: string; status: string; amount: number; transferGroupId: string | null }>;
}

/** yyyy-mm-dd, local, `days` from today */
function isoFromToday(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function enterPocket(
  page: Page,
  opts: { path?: string; width?: number; locale?: "tr"; edit?: (store: Store) => void; prefs?: Record<string, string> } = {}
) {
  await page.setViewportSize({ width: opts.width ?? 390, height: 844 });
  await page.goto("/welcome");
  await page.getByRole("button", { name: /demo/i }).click();
  await expect(page.getByText(/Net worth|Toplam varlık/).first()).toBeVisible({ timeout: 15_000 });
  await page.evaluate(
    ({ locale, prefs }) => {
      localStorage.setItem("renovator-phone-layout", "pocket");
      for (const key of [
        "renovator-pocket-hide-amounts",
        "renovator-timeline-milestones",
        "renovator-timeline-legacy",
        "renovator-timeline-expected",
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
  await page.goto(opts.path ?? "/transactions?tab=timeline");
  await expect(page.locator("[data-pocket-shell]")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("h1[data-pocket-title]")).toBeVisible({ timeout: 15_000 });
}

const store = (page: Page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}") as Store, DEMO_KEY);
const tabs = (page: Page) => page.getByRole("group", { name: /^(Transactions|İşlemler)$/ });
const today = (page: Page) => page.getByRole("separator", { name: /^(Today|Bugün) · / });
const lowest = (page: Page) => page.locator("[data-lowest]");
const statement = (page: Page) => page.locator("[data-statement]");
const more = (page: Page, name: RegExp) => page.getByRole("button", { name });

/** The segment's buttons each on one line, and nothing wider than the screen. */
async function segmentFits(page: Page, width: number) {
  const buttons = await tabs(page).getByRole("button").all();
  expect(buttons).toHaveLength(3);
  for (const b of buttons) {
    const lines = await b.evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
    });
    expect(lines, `"${await b.innerText()}" on one line`).toBe(1);
    const box = (await b.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(width);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
}

test.describe("Pocket timeline", () => {
  test("the third segment: Transactions | Timeline | Recurring, kept in the URL", async ({ page }) => {
    await enterPocket(page, { path: "/transactions" });
    const timeline = tabs(page).getByRole("button", { name: "Timeline" });
    await expect(tabs(page).getByRole("button")).toHaveText(["Transactions", "Timeline", "Recurring"]);
    await timeline.click();
    await expect(page).toHaveURL(/\/transactions\?tab=timeline$/);
    await expect(timeline).toHaveAttribute("aria-pressed", "true");
    await expect(today(page)).toBeAttached();
    // and back to the ledger, then the timeline again
    await tabs(page).getByRole("button", { name: "Transactions" }).click();
    await expect(page).toHaveURL(/\/transactions$/);
    await timeline.click();
    await expect(today(page)).toBeAttached();
    await page.screenshot({ path: `${SHOTS}/pocket-timeline-light.png` });
  });

  test("today's divider, the lowest point ahead, the card statement, and a taksit's end", async ({ page }) => {
    await enterPocket(page);
    await expect(today(page)).toBeAttached();
    await expect(lowest(page).getByRole("button", { name: /Ziraat TRY/ })).toBeVisible();
    await expect(lowest(page).getByRole("button", { name: /Ziraat TRY/ })).toContainText(/lowest|below zero/);
    // the Bonus Card's statement: one row, its charges folded inside
    const bonus = statement(page).filter({ hasText: "Bonus Card statement" }).first();
    await expect(bonus).toBeVisible();
    await expect(page.locator("main").getByText("Migros + market")).toHaveCount(0);
    await bonus.getByRole("button", { name: /Bonus Card statement/ }).click();
    await expect(bonus.getByRole("button", { name: /Bonus Card statement/ })).toHaveAttribute("aria-expanded", "true");
    // the iPhone's last instalment, a few months out
    const ends = page.locator("[data-milestone]").filter({ hasText: "iPhone 17: last instalment" });
    for (let i = 0; i < 4 && (await ends.count()) === 0; i++) await more(page, /^Show later months$/).click();
    await expect(ends).toBeVisible();
    await expect(ends).toContainText(/frees ₺[\d,.]+\/mo/);
    // the car loan's last payment is years away; it is still on the line
    const loan = page.locator("[data-milestone]").filter({ hasText: "Car loan — Garanti: last payment" });
    for (let i = 0; i < 12 && (await loan.count()) === 0; i++) await more(page, /^Show later months$/).click();
    await expect(loan).toBeVisible();
    await expect(more(page, /^Show later months$/)).toHaveCount(0);
  });

  test("a statement due this week has Pay, which opens the card payment sheet", async ({ page }) => {
    // the payment day two days out keeps the statement inside the week, whatever today is
    const day = Number(isoFromToday(2).slice(8));
    await enterPocket(page, {
      edit: (s) => {
        s.accounts.find((a) => a.name === "Bonus Card")!.paymentDay = day;
      },
    });
    const pay = page.getByRole("button", { name: "Pay Bonus Card" }).first();
    await expect(pay).toBeVisible();
    await pay.click();
    await expect(page.getByRole("dialog")).toContainText(/Record payment|Ödeme kaydet/);
  });

  test("the pill brings today back from either end", async ({ page }) => {
    await enterPocket(page);
    await expect(today(page)).toBeAttached();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const pill = page.locator("[data-jump-today]");
    await expect(pill).toHaveText("↑ Today");
    await pill.click();
    await expect(today(page)).toBeInViewport();
    await expect(pill).toHaveCount(0);
  });

  test("an account from the link: its balance chart, and each day closing on its balance", async ({ page }) => {
    await enterPocket(page);
    const ziraat = (await store(page)).accounts.find((a) => a.name === "Ziraat TRY")!;
    await page.goto(`/transactions?tab=timeline&account=${ziraat.id}`);
    await expect(page.getByRole("img", { name: "Ziraat TRY: balance over time" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Account: Ziraat TRY" })).toBeVisible();
    await expect(page.locator("main section[aria-labelledby]").first().getByText("Balance after")).toBeAttached();
    // picking another account from the chip moves the link with it
    await page.getByRole("button", { name: "Account: Ziraat TRY" }).click();
    await page.getByRole("dialog").getByRole("radio", { name: /All accounts/ }).click();
    await expect(page).toHaveURL(/\/transactions\?tab=timeline$/);
    await expect(page.getByRole("img", { name: /balance over time/ })).toHaveCount(0);
  });

  test("Hide amounts blurs every figure", async ({ page }) => {
    await enterPocket(page, { prefs: { "renovator-pocket-hide-amounts": "on" } });
    const figure = lowest(page).locator("[data-amount]").first();
    await expect(figure).toBeVisible();
    await expect(figure).toHaveCSS("filter", /blur/);
    await expect(statement(page).first().locator("[data-amount]").first()).toHaveCSS("filter", /blur/);
  });

  test("milestones and imported history are switches kept on the device", async ({ page }) => {
    await enterPocket(page);
    const chips = page.getByRole("group", { name: "Timeline filters" });
    await chips.getByRole("button", { name: "Milestones" }).click();
    await expect(chips.getByRole("button", { name: "Milestones" })).toHaveAttribute("aria-pressed", "false");
    expect(await page.evaluate(() => localStorage.getItem("renovator-timeline-milestones"))).toBe("off");
    await page.reload();
    await expect(page.getByRole("group", { name: "Timeline filters" }).getByRole("button", { name: "Milestones" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
  });
});

test.describe("Pocket timeline, expected VICTVS", () => {
  /** This month's heading figure (its net), as text. */
  const monthNet = (page: Page) => {
    const label = new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric" });
    return page.locator("main h2", { hasText: label }).locator("xpath=following-sibling::*[@data-amount][1]");
  };

  test("dashed, with its range, and in the balances only when switched on", async ({ page }) => {
    await enterPocket(page);
    const wise = (await store(page)).accounts.find((a) => a.name === "Wise USD")!;
    const expected = page.locator("[data-expected]").first();
    await expect(expected).toContainText(/^VICTVS · expected ~\$[\d,]+/);
    await expect(expected).toContainText("Wise USD · not in balances");

    // Wise USD alone: this month's net moves by the payout when it counts
    await page.goto(`/transactions?tab=timeline&account=${wise.id}`);
    await expect(page.getByRole("img", { name: "Wise USD: balance over time" })).toBeVisible({ timeout: 15_000 });
    const before = await monthNet(page).innerText();
    const chip = page.getByRole("group", { name: "Timeline filters" }).getByRole("button", { name: "Count expected VICTVS" });
    await expect(chip).toHaveAttribute("aria-pressed", "false");
    await chip.click();
    await expect(chip).toHaveAttribute("aria-pressed", "true");
    await expect(monthNet(page)).not.toHaveText(before);
    await expect(page.locator("[data-expected]").first()).not.toContainText("not in balances");
    expect(await page.evaluate(() => localStorage.getItem("renovator-timeline-expected"))).toBe("on");
  });
});

test.describe("Pocket timeline, lira runway", () => {
  test("short: when, what to convert, and Plan this transfer opens the transfer form filled in", async ({ page }) => {
    await enterPocket(page, {
      edit: (s) => {
        const dentist = s.transactions.find((t) => t.description === "Dentist follow-up")!;
        s.transactions.push({ ...dentist, id: "e2e-big-bill", description: "Roof repair", amount: 1_000_000, dueDate: isoFromToday(10) });
      },
    });
    const runway = page.locator("[data-runway]");
    await expect(runway).toHaveAttribute("data-runway", "short");
    await expect(runway).toContainText(/^Your lira covers what's planned until \d+ \w+\. Convert ≈\$[\d,]+ by \d+ \w+\./);
    // it sits above the lowest point ahead
    expect((await runway.boundingBox())!.y).toBeLessThan((await lowest(page).boundingBox())!.y);
    await runway.getByRole("button", { name: "Plan this transfer" }).click();
    const sheet = page.getByRole("dialog", { name: "Transfer between accounts" });
    await expect(sheet).toBeVisible();
    const wise = (await store(page)).accounts.find((a) => a.name === "Wise USD")!;
    await expect(sheet.locator("select").first()).toHaveValue(wise.id);
    await sheet.getByRole("button", { name: /^Confirm$/ }).click();
    await expect(sheet).toHaveCount(0);
    await expect(runway).toHaveAttribute("data-runway", "covered");
  });

  test("Hide amounts blurs the figure to convert", async ({ page }) => {
    await enterPocket(page, {
      prefs: { "renovator-pocket-hide-amounts": "on" },
      edit: (s) => {
        const dentist = s.transactions.find((t) => t.description === "Dentist follow-up")!;
        s.transactions.push({ ...dentist, id: "e2e-big-bill", description: "Roof repair", amount: 1_000_000, dueDate: isoFromToday(10) });
      },
    });
    await expect(page.locator("[data-runway] [data-amount]").first()).toHaveCSS("filter", /blur/);
  });
});

test.describe("Pocket timeline, widths and Turkish", () => {
  for (const width of [390, 402, 440]) {
    for (const locale of [undefined, "tr"] as const) {
      test(`the three segments fit ${width}px${locale ? " in Turkish" : ""}`, async ({ page }) => {
        await enterPocket(page, { width, locale });
        if (locale) await expect(tabs(page).getByRole("button")).toHaveText(["İşlemler", "Zaman tüneli", "Düzenli"]);
        await expect(today(page)).toBeAttached();
        await segmentFits(page, width);
      });
    }
  }

  test("reads naturally in Turkish", async ({ page }) => {
    await enterPocket(page, { locale: "tr" });
    await expect(page.getByRole("heading", { name: "Önümüzdeki en düşük nokta" })).toBeVisible();
    await expect(today(page)).toHaveAccessibleName(/^Bugün · /);
    await expect(statement(page).filter({ hasText: "Bonus Card ekstresi" }).first()).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/pocket-timeline-tr-light.png` });
  });
});

test.describe("Pocket timeline, dark", () => {
  test.use({ colorScheme: "dark" });

  test("screenshots", async ({ page }) => {
    await enterPocket(page);
    await expect(today(page)).toBeAttached();
    await page.screenshot({ path: `${SHOTS}/pocket-timeline-dark.png` });
    await today(page).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/pocket-timeline-today-dark.png` });
  });
});
