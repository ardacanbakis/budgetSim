/**
 * Where the "BudgetSim" name in the sidebar and phone header goes: back to
 * the welcome page, as it always has, or to the Dashboard. When it goes to
 * the Dashboard, the Dashboard's own menu entry can be hidden, since the
 * name already is one.
 *
 * Both are kept on the device. With nothing saved, a phone-width screen
 * starts with the name going to the Dashboard and the entry hidden (a phone's
 * bar has room for four), and a wider one as before.
 */

export const BRAND_TARGETS = ["welcome", "dashboard"] as const;
export type BrandTarget = (typeof BRAND_TARGETS)[number];

export const BRAND_TARGET_KEY = "renovator-brand-target";
export const HIDE_DASHBOARD_KEY = "renovator-hide-dashboard";
/** sent when either changes, so the shell follows Settings without a reload */
export const BRAND_NAV_EVENT = "renovator-brand-nav";

export interface BrandNav {
  target: BrandTarget;
  /** the saved (or default) choice, whatever the target */
  hideDashboard: boolean;
}

export function brandDefaults(phone: boolean): BrandNav {
  return phone ? { target: "dashboard", hideDashboard: true } : { target: "welcome", hideDashboard: false };
}

/** What's saved, read over the defaults for this screen; anything unreadable is ignored. */
export function readBrandNav(saved: { target: string | null; hide: string | null }, phone: boolean): BrandNav {
  const defaults = brandDefaults(phone);
  return {
    target: (BRAND_TARGETS as readonly string[]).includes(saved.target ?? "") ? (saved.target as BrandTarget) : defaults.target,
    hideDashboard: saved.hide === "on" ? true : saved.hide === "off" ? false : defaults.hideDashboard,
  };
}

export function brandHref(nav: BrandNav): "/" | "/welcome" {
  return nav.target === "dashboard" ? "/" : "/welcome";
}

/** Hiding the entry only applies while the name leads to the Dashboard: otherwise there'd be no way back to it. */
export function dashboardHidden(nav: BrandNav): boolean {
  return nav.target === "dashboard" && nav.hideDashboard;
}

/**
 * The sidebar's list: Settings sits beside Log out instead, and the
 * Dashboard goes when it's hidden.
 */
export function sidebarNav<T extends { href: string }>(items: T[], nav: BrandNav): T[] {
  const hide = dashboardHidden(nav);
  return items.filter((item) => item.href !== "/settings" && !(hide && item.href === "/"));
}

/** The phone bar's list: everything, Settings included (in More), less a hidden Dashboard. */
export function phoneNav<T extends { href: string }>(items: T[], nav: BrandNav): T[] {
  const hide = dashboardHidden(nav);
  return items.filter((item) => !(hide && item.href === "/"));
}
