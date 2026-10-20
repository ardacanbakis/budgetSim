import { describe, expect, it } from "vitest";
import {
  CARD_IDS,
  cardsOff,
  DEFAULT_ACCOUNTS,
  DEFAULT_UPCOMING_DAYS,
  isCardVisible,
  moveCard,
  normalizeLayout,
  resetAccounts,
  resetCards,
  setAccountHidden,
  setAccountLimit,
  setCardVisible,
  setHideEmpty,
  setUpcomingDays,
  visibleCards,
} from "../dashboardLayout";

// every page in the menus, VICTVS included
const ALL_PAGES = ["/", "/victvs", "/transactions", "/cards", "/accounts", "/reports", "/planner", "/settings"];
const NO_VICTVS = ALL_PAGES.filter((href) => href !== "/victvs");

// the ten cards Classic has always had, in their default order
const CLASSIC_TEN = [
  "net-worth",
  "safe-to-spend",
  "cc-debt",
  "victvs",
  "accounts",
  "upcoming",
  "monthly-flow",
  "budgets",
  "goals",
  "avg-spend",
];

describe("normalizeLayout", () => {
  it("gives the defaults for a layout nobody has saved", () => {
    const layout = normalizeLayout(null);
    expect(layout.order).toEqual(CARD_IDS);
    expect(layout.hidden).toEqual([]);
    expect(layout.shown).toEqual([]);
    expect(layout.accounts).toEqual(DEFAULT_ACCOUNTS);
    expect(layout.upcomingDays).toBe(DEFAULT_UPCOMING_DAYS);
    expect(visibleCards(layout, "classic", ALL_PAGES)).toEqual(CLASSIC_TEN);
  });

  it("renders a layout saved before the catalogue grew exactly as it did", () => {
    const legacy = { order: [...CLASSIC_TEN].reverse(), hidden: ["goals"] };
    const layout = normalizeLayout(legacy);
    expect(visibleCards(layout, "classic", ALL_PAGES)).toEqual(
      [...CLASSIC_TEN].reverse().filter((id) => id !== "goals")
    );
    // a card the old layout never heard of is appended, and stays off
    expect(layout.order.slice(0, 10)).toEqual([...CLASSIC_TEN].reverse());
    expect(layout.order).toContain("gold-lens");
    expect(isCardVisible(layout, "gold-lens", "classic", ALL_PAGES)).toBe(false);
  });

  it("drops unknown and repeated card ids, and lets hidden win over shown", () => {
    const layout = normalizeLayout({
      order: ["budgets", "nope", "budgets", "net-worth"],
      hidden: ["goals", "ghost", "goals"],
      shown: ["goals", "gold-lens", 7 as unknown as string],
    });
    expect(layout.order.slice(0, 2)).toEqual(["budgets", "net-worth"]);
    expect(new Set(layout.order).size).toBe(CARD_IDS.length);
    expect(layout.hidden).toEqual(["goals"]);
    expect(layout.shown).toEqual(["gold-lens"]);
  });

  it("keeps keys a newer build added, so this build's next save doesn't wipe them", () => {
    const saved = { order: [], hidden: [], future: { x: 1 }, accounts: { hidden: [], hideEmpty: true, limit: 8, sort: "name" } };
    const layout = normalizeLayout(saved as never) as unknown as Record<string, unknown>;
    expect(layout.future).toEqual({ x: 1 });
    expect((layout.accounts as Record<string, unknown>).sort).toBe("name");
    expect((layout.accounts as Record<string, unknown>).limit).toBe(8);
  });

  it("puts a malformed field back to its default", () => {
    const layout = normalizeLayout({
      order: "x" as never,
      hidden: null as never,
      accounts: { hidden: "a" as never, hideEmpty: "yes" as never, limit: -2 },
      upcomingDays: 9 as never,
    });
    expect(layout.order).toEqual(CARD_IDS);
    expect(layout.hidden).toEqual([]);
    expect(layout.accounts).toEqual(DEFAULT_ACCOUNTS);
    expect(layout.upcomingDays).toBe(30);
    expect(normalizeLayout({ order: [], hidden: [], accounts: { hidden: [], hideEmpty: false, limit: null } }).accounts.limit).toBeNull();
    expect(normalizeLayout({ order: [], hidden: [], upcomingDays: 14 }).upcomingDays).toBe(14);
  });

  it("prunes hidden accounts that no longer exist, in memory only", () => {
    const saved = { order: [], hidden: [], accounts: { hidden: ["a", "gone", "a"], hideEmpty: false, limit: 5 } };
    expect(normalizeLayout(saved, ["a", "b"]).accounts.hidden).toEqual(["a"]);
    // with no account list to check against (still loading), nothing is dropped
    expect(normalizeLayout(saved).accounts.hidden).toEqual(["a", "gone"]);
    expect(saved.accounts.hidden).toEqual(["a", "gone", "a"]);
  });
});

