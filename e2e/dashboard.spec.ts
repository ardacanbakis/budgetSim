import { expect, Page, test } from "@playwright/test";
import { pinRates } from "./support/rates";

// the same rates in every run, offline or in CI (see support/rates.ts)
test.beforeEach(async ({ page }) => {
  await pinRates(page);
});

/**
 * The dashboards' cards and accounts: the layout the user keeps for them
 * (lib/ui/dashboardLayout.ts), synced in user_settings.dashboard_layout, and
 * what Classic, version 2 and Settings do with it. Runs in the demo.
 */

const DEMO_KEY = "renovator-demo-v5";

interface StoredLayout {
  order: string[];
  hidden: string[];
  shown?: string[];
  accounts?: { hidden: string[]; hideEmpty: boolean; limit: number | null };
  upcomingDays?: number;
}

async function enterDemo(page: Page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/welcome");
  await page.getByRole("button", { name: /demo/i }).click();
  await expect(page.getByText(/Net worth|Toplam varlık/)).toBeVisible({ timeout: 15_000 });
}

const storedLayout = (page: Page) =>
  page.evaluate(
    (key) => (JSON.parse(localStorage.getItem(key) ?? "{}").settings?.dashboardLayout ?? null) as StoredLayout | null,
    DEMO_KEY
  );

const card = (page: Page, id: string) => page.locator(`[data-card="${id}"]`);

test.describe("Classic dashboard layout", () => {
  test("a hidden card comes back from a translated chip, and the choice survives a reload", async ({ page }) => {
    await enterDemo(page);
    await expect(card(page, "goals")).toBeVisible();
    // the gold lens has never been on Classic, and still isn't
    await expect(card(page, "gold-lens")).toHaveCount(0);
    // nothing is written just by looking
    expect(await storedLayout(page)).toBeNull();

    await page.getByRole("button", { name: /Edit layout/ }).click();
    const chips = page.locator("[data-cards-off] button");
    // the cards that are off by default are offered too, by name
    await expect(chips).toHaveText(["+ In gold"]);
    await expect(page.getByRole("link", { name: /More options/ })).toHaveAttribute("href", "/settings?tab=dashboard");

    await card(page, "goals").getByRole("button", { name: "Hide" }).click();
    await expect(card(page, "goals")).toHaveCount(0);
    await expect(chips).toHaveText(["+ Goals", "+ In gold"]);
    await expect.poll(async () => (await storedLayout(page))?.hidden).toEqual(["goals"]);

    await page.reload();
    await expect(card(page, "net-worth")).toBeVisible({ timeout: 15_000 });
    await expect(card(page, "goals")).toHaveCount(0);

    await page.getByRole("button", { name: /Edit layout/ }).click();
    await page.getByRole("button", { name: "+ Goals" }).click();
    await expect(card(page, "goals")).toBeVisible();
    await expect(chips).toHaveText(["+ In gold"]);
    await expect.poll(async () => (await storedLayout(page))?.hidden).toEqual([]);

    // and a card that was off by default is turned on the same way
    await page.getByRole("button", { name: "+ In gold" }).click();
    await expect(card(page, "gold-lens")).toBeVisible();
    // an explicit choice either way, so it holds in every style
    await expect.poll(async () => (await storedLayout(page))?.shown).toEqual(["goals", "gold-lens"]);
  });

  test("the arrows move a card among those on screen and the order is saved", async ({ page }) => {
    await enterDemo(page);
    await page.getByRole("button", { name: /Edit layout/ }).click();
    await card(page, "safe-to-spend").getByRole("button", { name: "Move up" }).click();
    await expect.poll(async () => (await storedLayout(page))?.order.slice(0, 2)).toEqual(["safe-to-spend", "net-worth"]);
    await expect(page.locator("[data-card]").first()).toHaveAttribute("data-card", "safe-to-spend");

    await page.reload();
    await expect(page.locator("[data-card]").first()).toHaveAttribute("data-card", "safe-to-spend", { timeout: 15_000 });
  });

  test("names the cards in Turkish", async ({ page }) => {
    await enterDemo(page);
    await page.evaluate(() => localStorage.setItem("renovator-locale", "tr"));
    await page.reload();
    await page.getByRole("button", { name: /Düzeni düzenle/ }).click();
    await expect(page.locator("[data-cards-off] button")).toHaveText(["+ Altın cinsinden"]);
    await expect(page.getByRole("link", { name: /Diğer seçenekler/ })).toBeVisible();
  });
});

