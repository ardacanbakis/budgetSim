import { describe, expect, it } from "vitest";
import { encodeNav, NAV, navEntries, orderedNav, visibleNav } from "@/components/shell.nav";

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
    const saved = ["/", "!/victvs", "/accounts", "!/savings"];
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