describe("visibility", () => {
  const fresh = normalizeLayout(null);

  it("starts every optional card off in both styles", () => {
    for (const id of ["this-month", "card-statements", "trend", "debt", "commitments", "recent", "victvs-outlook"] as const) {
      expect(isCardVisible(fresh, id, "classic", ALL_PAGES)).toBe(false);
      expect(isCardVisible(fresh, id, "v2", ALL_PAGES)).toBe(false);
    }
    expect(isCardVisible(setCardVisible(fresh, "debt", true), "debt", "classic", NO_VICTVS.filter((h) => h !== "/accounts"))).toBe(false);
    expect(isCardVisible(setCardVisible(fresh, "victvs-outlook", true), "victvs-outlook", "v2", NO_VICTVS)).toBe(false);
  });

  it("starts GoldLens on in version 2 and off on Classic", () => {
    expect(isCardVisible(fresh, "gold-lens", "v2", ALL_PAGES)).toBe(true);
    expect(isCardVisible(fresh, "gold-lens", "classic", ALL_PAGES)).toBe(false);
    expect(cardsOff(fresh, "classic", ALL_PAGES)).toContain("gold-lens");
    expect(cardsOff(fresh, "v2", ALL_PAGES)).not.toContain("gold-lens");
  });

  it("always shows version 2's headline", () => {
    const off = setCardVisible(fresh, "net-worth", false);
    expect(isCardVisible(off, "net-worth", "classic", ALL_PAGES)).toBe(false);
    expect(isCardVisible(off, "net-worth", "v2", ALL_PAGES)).toBe(true);
    expect(cardsOff(off, "v2", ALL_PAGES)).not.toContain("net-worth");
  });

  it("holds an explicit choice in every style", () => {
    const on = setCardVisible(fresh, "gold-lens", true);
    expect(isCardVisible(on, "gold-lens", "classic", ALL_PAGES)).toBe(true);
    const off = setCardVisible(on, "gold-lens", false);
    expect(isCardVisible(off, "gold-lens", "v2", ALL_PAGES)).toBe(false);
    expect(off.shown).not.toContain("gold-lens");
    expect(off.hidden).toEqual(["gold-lens"]);
    // and back on: out of hidden, into shown, never in both
    const again = setCardVisible(off, "gold-lens", true);
    expect(again.hidden).toEqual([]);
    expect(again.shown).toEqual(["gold-lens"]);
  });

  it("hides a card with its page, and doesn't offer it back until the page returns", () => {
    expect(isCardVisible(fresh, "victvs", "classic", NO_VICTVS)).toBe(false);
    expect(visibleCards(fresh, "classic", NO_VICTVS)).not.toContain("victvs");
    expect(cardsOff(fresh, "classic", NO_VICTVS)).not.toContain("victvs");
    // turned on explicitly, it still follows its page
    const on = setCardVisible(fresh, "victvs", true);
    expect(isCardVisible(on, "victvs", "v2", NO_VICTVS)).toBe(false);
  });
});

describe("moveCard", () => {
  const fresh = normalizeLayout(null);
  const shown = visibleCards(fresh, "classic", ALL_PAGES);

  it("moves a card one place among those on screen", () => {
    const next = moveCard(fresh, shown, "cc-debt", -1);
    expect(next.order.slice(0, 3)).toEqual(["net-worth", "cc-debt", "safe-to-spend"]);
    expect(moveCard(fresh, shown, "net-worth", -1)).toBe(fresh);
    expect(moveCard(fresh, shown, "avg-spend", 1)).toBe(fresh);
  });

  it("drops a card onto another's place", () => {
    const next = moveCard(fresh, shown, "avg-spend", "net-worth");
    expect(visibleCards(next, "classic", ALL_PAGES)[0]).toBe("avg-spend");
    expect(visibleCards(next, "classic", ALL_PAGES)[1]).toBe("net-worth");
  });

  it("leaves the cards that aren't showing where they were", () => {
    const hidden = setCardVisible(fresh, "budgets", false);
    const among = visibleCards(hidden, "classic", ALL_PAGES);
    // goals jumps over the hidden budgets card in one step
    const next = moveCard(hidden, among, "goals", -1);
    expect(next.order.indexOf("budgets")).toBe(fresh.order.indexOf("budgets"));
    expect(next.order.indexOf("goals")).toBe(fresh.order.indexOf("monthly-flow"));
    // a card not among those listed doesn't move
    expect(moveCard(hidden, among, "budgets", 1)).toBe(hidden);
  });
});

describe("resetCards", () => {
  it("puts every card back and keeps the account choices and Upcoming's range", () => {
    let layout = normalizeLayout({
      order: [...CARD_IDS].reverse(),
      hidden: ["goals"],
      shown: ["gold-lens"],
      accounts: { hidden: ["a"], hideEmpty: true, limit: null },
      upcomingDays: 7,
    });
    layout = resetCards(layout);
    expect(layout.order).toEqual(CARD_IDS);
    expect(layout.hidden).toEqual([]);
    expect(layout.shown).toEqual([]);
    expect(layout.accounts).toEqual({ hidden: ["a"], hideEmpty: true, limit: null });
    expect(layout.upcomingDays).toBe(7);
  });
});

describe("account choices", () => {
  const fresh = normalizeLayout(null);

  it("hides and shows an account by id, once", () => {
    let layout = setAccountHidden(fresh, "a", true);
    layout = setAccountHidden(layout, "a", true);
    expect(layout.accounts.hidden).toEqual(["a"]);
    expect(setAccountHidden(layout, "a", false).accounts.hidden).toEqual([]);
    // the cards are left alone
    expect(layout.order).toEqual(fresh.order);
  });

  it("sets hide-empty, the limit and Upcoming's range, and resets the accounts only", () => {
    let layout = setHideEmpty(setAccountLimit(setAccountHidden(fresh, "a", true), null), true);
    layout = setCardVisible(setUpcomingDays(layout, 14), "goals", false);
    expect(layout.accounts).toEqual({ hidden: ["a"], hideEmpty: true, limit: null });
    expect(layout.upcomingDays).toBe(14);
    const reset = resetAccounts(layout);
    expect(reset.accounts).toEqual(DEFAULT_ACCOUNTS);
    expect(reset.hidden).toEqual(["goals"]);
    expect(reset.upcomingDays).toBe(14);
  });
});
