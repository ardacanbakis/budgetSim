import { describe, expect, it } from "vitest";
import { activeSlot, barSlots, fourthTabChoices } from "../pocket/bar";

const hrefs = (slots: ReturnType<typeof barSlots>) => ({
  home: slots.home?.href,
  activity: slots.activity?.href,
  fourth: slots.fourth?.href,
  more: slots.more.map((i) => i.href),
});

describe("barSlots", () => {
  it("is Home, Activity, Portfolio, then the rest with Settings last", () => {
    expect(hrefs(barSlots(null, null))).toEqual({
      home: "/",
      activity: "/transactions",
      fourth: "/accounts",
      more: ["/cards", "/victvs", "/loans", "/reports", "/planner", "/settings"],
    });
  });

  it("puts the chosen page in the fourth slot", () => {
    const slots = barSlots(null, "/cards");
    expect(slots.fourth?.href).toBe("/cards");
    expect(slots.more.map((i) => i.href)).toContain("/accounts");
    expect(slots.more.map((i) => i.href)).not.toContain("/cards");
  });

  it("fills a slot whose page is hidden with the next visible one, never Settings", () => {
    const slots = barSlots(["/", "!/transactions", "/accounts", "/cards"], null);
    expect(slots.activity?.href).toBe("/accounts");
    expect(slots.fourth?.href).toBe("/cards");
    expect(hrefs(barSlots(["!/", "!/transactions", "!/accounts", "!/cards", "!/victvs", "!/loans", "!/reports", "!/planner"], null))).toEqual({
      home: undefined,
      activity: undefined,
      fourth: undefined,
      more: ["/settings"],
    });
  });

  it("never offers a hidden page", () => {
    const slots = barSlots(["/", "/transactions", "/accounts", "!/victvs"], null);
    expect(slots.more.map((i) => i.href)).not.toContain("/victvs");
    expect(fourthTabChoices(["!/victvs"]).map((i) => i.href)).not.toContain("/victvs");
  });

  it("reads a fourth-tab choice of a page that moved as the page it moved into", () => {
    expect(barSlots(null, "/savings").fourth?.href).toBe("/planner");
    expect(barSlots(null, "/savings").more.map((i) => i.href)).not.toContain("/planner");
  });

  it("keeps a stale fourth-tab choice from taking Home's or Activity's place", () => {
    expect(barSlots(null, "/").fourth?.href).toBe("/accounts");
    expect(barSlots(null, "/settings").fourth?.href).toBe("/accounts");
  });
});

describe("activeSlot", () => {
  const slots = barSlots(null, null);
  it("lights the tab you're on, and More for a page inside it", () => {
    expect(activeSlot("/", slots)).toBe("home");
    expect(activeSlot("/transactions", slots)).toBe("activity");
    expect(activeSlot("/accounts", slots)).toBe("fourth");
    expect(activeSlot("/cards", slots)).toBe("more");
    expect(activeSlot("/welcome", slots)).toBeNull();
  });
});
