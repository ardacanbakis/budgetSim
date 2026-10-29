import { expect, Page, test } from "@playwright/test";
import { pinRates } from "./support/rates";

// the same rates in every run, offline or in CI (see support/rates.ts)
test.beforeEach(async ({ page }) => {
  await pinRates(page);
});

/**
 * The Classic Timeline tab (/reports?tab=timeline): the stream with its
 * Today divider, the side panel, and the Ledger tab's own actions. Runs in
 * the demo at 1280×800.
 */

const DEMO_KEY = "renovator-demo-v5";
const SHOTS = "e2e/screenshots";

interface Store {
  accounts: Array<{ id: string; name: string; paymentDay: number | null; openingBalance: number }>;
  transactions: Array<{
    id: string;
    accountId: string;
    description: string;
    status: string;
    dueDate: string;
    amount: number;
    transferGroupId: string | null;
    direction: string;
  }>;
}

/** A big planned lira bill `days` out, so the runway runs short on that day whatever today is. */
function bigBill(s: Store, days: number) {
  const dentist = s.transactions.find((t) => t.description === "Dentist follow-up")!;
  s.transactions.push({ ...dentist, id: "e2e-big-bill", description: "Roof repair", amount: 1_000_000, dueDate: isoFromToday(days) });
}

/** "30 Oct", as the Timeline writes a day */
const shortDay = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
};

/** the weekday before, not before today */
function businessDayBefore(days: number): string {
  let back = days - 1;
  for (;;) {
    const d = new Date();
    d.setDate(d.getDate() + back);
    if (d.getDay() !== 0 && d.getDay() !== 6) break;
    back -= 1;
  }
  return isoFromToday(Math.max(0, back));
}

/** yyyy-mm-dd, local, `days` from today */
function isoFromToday(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function enterDemo(page: Page, edit?: (store: Store) => void) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/welcome");
  await page.getByRole("button", { name: /demo/i }).click();
  await expect(page.getByText(/Net worth|Toplam varlık/)).toBeVisible({ timeout: 15_000 });
  await page.evaluate(() => {
    for (const key of ["renovator-timeline-milestones", "renovator-timeline-legacy", "renovator-timeline-expected"]) {
      localStorage.removeItem(key);
    }
  });
  if (edit) {
    const saved = await store(page);
    edit(saved);
    await page.evaluate(([key, value]) => localStorage.setItem(key, value), [DEMO_KEY, JSON.stringify(saved)] as const);
  }
}

const store = (page: Page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}") as Store, DEMO_KEY);
const tab = (page: Page, name: RegExp) => page.getByRole("tab", { name });
const timelineTab = (page: Page) => tab(page, /^timeline$|^zaman tüneli$/i);
const ledgerTab = (page: Page) => tab(page, /^transactions$|^işlemler$/i);
const today = (page: Page) => page.getByRole("separator", { name: /^(Today|Bugün) · / });