/**
 * Changes the stored demo data the way another device's save would, then
 * reloads: a zero-balance account (the demo has none) and the dashboards'
 * account choices.
 */
async function seedAccounts(page: Page, accounts: Partial<NonNullable<StoredLayout["accounts"]>> | null, addEmpty = true) {
  await page.evaluate(
    ({ key, accounts, addEmpty }) => {
      const store = JSON.parse(localStorage.getItem(key) ?? "{}");
      if (addEmpty && !store.accounts.some((a: { name: string }) => a.name === "Empty drawer")) {
        const template = store.accounts.find((a: { name: string }) => a.name === "Ziraat TRY");
        store.accounts.push({ ...template, id: "e2e-empty-drawer", name: "Empty drawer", openingBalance: 0 });
      }
      const ziraat = store.accounts.find((a: { name: string }) => a.name === "Ziraat TRY").id;
      if (accounts) {
        const layout = store.settings.dashboardLayout ?? { order: [], hidden: [] };
        layout.accounts = {
          hidden: [],
          hideEmpty: false,
          limit: 5,
          ...accounts,
          // "ziraat" stands in for the demo's generated id
          ...(accounts.hidden ? { hidden: accounts.hidden.map((id) => (id === "ziraat" ? ziraat : id)) } : {}),
        };
        store.settings.dashboardLayout = layout;
      }
      localStorage.setItem(key, JSON.stringify(store));
    },
    { key: DEMO_KEY, accounts, addEmpty }
  );
  await page.reload();
  await expect(card(page, "net-worth")).toBeVisible({ timeout: 15_000 });
}

const accountsCard = (page: Page) => card(page, "accounts");

test.describe("Dashboard accounts", () => {
  test("Classic lists accounts by value with cards as owed, up to its limit", async ({ page }) => {
    await enterDemo(page);
    const rows = accountsCard(page).locator("div.flex.justify-between");
    // six open accounts, five shown: the biggest first, then "+1 more"
    await expect(rows).toHaveCount(5);
    await expect(accountsCard(page).getByRole("link", { name: "+1 more →" })).toHaveAttribute("href", "/accounts");
    await expect(accountsCard(page)).not.toContainText("Bonus Card");

    // with no limit the card comes last, at what it's owed
    await seedAccounts(page, { limit: null }, false);
    await expect(rows).toHaveCount(6);
    await expect(rows.last()).toContainText("Bonus Card");
    await expect(rows.last()).toContainText("−₺90,220.30");
  });

  test("hiding an account or the empty ones tidies every dashboard and moves no total", async ({ page }) => {
    await enterDemo(page);
    const netWorth = (await card(page, "net-worth").textContent())!;

    await seedAccounts(page, { limit: null });
    await expect(accountsCard(page)).toContainText("Empty drawer");
    await expect(card(page, "net-worth")).toHaveText(netWorth);

    await seedAccounts(page, { limit: null, hideEmpty: true, hidden: ["ziraat"] });
    await expect(accountsCard(page)).not.toContainText("Empty drawer");
    await expect(accountsCard(page)).not.toContainText("Ziraat TRY");
    await expect(accountsCard(page).locator("[data-accounts-left-out]")).toHaveText("1 hidden · 1 empty");
    await expect(accountsCard(page).locator("[data-accounts-left-out]")).toHaveAttribute(
      "href",
      "/settings?tab=dashboard#accounts"
    );
    await expect(card(page, "net-worth")).toHaveText(netWorth);

    // version 2 reads the same choices
    await page.evaluate(() => localStorage.setItem("renovator-ui-style", "calm"));
    await page.reload();
    await expect(page.getByText(/Net worth · USD/)).toBeVisible({ timeout: 15_000 });
    await expect(accountsCard(page).locator("[data-accounts-left-out]")).toHaveText("1 hidden · 1 empty");
    await expect(accountsCard(page)).toContainText("Wise USD");
    await expect(accountsCard(page)).not.toContainText("Ziraat TRY");
    await expect(accountsCard(page)).not.toContainText("Empty drawer");
  });
});

