import { expect, Locator, Page, test } from "@playwright/test";
import { pinRates } from "./support/rates";

// the same rates in every run, offline or in CI (see support/rates.ts)
test.beforeEach(async ({ page }) => {
  await pinRates(page);
});

/**
 * Pocket's + sheet: amount first on a keypad, chips for the rest, and a
 * button that says what it will do. Runs in the demo at 390×844 with the
 * Pocket phone layout switched on.
 */

const DEMO_KEY = "renovator-demo-v5";

interface StoredTx {
  id: string;
  accountId: string;
  direction: "income" | "expense";
  categoryId: string | null;
  amount: number;
  status: "planned" | "completed";
  dueDate: string;
  description: string;
  fxSnapshot: unknown;
  transferGroupId: string | null;
}
interface Store {
  accounts: Array<{ id: string; name: string }>;
  categories: Array<{ id: string; name: string }>;
  transactions: StoredTx[];
}

async function enterPocket(page: Page, opts: { locale?: "tr" } = {}) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/welcome");
  await page.getByRole("button", { name: /demo/i }).click();
  await expect(page.getByText(/Net worth|Toplam varlık/).first()).toBeVisible({ timeout: 15_000 });
  await page.evaluate((locale) => {
    localStorage.setItem("renovator-phone-layout", "pocket");
    localStorage.removeItem("renovator-pocket-draft");
    if (locale) localStorage.setItem("renovator-locale", locale);
  }, opts.locale);
  await page.reload();
  await expect(page.locator("[data-pocket-shell]")).toBeVisible({ timeout: 15_000 });
}

const store = (page: Page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}") as Store, DEMO_KEY);

