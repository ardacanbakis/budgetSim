import { expect, Page, test } from "@playwright/test";
import { pinRates } from "./support/rates";

// the same rates in every run, offline or in CI (see support/rates.ts)
test.beforeEach(async ({ page }) => {
  await pinRates(page);
});

/**
 * Settings → Data check → Apply a fix file: a file of changes is loaded,
 * every step shown against the records, and applied only when they all match.
 */

const DEMO_KEY = "renovator-demo-v5";

interface Row {
  id: string;
  accountId: string;
  amount: number;
  status: string;
  description: string;
  transferGroupId: string | null;
}
interface Store {
  accounts: Array<{ id: string; name: string; kind: string; archived: boolean }>;
  transactions: Row[];
}

const store = (page: Page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}") as Store, DEMO_KEY);

async function enterDemo(page: Page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/welcome");
  await page.getByRole("button", { name: /demo/i }).click();
  await expect(page.getByText(/Net worth|Toplam varlık/).first()).toBeVisible({ timeout: 15_000 });
}

async function load(page: Page, file: unknown) {
  await page.locator("[data-fixfile] input[type=file]").setInputFiles({
    name: "fixes.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(file)),
  });
}

test("fix file: each step is shown, applied once, and a file that no longer matches changes nothing", async ({ page }) => {
  await enterDemo(page);
  const before = await store(page);
  const account = before.accounts.find((a) => a.kind !== "credit_card" && !a.archived)!;
  const row = before.transactions.find((t) => t.transferGroupId == null && t.accountId === account.id)!;
  const file = (expectAmount: number) => ({
    app: "renovator",
    kind: "fixes",
    version: 1,
    title: "Tidy-up",
    steps: [
      { op: "deleteTransaction", id: row.id, expect: { amount: expectAmount }, note: "a copy" },
      { op: "createTransaction", accountId: account.id, direction: "expense", amount: 123.45, date: "2026-01-02", description: "Fee from the fix file" },
    ],
  });

  await page.goto("/settings?tab=check");
  const card = page.locator("[data-fixfile]");
  await expect(card).toBeVisible();

  // a row that no longer reads as the file expects: nothing can be applied
  await load(page, file(row.amount + 1));
  await expect(card.locator("[data-fix-step=mismatch]")).toHaveCount(1);
  await expect(card.getByText(/nothing in this file will be applied/)).toBeVisible();
  await expect(card.getByRole("button", { name: /^Apply/ })).toHaveCount(0);

  await load(page, file(row.amount));
  await expect(card.getByText("Tidy-up")).toBeVisible();
  await expect(card.locator("[data-fix-step=ready]")).toHaveCount(2);
  await expect(card.getByText("a copy")).toBeVisible();
  await card.getByRole("button", { name: "Apply 2 changes" }).click();
  await expect(card.getByText("Applied 2 changes; 0 were already done.")).toBeVisible();

  const after = await store(page);
  expect(after.transactions.some((t) => t.id === row.id)).toBe(false);
  expect(after.transactions.filter((t) => t.description === "Fee from the fix file")).toHaveLength(1);

  // the same file again: everything's done, nothing to apply
  await expect(card.locator("[data-fix-step=done]")).toHaveCount(2);
  await expect(card.getByText("Everything in this file is already in your records.")).toBeVisible();

  // not a fix file at all
  await load(page, { app: "renovator", version: 1, accounts: [] });
  await expect(card.getByText(/isn't a fix file this app can read/)).toBeVisible();
});