test.describe("Pocket accounts strip", () => {
  test("leaves out the hidden account and counts it on the end tile", async ({ page }) => {
    await enterDemo(page);
    await seedAccounts(page, { hidden: ["ziraat"] }, false);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => {
      localStorage.setItem("renovator-phone-layout", "pocket");
      localStorage.removeItem("renovator-pocket-home");
    });
    await page.reload();
    const strip = page.locator("section").filter({ has: page.getByRole("heading", { name: "Accounts" }) });
    await expect(strip.locator("li").last()).toContainText("All accounts", { timeout: 15_000 });
    await expect(strip.locator("li").last()).toContainText("+1");
    await expect(strip.getByRole("link", { name: /Wise USD/ })).toBeVisible();
    await expect(strip.getByRole("link", { name: /Ziraat TRY/ })).toHaveCount(0);
    // cards still come last among the tiles
    await expect(strip.locator("li").nth(-2)).toContainText("Bonus Card");
  });
});

const tabButton = (page: Page, name: RegExp) => page.getByRole("button", { name });

test.describe("Settings → Dashboard", () => {
  test("opens by link, is remembered, and switching tabs keeps working after a query", async ({ page }) => {
    await enterDemo(page);
    await page.goto("/settings?tab=dashboard");
    await expect(tabButton(page, /Dashboard$/)).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("heading", { name: "Dashboard cards" })).toBeVisible();
    await expect(page.getByText(/This one uses the Classic style/)).toBeVisible();

    // the tabs still switch, and say so in the URL
    await tabButton(page, /Data$/).click();
    await expect(page).toHaveURL(/\/settings\?tab=data$/);
    await expect(tabButton(page, /Data$/)).toHaveAttribute("aria-pressed", "true");
    await tabButton(page, /Dashboard$/).click();
    await expect(page).toHaveURL(/\/settings\?tab=dashboard$/);

    // the sidebar's plain /settings brings no old query back, and opens the last tab
    const sidebar = page.locator("aside nav");
    await sidebar.locator('a[href="/accounts"]').click();
    await expect(page).toHaveURL(/\/accounts$/);
    await sidebar.locator('a[href="/settings"]').click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(tabButton(page, /Dashboard$/)).toHaveAttribute("aria-pressed", "true");
    await tabButton(page, /Preferences$/).click();
    await expect(page).toHaveURL(/\/settings\?tab=preferences$/);
    await expect(page.getByText(/Display currency/).first()).toBeVisible();
  });

  test("a card switched on in Settings shows on the dashboard and stays on", async ({ page }) => {
    await enterDemo(page);
    await page.goto("/settings?tab=dashboard");
    const gold = page.getByRole("checkbox", { name: "Show In gold" });
    await expect(gold).not.toBeChecked();
    await gold.check();
    await expect(gold).toBeChecked();
    // Upcoming's range sits under it while it's on
    const range = page.getByRole("group", { name: "Looks ahead" });
    await expect(range.getByRole("button", { name: "30 days" })).toHaveAttribute("aria-pressed", "true");
    await range.getByRole("button", { name: "14 days" }).click();
    await expect.poll(async () => (await storedLayout(page))?.upcomingDays).toBe(14);
    await page.getByRole("checkbox", { name: "Show Upcoming" }).uncheck();
    await expect(range).toHaveCount(0);

    await page.goto("/");
    await expect(card(page, "gold-lens")).toBeVisible({ timeout: 15_000 });
    await expect(card(page, "upcoming")).toHaveCount(0);
    await page.reload();
    await expect(card(page, "gold-lens")).toBeVisible({ timeout: 15_000 });
    // the net-worth words stay the net-worth card's alone
    await expect(page.getByText(/Net worth|Toplam varlık/)).toBeVisible();

    // and Reset puts every card back
    await page.goto("/settings?tab=dashboard");
    await page.getByRole("button", { name: "Reset cards" }).click();
    await expect(gold).not.toBeChecked();
    await expect(page.getByRole("checkbox", { name: "Show Upcoming" })).toBeChecked();
  });

  test("the account choices tidy the dashboard and say totals don't change", async ({ page }) => {
    await enterDemo(page);
    const netWorth = (await card(page, "net-worth").textContent())!;
    await seedAccounts(page, null);
    await page.goto("/settings?tab=dashboard");
    await expect(page.getByText("Hidden accounts still count in every total")).toBeVisible();
    await page.getByRole("switch", { name: "Hide empty accounts (1 now)" }).check();
    await page.getByRole("checkbox", { name: "Show Ziraat TRY on the dashboards" }).uncheck();
    await page.getByRole("combobox").filter({ has: page.locator("option", { hasText: "All" }) }).selectOption("all");
    await expect.poll(async () => (await storedLayout(page))?.accounts).toMatchObject({ hideEmpty: true, limit: null });

    await page.goto("/");
    await expect(accountsCard(page)).toContainText("Wise USD", { timeout: 15_000 });
    await expect(accountsCard(page)).not.toContainText("Ziraat TRY");
    await expect(accountsCard(page)).not.toContainText("Empty drawer");
    await expect(card(page, "net-worth")).toHaveText(netWorth);

    // the footer leads back to the account list in Settings
    await accountsCard(page).locator("[data-accounts-left-out]").click();
    await expect(page).toHaveURL(/\/settings\?tab=dashboard#accounts$/);
    await expect(page.getByRole("heading", { name: "Dashboard accounts" })).toBeInViewport();
    await page.getByRole("button", { name: "Show all accounts" }).click();
    await expect(page.getByRole("checkbox", { name: "Show Ziraat TRY on the dashboards" })).toBeChecked();
  });

  test("reads in Turkish", async ({ page }) => {
    await enterDemo(page);
    await page.evaluate(() => localStorage.setItem("renovator-locale", "tr"));
    await page.goto("/settings?tab=dashboard");
    await expect(tabButton(page, /Özet$/)).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("heading", { name: "Özet kartları" })).toBeVisible();
    await expect(page.getByText(/Gizli hesaplar her toplamda sayılmaya devam eder/)).toBeVisible();
  });
});

