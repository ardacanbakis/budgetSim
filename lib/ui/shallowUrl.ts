/**
 * Changing the query string of the page that's open (a tab, a search, an
 * account opened over the list) without a navigation: Next keeps usePathname
 * and useSearchParams in step with the browser's own history calls
 * (node_modules/next/dist/docs/01-app/02-guides/single-page-applications.md,
 * "Using the native History API"), and nothing goes through the router.
 *
 * Next 16.2 had a bug here, fixed in 16.3: once a page had been loaded with
 * a query (/transactions?tab=recurring, by link, bookmark or the /recurring
 * redirect), a router call or link to that page brought the old query back,
 * from the page itself or from any other. The e2e specs that load a page with
 * a query and then leave it keep that in check.
 */

/** The same page with another query, in place of this history entry. */
export function replaceQuery(href: string): void {
  window.history.replaceState(null, "", href);
}

/** The same page with another query, as a new history entry (Back returns). */
export function pushQuery(href: string): void {
  window.history.pushState(null, "", href);
}
