import { Account, DashboardAccounts } from "@/lib/data/types";
import { CardBook } from "@/lib/domain/cards";
import { Currency } from "@/lib/domain/currencies";
import { UsdPerMap } from "@/lib/domain/fx";
import { accountLine, AccountLine } from "./pocket/portfolioSections";

/**
 * The accounts a dashboard lists (Classic's Accounts card, version 2's
 * ledger, Pocket's strip), after the choices in dashboardLayout.accounts.
 * Pure, so the rules can be checked without a page.
 *
 * - Rows are Portfolio's (accountLine in lib/ui/pocket/portfolioSections.ts):
 *   a card at −owed, never its ledger balance; a gold account holding coins
 *   in lira; and its `empty` rule (a card owing nothing, anything else at
 *   zero). Archived accounts never show.
 * - Order: by the size of the display value, biggest first, cards last;
 *   ties (and accounts with no rate, which go after those with one) by name.
 * - prefs.hidden leaves accounts out by id, prefs.hideEmpty the empty ones.
 *   This only tidies the lists: no total anywhere reads these rows, so a
 *   hidden account still counts in net worth and every subtotal.
 * - limit cuts the list after that many rows (Classic's card; null for all).
 *
 * The result says what was left out, so a screen can say so: hiddenCount
 * (by the deny-list), emptyHidden (empty and not already hidden) and
 * overflow (past the limit).
 */

export interface DashboardAccountsInput {
  accounts: readonly Account[];
  /** computeBalances, at today's gold ratios */
  balances: ReadonlyMap<string, number>;
  book: CardBook;
  usdPer: UsdPerMap | null | undefined;
  display: Currency;
  today: string;
}

export interface DashboardAccountRows {
  rows: AccountLine[];
  hiddenCount: number;
  emptyHidden: number;
  overflow: number;
}

/** Biggest display value first, cards last, then by name. */
export function byDashboardOrder(a: AccountLine, b: AccountLine): number {
  const card = (l: AccountLine) => l.account.kind === "credit_card";
  if (card(a) !== card(b)) return card(a) ? 1 : -1;
  const size = (l: AccountLine) => (l.converted == null ? -1 : Math.abs(l.converted));
  if (size(a) !== size(b)) return size(b) - size(a);
  return a.account.name.localeCompare(b.account.name);
}

/** Every open account as a dashboard lists it, in order, before any choice. */
export function dashboardAccountLines(input: DashboardAccountsInput): AccountLine[] {
  return input.accounts
    .filter((a) => !a.archived)
    .map((a) => accountLine(a, input))
    .sort(byDashboardOrder);
}

export function dashboardAccountRows(
  input: DashboardAccountsInput,
  prefs: Pick<DashboardAccounts, "hidden" | "hideEmpty">,
  limit: number | null = null
): DashboardAccountRows {
  const hidden = new Set(prefs.hidden);
  let hiddenCount = 0;
  let emptyHidden = 0;
  const listed: AccountLine[] = [];
  for (const line of dashboardAccountLines(input)) {
    if (hidden.has(line.account.id)) hiddenCount++;
    else if (prefs.hideEmpty && line.empty) emptyHidden++;
    else listed.push(line);
  }
  const rows = limit != null ? listed.slice(0, limit) : listed;
  return { rows, hiddenCount, emptyHidden, overflow: listed.length - rows.length };
}
