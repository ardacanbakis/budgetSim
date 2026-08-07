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
  { href: "/recurring", key: "nav.recurring", icon: "↻" },
  { href: "/loans", key: "nav.loans", icon: "⌂" },
  { href: "/reports", key: "nav.reports", icon: "◔" },
  { href: "/planner", key: "nav.planner", icon: "◈" },
  { href: "/settings", key: "nav.settings", icon: "⚙" },
] as const;

export type NavItem = (typeof NAV)[number];

/** Apply the user's saved sidebar order; unknown ids dropped, missing appended. */
export function orderedNav(navOrder: string[] | null | undefined): NavItem[] {
  if (!navOrder?.length) return [...NAV];
  const byHref = new Map<string, NavItem>(NAV.map((item) => [item.href, item]));
  const result: NavItem[] = [];
  for (const href of navOrder) {
    const item = byHref.get(href);
    if (item) {
      result.push(item);
      byHref.delete(href);
    }
  }
  return [...result, ...byHref.values()];
}

/** The nav entry whose page you're on — used for the header title in v2. */
export function navTitleKey(pathname: string): string | null {
  return NAV.find((item) => item.href === pathname)?.key ?? null;
}
