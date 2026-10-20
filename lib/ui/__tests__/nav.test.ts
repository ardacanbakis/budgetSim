import { describe, expect, it } from "vitest";
import { encodeNav, NAV, NAV_ALIASES, navEntries, navHost, orderedNav, visibleNav } from "@/components/shell.nav";

const hrefs = (items: { href: string }[]) => items.map((i) => i.href);

describe("sidebar order and hidden items", () => {
  it("shows everything, in the default order, when nothing is saved", () => {
    expect(hrefs(visibleNav(null))).toEqual(NAV.map((i) => i.href));
  });

  it("keeps a hidden item's place in the order but leaves it out of the sidebar", () => {
    const saved = ["/", "!/victvs", "/accounts"];
    expect(hrefs(orderedNav(saved)).slice(0, 3)).toEqual(["/", "/victvs", "/accounts"]);
    expect(hrefs(visibleNav(saved))).not.toContain("/victvs");
    expect(hrefs(visibleNav(saved)).slice(0, 2)).toEqual(["/", "/accounts"]);
  });

  it("round-trips through what's saved", () => {
    const saved = ["/", "!/victvs", "/accounts", "!/reports"];
    const encoded = encodeNav(navEntries(saved));
    expect(encoded.slice(0, 4)).toEqual(saved);
    // pages added since the order was saved come at the end, shown
    expect(encoded).toContain("/settings");
    expect(encoded).toHaveLength(NAV.length);
  });

  it("never hides Settings, where you'd go to bring the rest back", () => {
    expect(hrefs(visibleNav(["!/settings"]))).toContain("/settings");
    expect(navEntries(["!/settings"]).find((e) => e.item.href === "/settings")!.hidden).toBe(false);
  });

  it("drops what it doesn't know", () => {
    expect(hrefs(orderedNav(["/gone", "!/also-gone", "/"]))[0]).toBe("/");
    expect(orderedNav(["/gone"])).toHaveLength(NAV.length);
  });
});

describe("pages that moved into another", () => {
  it("point each alias at a page that is in the nav", () => {
    for (const host of Object.values(NAV_ALIASES)) expect(NAV.map((i) => i.href)).toContain(host);
  });

  it("leaves a page in the nav, and an href it doesn't know, as they are", () => {
    expect(navHost("/planner")).toBe("/planner");
    expect(navHost("/gone")).toBe("/gone");
  });

  it("reads Evim sistemi, now a tab of Plan, as Plan", () => {
    expect(navHost("/savings")).toBe("/planner");
    expect(hrefs(orderedNav(["/savings", "/"])).slice(0, 2)).toEqual(["/planner", "/"]);
    expect(orderedNav(["/savings", "/planner"])).toHaveLength(NAV.length);
  });

  it("keeps a page shown when it or a page that moved into it was saved as shown", () => {
    // hid the Planner but kept Evim sistemi: Evim's new home stays
    expect(hrefs(visibleNav(["!/planner", "/savings"]))).toContain("/planner");
    expect(hrefs(visibleNav(["/savings", "!/planner"]))).toContain("/planner");
    expect(hrefs(visibleNav(["/planner", "!/savings"]))).toContain("/planner");
    // both hidden: hidden, saved back as the host alone
    expect(hrefs(visibleNav(["!/planner", "!/savings"]))).not.toContain("/planner");
    expect(encodeNav(navEntries(["!/savings", "!/planner"])).filter((h) => h.includes("/planner") || h.includes("/savings"))).toEqual([
      "!/planner",
    ]);
  });
});
