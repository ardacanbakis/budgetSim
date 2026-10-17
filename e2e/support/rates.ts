import { Page } from "@playwright/test";

/**
 * Every e2e test sees the same rate table: the static fallback, as served
 * when no provider can be reached. Live rates made tests depend on where
 * they ran. In CI the providers answer, so auto-complete settles the demo's
 * overdue items as soon as rates arrive, which moves balances and reorders
 * lists under a test that is mid-way through reading them; offline they
 * never settle. Pinning the table makes both runs the same.
 *
 * Call it from test.beforeEach: a test that routes /api/rates itself does so
 * later, and Playwright lets the most recent route win.
 */
export async function pinRates(page: Page): Promise<void> {
  await page.route("**/api/rates**", (route) =>
    route.fulfill({
      json: {
        usdPer: { USD: 1, TRY: 1 / 41.8, EUR: 1.09, BTC: 104000, XAU_G: 78.5 },
        fetchedAt: new Date().toISOString(),
        sources: { USD: "identity", TRY: "fallback", EUR: "fallback", BTC: "fallback", XAU_G: "fallback" },
        diagnostics: [],
      },
    })
  );
}