test.describe("Version 2 dashboard", () => {
  test("follows the cards chosen in Settings and keeps its headline", async ({ page }) => {
    await enterDemo(page);
    await page.evaluate(() => localStorage.setItem("renovator-ui-style", "calm"));
    await page.reload();
    await expect(page.getByText(/Net worth · USD/)).toBeVisible({ timeout: 15_000 });
    for (const id of ["safe-to-spend", "cc-debt", "victvs", "accounts", "upcoming", "monthly-flow", "gold-lens", "budgets", "goals", "avg-spend"]) {
      await expect(card(page, id)).toBeVisible();
    }
    await expect(page.getByRole("link", { name: /Customise/ })).toHaveAttribute("href", "/settings?tab=dashboard");

    await page.goto("/settings?tab=dashboard");
    await expect(page.getByText(/This one uses the Calm style/)).toBeVisible();
    // the headline can't be turned off in this style
    await expect(page.getByRole("checkbox", { name: "Show Net worth" })).toBeDisabled();
    await page.getByRole("checkbox", { name: "Show In gold" }).uncheck();
    await page.getByRole("checkbox", { name: "Show Safe to spend" }).uncheck();
    await page.getByRole("checkbox", { name: "Show Upcoming" }).uncheck();
    await page.getByRole("button", { name: "Move up: Avg monthly spending" }).click();
    await expect.poll(async () => (await storedLayout(page))?.hidden).toEqual(["gold-lens", "safe-to-spend", "upcoming"]);

    await page.goto("/");
    await expect(page.getByText(/Net worth · USD/)).toBeVisible({ timeout: 15_000 });
    await expect(card(page, "gold-lens")).toHaveCount(0);
    await expect(card(page, "safe-to-spend")).toHaveCount(0);
    await expect(card(page, "upcoming")).toHaveCount(0);
    await expect(card(page, "cc-debt")).toBeVisible();
    // the grid follows the layout's order
    const grid = page.locator("[data-card='budgets'], [data-card='goals'], [data-card='avg-spend']");
    await expect(grid).toHaveCount(3);
    expect(await grid.evaluateAll((els) => els.map((el) => el.getAttribute("data-card")))).toEqual(["budgets", "avg-spend", "goals"]);
    // accounts alone take the full width
    const width = await card(page, "accounts").evaluate((el) => el.getBoundingClientRect().width);
    const full = await page.locator("[data-card='monthly-flow']").evaluate((el) => el.getBoundingClientRect().width);
    expect(Math.abs(width - full)).toBeLessThan(2);
  });
});

