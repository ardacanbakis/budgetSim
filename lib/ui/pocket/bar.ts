import { NavItem, visibleNav } from "@/components/shell.nav";

/**
 * The Pocket tab bar: Home, Activity, +, one page of your choosing, More.
 *
 * Slots never move with the page you're on (Standard's bar swaps its fourth
 * slot for whatever More page is open, so the bar shifts under your thumb).
 * A slot whose page you've hidden in Settings → Sidebar takes the next page
 * that's visible, in your order, never Settings: that lives in More.
 */
export const HOME = "/";
export const ACTIVITY = "/transactions";
export const DEFAULT_FOURTH = "/accounts";

export interface BarSlots {
  home: NavItem | null;
  activity: NavItem | null;
  fourth: NavItem | null;
  /** everything else that's visible, Settings last */
  more: NavItem[];
}

export function barSlots(navOrder: string[] | null | undefined, fourthPref: string | null | undefined): BarSlots {
  const visible = visibleNav(navOrder);
  const taken = new Set<string>();
  const pick = (wanted: string | null | undefined): NavItem | null => {
    const exact = visible.find((i) => i.href === wanted && !taken.has(i.href) && i.href !== "/settings");
    const item = exact ?? visible.find((i) => !taken.has(i.href) && i.href !== "/settings") ?? null;
    if (item) taken.add(item.href);
    return item;
  };
  const home = pick(HOME);
  const activity = pick(ACTIVITY);
  const fourth = pick(fourthPref || DEFAULT_FOURTH);
  const rest = visible.filter((i) => !taken.has(i.href));
  const more = [...rest.filter((i) => i.href !== "/settings"), ...rest.filter((i) => i.href === "/settings")];
  return { home, activity, fourth, more };
}

/** Pages that can sit in the fourth slot: anything visible but Home, Activity and Settings. */
export function fourthTabChoices(navOrder: string[] | null | undefined): NavItem[] {
  return visibleNav(navOrder).filter((i) => i.href !== HOME && i.href !== ACTIVITY && i.href !== "/settings");
}

/** Which slot a path belongs to, so a page inside More lights More up. */
export function activeSlot(pathname: string, slots: BarSlots): "home" | "activity" | "fourth" | "more" | null {
  const is = (item: NavItem | null) => item != null && (item.href === "/" ? pathname === "/" : pathname.startsWith(item.href));
  if (is(slots.home)) return "home";
  if (is(slots.activity)) return "activity";
  if (is(slots.fourth)) return "fourth";
  if (slots.more.some((i) => is(i))) return "more";
  return null;
}
