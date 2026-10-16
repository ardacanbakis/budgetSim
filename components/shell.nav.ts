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
  { href: "/loans", key: "nav.loans", icon: "⌂" },
  { href: "/reports", key: "nav.reports", icon: "◔" },
  { href: "/planner", key: "nav.planner", icon: "◈" },
  { href: "/savings", key: "nav.savings", icon: "⌗" },
  { href: "/settings", key: "nav.settings", icon: "⚙" },
] as const;

export type NavItem = (typeof NAV)[number];

/** Settings can't be hidden: it's where you'd go to bring the rest back. */
const ALWAYS_SHOWN = "/settings";
const HIDDEN = "!";

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
 */
export function navEntries(navOrder: string[] | null | undefined): NavEntry[] {
  const byHref = new Map<string, NavItem>(NAV.map((item) => [item.href, item]));
  const result: NavEntry[] = [];
  for (const saved of navOrder ?? []) {
    const marked = saved.startsWith(HIDDEN);
    const href = marked ? saved.slice(HIDDEN.length) : saved;
    const item = byHref.get(href);
    if (!item) continue;
    byHref.delete(href);
    result.push({ item, hidden: marked && href !== ALWAYS_SHOWN });
  }
  for (const item of byHref.values()) result.push({ item, hidden: false });
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
