import { describe, expect, it } from "vitest";
import { NAV } from "@/components/shell.nav";
import { brandHref, dashboardHidden, phoneNav, readBrandNav, sidebarNav } from "../brandNav";

const hrefs = (items: { href: string }[]) => items.map((i) => i.href);
const none = { target: null, hide: null };

describe("where the BudgetSim name goes", () => {
  it("defaults to the welcome page on a wide screen, and to a Dashboard-less menu on a phone", () => {
    expect(readBrandNav(none, false)).toEqual({ target: "welcome", hideDashboard: false });
    expect(readBrandNav(none, true)).toEqual({ target: "dashboard", hideDashboard: true });
    expect(brandHref(readBrandNav(none, false))).toBe("/welcome");
    expect(brandHref(readBrandNav(none, true))).toBe("/");
  });

  it("follows what's saved over the defaults, and ignores what it can't read", () => {
    expect(readBrandNav({ target: "dashboard", hide: "on" }, false)).toEqual({ target: "dashboard", hideDashboard: true });
    expect(readBrandNav({ target: "welcome", hide: "off" }, true)).toEqual({ target: "welcome", hideDashboard: false });
    expect(readBrandNav({ target: "somewhere", hide: "maybe" }, true)).toEqual({ target: "dashboard", hideDashboard: true });
  });

  it("only hides the Dashboard while the name leads there", () => {
    expect(dashboardHidden({ target: "welcome", hideDashboard: true })).toBe(false);
    expect(dashboardHidden({ target: "dashboard", hideDashboard: true })).toBe(true);
    expect(dashboardHidden({ target: "dashboard", hideDashboard: false })).toBe(false);
  });
});

describe("the menus", () => {
  it("keep Settings out of the sidebar's list, for the corner beside Log out", () => {
    const list = hrefs(sidebarNav([...NAV], { target: "welcome", hideDashboard: false }));
    expect(list).not.toContain("/settings");
    expect(list[0]).toBe("/");
  });

  it("drop the Dashboard from both when it's hidden, but keep Settings on the phone", () => {
    const nav = { target: "dashboard" as const, hideDashboard: true };
    expect(hrefs(sidebarNav([...NAV], nav))).not.toContain("/");
    expect(hrefs(phoneNav([...NAV], nav))).not.toContain("/");
    expect(hrefs(phoneNav([...NAV], nav))).toContain("/settings");
    expect(hrefs(phoneNav([...NAV], { target: "dashboard", hideDashboard: false }))).toContain("/");
  });
});
