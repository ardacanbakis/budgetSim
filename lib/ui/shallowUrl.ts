/**
 * Changing the query string of the page that's open (a tab, a search) without
 * a navigation: Next keeps usePathname and useSearchParams in step with the
 * browser's own history calls (node_modules/next/dist/docs/01-app/02-guides/
 * single-page-applications.md, "Using the native History API").
 *
 * router.replace and router.push can't be trusted with this: in a production
 * build, once a page has been loaded with a query (/transactions?tab=recurring,
 * by link, bookmark or the /recurring redirect), a router call to the same
 * page with a different query comes to nothing and the old URL stays.
 */

/** The same page with another query, in place of this history entry. */
export function replaceQuery(href: string): void {
  window.history.replaceState(null, "", href);
}

/** The same page with another query, as a new history entry (Back returns). */
export function pushQuery(href: string): void {
  window.history.pushState(null, "", href);
}
