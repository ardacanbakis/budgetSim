import { isPortfolioSegment, PortfolioSegment } from "./pocket/portfolioSections";

/**
 * The Portfolio's address (/accounts), now that Debt is one of its views:
 *
 * - ?view=all|assets|debts picks the view. All is the default and is left
 *   out of a link. In Pocket a view in the URL wins over the device's own
 *   choice (renovator-pocket-portfolio-seg); without one, that choice holds.
 * - &loan=<id> opens a tracked loan: Classic's right-hand pane, Pocket's
 *   full-screen page. &account=<id> opens an account in Pocket.
 *
 * /loans redirects to /accounts?view=debts, and every link to a loan goes
 * through loanHref, so the two layouts agree on where one opens.
 */
export interface PortfolioQuery {
  view: PortfolioSegment | null;
  loan: string | null;
  account: string | null;
}

/** What an /accounts URL asks for; an unknown view counts as none. */
export function readPortfolioQuery(params: { get(key: string): string | null }): PortfolioQuery {
  const view = params.get("view");
  return {
    view: view != null && isPortfolioSegment(view) ? view : null,
    loan: params.get("loan") || null,
    account: params.get("account") || null,
  };
}

export function portfolioHref(q: Partial<PortfolioQuery> = {}): string {
  const params = new URLSearchParams();
  if (q.view && q.view !== "all") params.set("view", q.view);
  if (q.loan) params.set("loan", q.loan);
  if (q.account) params.set("account", q.account);
  const qs = params.toString();
  return qs ? `/accounts?${qs}` : "/accounts";
}

/** Where a tracked loan opens: the Debts view with that loan; without one, the Debts view. */
export function loanHref(loanId?: string | null): string {
  return portfolioHref({ view: "debts", loan: loanId ?? null });
}