test.describe("Upcoming", () => {
  /** A planned transfer between two of your own accounts, `days` ahead, as both its legs. */
  async function seedTransfer(page: Page, days: number) {
    await page.evaluate(
      ({ key, days }) => {
        const store = JSON.parse(localStorage.getItem(key) ?? "{}");
        const id = (name: string) => store.accounts.find((a: { name: string }) => a.name === name).id;
        const d = new Date();
        d.setDate(d.getDate() + days);
        const due = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        const leg = {
          categoryId: null,
          status: "planned",
          dueDate: due,
          completedAt: null,
          description: "Move to savings",
          fxSnapshot: null,
          transferGroupId: "e2e-transfer",
          transferMarketRate: null,
          recurringTemplateId: null,
          loanId: null,
          victvsPayoutId: null,
          purchaseId: null,
          legacy: false,
          createdAt: new Date().toISOString(),
        };
        store.transactions.push(
          { ...leg, id: "e2e-leg-out", accountId: id("Ziraat TRY"), direction: "expense", amount: 4000 },
          { ...leg, id: "e2e-leg-in", accountId: id("EUR Savings"), direction: "income", amount: 80 }
        );
        // only a week ahead, so the list stays short enough to show it
        store.settings.dashboardLayout = { order: [], hidden: [], upcomingDays: 7 };
        localStorage.setItem(key, JSON.stringify(store));
      },
      { key: DEMO_KEY, days }
    );
    await page.reload();
    await expect(card(page, "net-worth")).toBeVisible({ timeout: 15_000 });
  }

  test("Classic lists card statements with Pay, and a transfer once", async ({ page }) => {
    await enterDemo(page);
    const upcoming = card(page, "upcoming");
    const statement = upcoming.locator("[data-upcoming=card]").filter({ hasText: "Bonus Card" });
    await expect(statement).toBeVisible();
    // the VICTVS card shows the unpaid sessions, so Upcoming doesn't repeat them
    await expect(upcoming.locator("[data-upcoming=victvs]")).toHaveCount(0);

    // Pay opens the payment form over the dashboard instead of following the card's link
    await statement.getByRole("button", { name: "Pay Bonus Card" }).click();
    const form = page.getByText(/ — Bonus Card$/);
    await expect(form).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
    await page.keyboard.press("Escape");
    await expect(form).toHaveCount(0);

    await seedTransfer(page, 3);
    await expect(upcoming.getByText("Move to savings")).toHaveCount(1);
    await expect(upcoming.getByRole("heading", { name: "Upcoming" })).toBeVisible();
  });

  test("version 2 lists the same, and the VICTVS row comes back when its card is off", async ({ page }) => {
    await enterDemo(page);
    await seedTransfer(page, 3);
    await page.evaluate(() => localStorage.setItem("renovator-ui-style", "calm"));
    await page.reload();
    const upcoming = card(page, "upcoming");
    await expect(upcoming.locator("[data-upcoming=card]").filter({ hasText: "Bonus Card" })).toBeVisible({ timeout: 15_000 });
    await expect(upcoming.getByText("Move to savings")).toHaveCount(1);
    await expect(upcoming.getByRole("button", { name: /Complete/ }).first()).toBeVisible();
    await expect(upcoming.locator("[data-upcoming=victvs]")).toHaveCount(0);

    await page.goto("/settings?tab=dashboard");
    await page.getByRole("checkbox", { name: "Show Unpaid VICTVS" }).uncheck();
    await page.goto("/");
    await expect(upcoming.locator("[data-upcoming=victvs]")).toContainText(/unpaid session/, { timeout: 15_000 });
  });
});
