/**
 * The destination list, kept out of shell.tsx so things the shell renders
 * (the command palette, for one) can read it without importing the shell back.
 */
export const NAV = [
  { href: "/", key: "nav.dashboard", icon: "◧" },
  { href: "/accounts", key: "nav.accounts", icon: "▤" },
  { href: "/transactions", key: "nav.transactions", icon: "⇄" },
  { href: "/cards", key: "nav.cards", icon: "💳" },
  { href: "/victvs", key: "nav.victvs", icon: "✓" },
  { href: "/reports", key: "nav.reports", icon: "◔" },
  { href: "/planner", key: "nav.planner", icon: "◈" },
  { href: "/settings", key: "nav.settings", icon: "⚙" },
] as const;

export type NavItem = (typeof NAV)[number];

/** Settings can't be hidden: it's where you'd go to bring the rest back. */
const ALWAYS_SHOWN = "/settings";
const HIDDEN = "!";

/**
 * Pages that became part of another, and the page they live in now: Evim
 * sistemi is a tab of the Planner, Debt a view of the Portfolio. A saved
 * sidebar, a hidden page or the Pocket fourth-tab choice that names one
 * means its host. An alias only applies once its page has left NAV.
 */
export const NAV_ALIASES: Readonly<Record<string, string>> = {
  "/savings": "/planner",
  "/loans": "/accounts",
};

const KNOWN = new Set<string>(NAV.map((item) => item.href));

/** The page an href stands for today: itself, or the page it moved into. */
export function navHost(href: string): string {
  return KNOWN.has(href) ? href : (NAV_ALIASES[href] ?? href);
}

export interface NavEntry {
  item: NavItem;
  hidden: boolean;
}

/**
 * The saved sidebar: its order and which pages are hidden, as one list of
 * hrefs with hidden ones marked by a leading "!" (["/", "!/victvs", ...]).
 * The nav_order column already held the order, so hiding needed no
 * migration. A version from before hiding reads "!/victvs" as unknown and
 * shows that page at the end. Unknown hrefs are dropped; pages missing from
 * the list (added since it was saved) are appended, shown.
 *
 * A page that moved into another (NAV_ALIASES) counts as its host: the host
 * takes the first place either was saved in, and is shown if either was
 * saved as shown, so hiding the Planner but keeping Evim sistemi keeps the
 * page Evim now lives on.
 */
export function navEntries(navOrder: string[] | null | undefined): NavEntry[] {
  const byHref = new Map<string, NavItem>(NAV.map((item) => [item.href, item]));
  const placed = new Map<string, NavEntry>();
  for (const saved of navOrder ?? []) {
    const marked = saved.startsWith(HIDDEN);
    const href = navHost(marked ? saved.slice(HIDDEN.length) : saved);
    const item = byHref.get(href);
    if (!item) continue;
    const hidden = marked && href !== ALWAYS_SHOWN;
    const seen = placed.get(href);
    // a page and its alias both saved: it keeps the first place, and is shown if either was
    if (seen) seen.hidden = seen.hidden && hidden;
    else placed.set(href, { item, hidden });
  }
  const result = [...placed.values()];
  for (const item of NAV) if (!placed.has(item.href)) result.push({ item, hidden: false });
  return result;
}

export function encodeNav(entries: NavEntry[]): string[] {
  return entries.map((e) => (e.hidden ? HIDDEN : "") + e.item.href);
}

/** Every page in the user's order, hidden ones included. */
export function orderedNav(navOrder: string[] | null | undefined): NavItem[] {
  return navEntries(navOrder).map((e) => e.item);
}

/** What the sidebar and phone bar show. Hidden pages stay reachable from the quick jump (⌘K). */
export function visibleNav(navOrder: string[] | null | undefined): NavItem[] {
  return navEntries(navOrder)
    .filter((e) => !e.hidden)
    .map((e) => e.item);
}

/** The nav entry whose page you're on — used for the header title in v2. */
export function navTitleKey(pathname: string): string | null {
  return NAV.find((item) => item.href === pathname)?.key ?? null;
}