async function openAdd(page: Page): Promise<Locator> {
  await page.locator("nav").getByRole("button", { name: /^(Add|Ekle)$/ }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  return sheet;
}

/** Tap keys on the keypad by their spoken names. */
async function tap(sheet: Locator, keys: string[]) {
  const keypad = sheet.locator("[data-pocket-keypad]");
  for (const key of keys) await keypad.getByRole("button", { name: key, exact: true }).click();
}

const figure = (sheet: Locator) => sheet.locator("output");
// Escape rather than the sheet's ✕: PocketSheet's header takes pointer capture
// on pointerdown, so a pointer click on its close button doesn't reach it yet
const dismiss = (page: Page) => page.keyboard.press("Escape");
const saveButton = (sheet: Locator) => sheet.locator("[data-pocket-add-save]");

test.describe("Pocket add sheet", () => {
  test("keypad sums, rejects ÷0, and keeps Save off until the result is above 0", async ({ page }) => {
    await enterPocket(page);
    const sheet = await openAdd(page);
    await expect(sheet.getByRole("heading", { name: "New expense" })).toBeVisible();
    // no OS keyboard: nothing typeable has focus
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe("INPUT");
    await expect(saveButton(sheet)).toBeDisabled();
    await expect(sheet.getByText("Enter an amount")).toBeVisible();

    await tap(sheet, ["1", "2", "0", "plus", "4", "5"]);
    await expect(figure(sheet)).toHaveText("₺120 + 45");
    await expect(sheet.getByText("= ₺165.00")).toBeVisible();
    await expect(saveButton(sheet)).toHaveText("Add expense ₺165.00");

    // holding ⌫ clears everything
    await sheet.getByRole("button", { name: /delete last/ }).click({ delay: 700 });
    await expect(figure(sheet)).toHaveText("₺0");

    await tap(sheet, ["1", "2", "multiply", "3", "minus", "6"]);
    await expect(sheet.getByText("= ₺30.00")).toBeVisible();
    // a single tap removes one key
    await sheet.getByRole("button", { name: /delete last/ }).click();
    await expect(figure(sheet)).toHaveText("₺12 × 3 −");

    await sheet.getByRole("button", { name: /delete last/ }).click({ delay: 700 });
    await tap(sheet, ["5", "divide", "0"]);
    await expect(sheet.getByText("Can't divide by zero").first()).toBeVisible();
    await expect(saveButton(sheet)).toBeDisabled();

    await sheet.getByRole("button", { name: /delete last/ }).click({ delay: 700 });
    await tap(sheet, ["5", "minus", "5"]);
    await expect(sheet.getByText("= ₺0.00")).toBeVisible();
    await expect(saveButton(sheet)).toBeDisabled();
  });

  test("a bitcoin account takes 8 decimals", async ({ page }) => {
    await enterPocket(page);
    const sheet = await openAdd(page);
    await sheet.getByRole("group", { name: "Pay with" }).getByRole("button", { name: /Cold Wallet/ }).click();
    await tap(sheet, ["0", "decimal separator", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);
    await expect(figure(sheet)).toHaveText("0.12345678 ₿");
  });

  test("adds an expense with TransactionModal's payload, and Undo removes it", async ({ page }) => {
    await enterPocket(page);
    const sheet = await openAdd(page);
    await tap(sheet, ["1", "2", "0"]);
    await sheet.getByRole("group", { name: "Pay with" }).getByRole("button", { name: /Ziraat TRY/ }).click();
    await sheet.getByRole("group", { name: "Category" }).getByRole("button", { name: "Groceries" }).click();
    await expect(saveButton(sheet)).toHaveText("Add expense ₺120.00");
    await saveButton(sheet).click();

    await expect(sheet).toBeHidden();
    const snack = page.getByRole("status").filter({ hasText: "Expense added" });
    await expect(snack).toContainText("Expense added · −₺120.00");

    const saved = await store(page);
    const groceries = saved.categories.find((c) => c.name === "Groceries")!;
    const ziraat = saved.accounts.find((a) => a.name === "Ziraat TRY")!;
    const row = saved.transactions.find((tx) => tx.amount === 120 && tx.categoryId === groceries.id);
    expect(row).toMatchObject({ accountId: ziraat.id, direction: "expense", status: "completed", description: "" });
    expect(row?.fxSnapshot).toBeTruthy();

    await snack.getByRole("button", { name: "Undo" }).click();
    await expect.poll(async () => (await store(page)).transactions.some((tx) => tx.id === row!.id)).toBe(false);

    // the account is remembered for the next expense
    const again = await openAdd(page);
    await expect(again.getByRole("group", { name: "Pay with" }).getByRole("button").first()).toHaveAttribute("aria-pressed", "true");
    await expect(again.getByRole("group", { name: "Pay with" }).getByRole("button").first()).toContainText("Ziraat TRY");
  });

  test("saving without a category asks for one, and choosing it saves", async ({ page }) => {
    await enterPocket(page);
    const sheet = await openAdd(page);
    await tap(sheet, ["5", "0"]);
    await saveButton(sheet).click();
    await expect(sheet.getByRole("heading", { name: "Pick a category to save" })).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Save without category" })).toBeVisible();
    await page.screenshot({ path: "e2e/screenshots/pocket-add-pick-light.png" });
    await sheet.getByRole("button", { name: "Health" }).click();
    await expect(sheet).toBeHidden();
    const saved = await store(page);
    const health = saved.categories.find((c) => c.name === "Health")!;
    expect(saved.transactions.some((tx) => tx.amount === 50 && tx.categoryId === health.id)).toBe(true);
  });

  test("a future date plans the entry; the button says Plan", async ({ page }) => {
    await enterPocket(page);
    const sheet = await openAdd(page);
    await tap(sheet, ["2", "8", "0", "0"]);
    await sheet.getByRole("group", { name: "Category" }).getByRole("button", { name: "Health" }).click();
    const planned = sheet.getByRole("switch", { name: /Not paid yet/ });
    await expect(planned).toHaveAttribute("aria-checked", "false");
    const future = await page.evaluate(() => {
      const d = new Date();
      d.setDate(d.getDate() + 10);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    });
    await sheet.locator("[data-pocket-date]").fill(future);
    await expect(planned).toHaveAttribute("aria-checked", "true");
    await expect(saveButton(sheet)).toHaveText("Plan ₺2,800.00");
    await saveButton(sheet).click();
    await expect(sheet).toBeHidden();
    const row = (await store(page)).transactions.find((tx) => tx.amount === 2800 && tx.dueDate === future);
    expect(row).toMatchObject({ status: "planned", fxSnapshot: null });
  });

  test("an earlier note fills in its account and category", async ({ page }) => {
    await enterPocket(page);
    const sheet = await openAdd(page);
    await sheet.getByLabel("Note").fill("Wee");
    await sheet.getByRole("group", { name: "Earlier notes" }).getByRole("button", { name: "Weekly market" }).click();
    await expect(sheet.getByLabel("Note")).toHaveValue("Weekly market");
    await expect(sheet.getByRole("group", { name: "Category" }).getByRole("button", { name: "Groceries" })).toHaveAttribute("aria-pressed", "true");
    await expect(sheet.getByRole("group", { name: "Pay with" }).getByRole("button", { name: /Ziraat TRY/ })).toHaveAttribute("aria-pressed", "true");
  });

  test("Enter in USD converts into the account's currency", async ({ page }) => {
    await enterPocket(page);
    const sheet = await openAdd(page);
    await sheet.getByRole("group", { name: "Pay with" }).getByRole("button", { name: /Ziraat TRY/ }).click();
    await sheet.getByRole("button", { name: "Enter in USD" }).click();
    await tap(sheet, ["1", "0"]);
    await expect(figure(sheet)).toHaveText("$10");
    await expect(sheet.getByText(/^= ₺[\d,]+\.\d\d will be saved in Ziraat TRY$/)).toBeVisible();
  });

  test("Type instead reads either decimal mark", async ({ page }) => {
    await enterPocket(page);
    const sheet = await openAdd(page);
    await sheet.getByRole("button", { name: "Type instead" }).click();
    const field = sheet.getByLabel(/^Amount/);
    await expect(field).toBeFocused();
    await field.fill("1.250,5");
    await expect(figure(sheet)).toHaveText("₺1,250.5");
    await sheet.getByRole("button", { name: "Use keypad" }).click();
    await expect(sheet.locator("[data-pocket-keypad]")).toBeVisible();
  });

  test("an unsaved entry comes back, and Start over clears it", async ({ page }) => {
    await enterPocket(page);
    let sheet = await openAdd(page);
    await tap(sheet, ["4", "2"]);
    await dismiss(page);
    await expect(sheet).toBeHidden();
    sheet = await openAdd(page);
    await expect(sheet.getByText("Your unsaved entry is back.")).toBeVisible();
    await expect(figure(sheet)).toHaveText("₺42");
    await sheet.getByRole("button", { name: "Start over" }).click();
    await expect(figure(sheet)).toHaveText("₺0");
  });

  test("More types opens the add menu instead of stacking sheets", async ({ page }) => {
    await enterPocket(page);
    const sheet = await openAdd(page);
    await sheet.getByRole("button", { name: "More types" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(page.getByRole("heading", { name: "What to add" })).toBeVisible();
  });

  test("a transfer: you send, they receive, the rate, and Undo removes both legs", async ({ page }) => {
    await enterPocket(page);
    const sheet = await openAdd(page);
    await sheet.getByRole("group", { name: "Kind of entry" }).getByRole("button", { name: "Transfer" }).click();
    await expect(sheet.getByRole("heading", { name: "New transfer" })).toBeVisible();
    await sheet.getByRole("group", { name: "From" }).getByRole("button", { name: /Wise USD/ }).click();
    await sheet.getByRole("group", { name: "To" }).getByRole("button", { name: /Ziraat TRY/ }).click();
    await expect(sheet.getByRole("group", { name: "To" }).getByRole("button", { name: /Wise USD/ })).toHaveCount(0);
    await tap(sheet, ["5", "0", "0"]);
    await expect(sheet.getByText(/^1 USD = [\d.,]+ TRY$/)).toBeVisible();

    // what the bank actually gave
    await sheet.getByRole("button", { name: /They receive/ }).click();
    await tap(sheet, ["2", "0", "0", "0", "0"]);
    await expect(sheet.getByRole("button", { name: /They receive/ })).toContainText("₺20,000");
    await expect(sheet.getByText(/^1 USD = 40 TRY · market [\d.,]+ · [−+]?[\d.]+%$/)).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Use market amount" })).toBeVisible();
    await expect(saveButton(sheet)).toHaveText("Transfer $500.00 → ₺20,000.00");
    await page.screenshot({ path: "e2e/screenshots/pocket-add-transfer-rate-light.png" });

    const before = (await store(page)).transactions.length;
    await saveButton(sheet).click();
    await expect(sheet).toBeHidden();
    const snack = page.getByRole("status").filter({ hasText: "Transfer added" });
    await expect(snack).toContainText("Transfer added · $500.00");
    const legs = (await store(page)).transactions.filter((tx) => tx.transferGroupId && (tx.amount === 500 || tx.amount === 20000));
    expect(legs.length).toBeGreaterThanOrEqual(2);
    expect((await store(page)).transactions.length).toBe(before + 2);

    await snack.getByRole("button", { name: "Undo" }).click();
    await expect.poll(async () => (await store(page)).transactions.length).toBe(before);
  });

  test("Turkish: the decimal key shows a comma and stores a point", async ({ page }) => {
    await enterPocket(page, { locale: "tr" });
    const sheet = await openAdd(page);
    const decimal = sheet.locator("[data-pocket-keypad]").getByRole("button", { name: "ondalık ayırıcı" });
    await expect(decimal).toHaveText(",");
    await sheet.getByRole("group", { name: "Ödeme hesabı" }).getByRole("button", { name: /Ziraat TRY/ }).click();
    await tap(sheet, ["1", "2", "ondalık ayırıcı", "5"]);
    await expect(figure(sheet)).toHaveText("₺12,5");
    await sheet.getByRole("group", { name: "Kategori" }).getByRole("button", { name: "Groceries" }).click();
    await expect(saveButton(sheet)).toHaveText("₺12,50 gider ekle");
    await saveButton(sheet).click();
    await expect(page.getByRole("status").filter({ hasText: "eklendi" })).toContainText("Gider eklendi · −₺12,50");
    expect((await store(page)).transactions.some((tx) => tx.amount === 12.5)).toBe(true);
  });
});

for (const scheme of ["light", "dark"] as const) {
  test(`screenshots: the add sheet in ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await enterPocket(page);
    let sheet = await openAdd(page);
    await sheet.getByRole("group", { name: "Pay with" }).getByRole("button", { name: /Ziraat TRY/ }).click();
    await sheet.getByRole("group", { name: "Category" }).getByRole("button", { name: "Groceries" }).click();
    await tap(sheet, ["1", "2", "0", "plus", "4", "5"]);
    await page.screenshot({ path: `e2e/screenshots/pocket-add-expense-${scheme}.png` });

    await sheet.getByRole("group", { name: "Category" }).getByRole("button", { name: "All categories" }).click();
    await expect(sheet.getByRole("heading", { name: "All categories" })).toBeVisible();
    await page.screenshot({ path: `e2e/screenshots/pocket-add-categories-${scheme}.png` });
    // closing the grid goes back to the entry, not out of the sheet
    await dismiss(page);
    await expect(sheet.getByRole("heading", { name: "New expense" })).toBeVisible();

    await sheet.getByRole("group", { name: "Kind of entry" }).getByRole("button", { name: "Transfer" }).click();
    await sheet.getByRole("group", { name: "From" }).getByRole("button", { name: /Wise USD/ }).click();
    await sheet.getByRole("group", { name: "To" }).getByRole("button", { name: /Ziraat TRY/ }).click();
    await page.screenshot({ path: `e2e/screenshots/pocket-add-transfer-${scheme}.png` });

    await dismiss(page);
    await expect(sheet).toBeHidden();
    await page.evaluate(() => localStorage.removeItem("renovator-pocket-draft"));
    sheet = await openAdd(page);
    await sheet.getByRole("button", { name: "Type instead" }).click();
    await page.screenshot({ path: `e2e/screenshots/pocket-add-typing-${scheme}.png` });
  });
}