test.describe("Timeline report", () => {
  test("the first of Reports' reports and the one it opens on; the old address lands there", async ({ page }) => {
    await enterDemo(page);
    await page.goto("/reports");
    await expect(page.getByRole("tablist", { name: "Report" }).getByRole("tab")).toHaveText([
      "Timeline",
      "Cash flow",
      "Spending",
      "Net worth",
    ]);
    await expect(timelineTab(page)).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("heading", { name: "Reports", level: 1 })).toBeVisible();
    await expect(today(page)).toBeVisible();

    // the other reports switch in place, kept in the URL
    await tab(page, /^Cash flow$/).click();
    await expect(page).toHaveURL(/\/reports\?tab=cashflow$/);
    await expect(page.getByText("Month by month", { exact: false })).toBeVisible();
    await expect(today(page)).toHaveCount(0);
    await timelineTab(page).click();
    await expect(page).toHaveURL(/\/reports$/);
    await expect(today(page)).toBeVisible();

    // Transactions keeps the ledger and recurring; the old link redirects, account and all
    await page.goto("/transactions");
    await expect(page.getByRole("tablist", { name: "Transactions" }).getByRole("tab")).toHaveText(["Transactions", "Recurring"]);
    await expect(ledgerTab(page)).toHaveAttribute("aria-selected", "true");
    const ziraat = (await store(page)).accounts.find((a) => a.name === "Ziraat TRY")!;
    await page.goto(`/transactions?tab=timeline&account=${ziraat.id}`);
    await expect(page).toHaveURL(new RegExp(`/reports\\?tab=timeline&account=${ziraat.id}$`));
    await expect(page.getByRole("combobox", { name: "Account" })).toHaveValue(ziraat.id);
    await expect(timelineTab(page)).toHaveAttribute("aria-selected", "true");
  });

  test("the dashboard's Coming up leads to it", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await enterDemo(page);
    await page.goto("/");
    await page.locator('[data-card="upcoming"] a[href="/reports?tab=timeline"]').first().click();
    await expect(page).toHaveURL(/\/reports\?tab=timeline$/);
    await expect(today(page)).toBeVisible();
  });

  test("Today, the Bonus Card statement, the lowest point ahead and the loan's last payment", async ({ page }) => {
    await enterDemo(page);
    await page.goto("/reports?tab=timeline");
    await expect(today(page)).toBeVisible();
    const bonus = page.locator("[data-statement]").filter({ hasText: "Bonus Card statement" }).first();
    await expect(bonus).toBeVisible();
    await bonus.getByRole("button", { name: /charges?/ }).click();
    await expect(bonus.getByText(/Migros \+ market|iPhone 17/).first()).toBeVisible();
    await expect(page.locator("[data-lowest]").getByRole("button", { name: /Ziraat TRY/ })).toBeVisible();
    await expect(page.locator("[data-next30]")).toContainText(/In[\s\S]*Out[\s\S]*Net/);
    const markers = page.locator("[data-markers]");
    await expect(markers.getByText("Car loan — Garanti: last payment")).toBeVisible();
    await expect(markers.getByText("iPhone 17: last instalment")).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/timeline-desktop.png` });

    // milestones off: gone from the panel, and kept on the device
    await page.getByRole("checkbox", { name: "Milestones" }).uncheck();
    await expect(page.locator("[data-markers]")).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem("renovator-timeline-milestones"))).toBe("off");
  });

  test("✓ Complete marks a planned row done, with the Ledger tab's own form", async ({ page }) => {
    await enterDemo(page);
    await page.goto("/reports?tab=timeline");
    const dentist = page.locator("[data-event]").filter({ hasText: "Dentist follow-up" }).first();
    await expect(dentist).toBeVisible();
    const id = (await dentist.getAttribute("data-event"))!;
    await dentist.getByRole("button", { name: /^Complete$/ }).click();
    // Classic's modal: a heading and its buttons, no dialog role
    const heading = page.getByRole("heading", { name: "Complete transaction" });
    await expect(heading).toBeVisible();
    await page.getByRole("button", { name: /^Confirm$/ }).click();
    await expect(heading).toHaveCount(0);
    await expect.poll(async () => (await store(page)).transactions.find((t) => t.id === id)?.status).toBe("completed");
  });

  test("a statement due this week has Pay, which opens the card payment form", async ({ page }) => {
    const day = Number(isoFromToday(2).slice(8));
    await enterDemo(page, (s) => {
      s.accounts.find((a) => a.name === "Bonus Card")!.paymentDay = day;
    });
    await page.goto("/reports?tab=timeline");
    await page.getByRole("button", { name: "Pay Bonus Card" }).first().click();
    await expect(page.getByRole("heading", { name: /Record payment — Bonus Card/ })).toBeVisible();
  });

  test("one account from the link: its chart, and the balance after each row", async ({ page }) => {
    await enterDemo(page);
    const ziraat = (await store(page)).accounts.find((a) => a.name === "Ziraat TRY")!;
    await page.goto(`/reports?tab=timeline&account=${ziraat.id}`);
    await expect(page.getByRole("img", { name: "Ziraat TRY: balance over time" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("combobox", { name: "Account" })).toHaveValue(ziraat.id);
    await expect(page.locator("[data-event] [title='Balance after']").first()).toHaveText(/^→ −?₺[\d,.]+$/);
    // the lowest-point line toggles the account off again
    await page.locator("[data-lowest]").getByRole("button", { name: /Ziraat TRY/ }).click();
    await expect(page).toHaveURL(/\/reports\?tab=timeline$/);
    await expect(page.getByRole("img", { name: /balance over time/ })).toHaveCount(0);
  });

  test("Month sums each month up: biggest outflows, statements, markers", async ({ page }) => {
    await enterDemo(page);
    await page.goto("/reports?tab=timeline");
    await page.getByRole("group", { name: "Show by" }).getByRole("button", { name: "Month" }).click();
    await expect(page.getByRole("heading", { name: "Biggest outflows" }).first()).toBeVisible();
    await expect(today(page)).toBeAttached();
  });

  test("quick jump finds the Timeline", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await enterDemo(page);
    await page.goto("/settings");
    await page.getByRole("button", { name: /^Calm/ }).click();
    await page.goto("/transactions");
    await expect(ledgerTab(page)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Control+k");
    const palette = page.getByRole("dialog", { name: /Quick jump/i });
    await expect(palette).toBeVisible();
    await page.keyboard.type("timeline");
    await expect(palette.getByRole("button", { name: /Timeline/ })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/reports\?tab=timeline$/);
    await expect(timelineTab(page)).toHaveAttribute("aria-selected", "true");
  });

  test("expected VICTVS payouts: dashed, and counted only when switched on", async ({ page }) => {
    await enterDemo(page);
    await page.goto("/reports?tab=timeline");
    const expected = page.locator("[data-expected]").first();
    await expect(expected).toContainText(/VICTVS · expected ~\$[\d,]+/);
    await expect(expected).toContainText("not in balances");
    const income = page.locator("[data-next30] dd").first();
    const amount = async () => Number((await income.innerText()).replace(/[^\d.]/g, ""));
    const before = await amount();
    await page.getByRole("checkbox", { name: "Count expected VICTVS" }).check();
    // this month's payout always lands within the next 30 days
    await expect.poll(amount).toBeGreaterThan(before);
    await expect(expected).not.toContainText("not in balances");
  });

  test("lira runway: short on the day a big bill lands, with the transfer that covers it", async ({ page }) => {
    await enterDemo(page, (s) => bigBill(s, 10));
    await page.goto("/reports?tab=timeline");
    const runway = page.locator("[data-runway]");
    const by = businessDayBefore(10);
    await expect(runway).toHaveAttribute("data-runway", "short");
    await expect(runway).toContainText(
      new RegExp(`^Your lira covers what's planned until ${shortDay(isoFromToday(10))}\\. Convert ≈\\$[\\d,]+ by ${shortDay(by)}\\.`)
    );
    await runway.getByRole("button", { name: "Plan this transfer" }).click();
    await expect(page.getByRole("heading", { name: "Transfer between accounts" })).toBeVisible();
    const s = await store(page);
    const wise = s.accounts.find((a) => a.name === "Wise USD")!;
    const ziraat = s.accounts.find((a) => a.name === "Ziraat TRY")!;
    const selects = page.locator("form select");
    await expect(selects.nth(0)).toHaveValue(wise.id);
    await expect(selects.nth(1)).toHaveValue(ziraat.id);
    await expect(page.locator("form input[type=date]")).toHaveValue(by);
    const amount = Number(await page.locator("form input[inputmode=decimal]").first().inputValue());
    expect(amount % 10).toBe(0);
    expect(amount).toBeGreaterThan(0);
    await page.getByRole("button", { name: /^Confirm$/ }).click();
    await expect(page.getByRole("heading", { name: "Transfer between accounts" })).toHaveCount(0);
    // planned (or done, when the day to convert by is today), from Wise into Ziraat, on that day
    await expect
      .poll(async () => (await store(page)).transactions.filter((t) => t.transferGroupId && t.dueDate === by && t.accountId === wise.id && t.amount === amount).length)
      .toBe(1);
    if (by > isoFromToday(0)) {
      const leg = (await store(page)).transactions.find((t) => t.transferGroupId && t.dueDate === by && t.accountId === wise.id)!;
      expect(leg.status).toBe("planned");
    }
    // and now the lira lasts
    await expect(runway).toHaveAttribute("data-runway", "covered");
  });

  test("lira runway: covered says so", async ({ page }) => {
    await enterDemo(page, (s) => {
      s.accounts.find((a) => a.name === "Ziraat TRY")!.openingBalance = 100_000_000;
    });
    await page.goto("/reports?tab=timeline");
    await expect(page.locator("[data-runway]")).toContainText("Your lira covers everything planned for the next 3 months.");
    await expect(page.getByRole("button", { name: "Plan this transfer" })).toHaveCount(0);
  });

  test("reads naturally in Turkish", async ({ page }) => {
    await enterDemo(page);
    await page.evaluate(() => localStorage.setItem("renovator-locale", "tr"));
    await page.goto("/reports?tab=timeline");
    await expect(timelineTab(page)).toHaveAttribute("aria-selected", "true");
    await expect(today(page)).toHaveAccessibleName(/^Bugün · /);
    await expect(page.getByRole("heading", { name: "Önümüzdeki en düşük nokta" })).toBeVisible();
    await expect(page.locator("[data-statement]").filter({ hasText: "Bonus Card ekstresi" }).first()).toBeVisible();
  });
});
