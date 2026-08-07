import { describe, expect, it } from "vitest";
import { rankByLabel, scoreMatch } from "../rank";
import { DEFAULT_UI_STYLE, isUiStyle, UI_STYLES, versionOf } from "../style";

describe("UI styles", () => {
  it("keeps Classic on version 1 and every skin on version 2", () => {
    expect(versionOf("classic")).toBe("v1");
    for (const s of UI_STYLES) {
      expect(versionOf(s.id)).toBe(s.id === "classic" ? "v1" : "v2");
    }
  });

  it("starts on Classic, so nothing changes until you ask", () => {
    expect(DEFAULT_UI_STYLE).toBe("classic");
    expect(versionOf(DEFAULT_UI_STYLE)).toBe("v1");
  });

  it("rejects a stored value it doesn't recognise", () => {
    expect(isUiStyle("terminal")).toBe(true);
    expect(isUiStyle("brutalist")).toBe(false);
    expect(isUiStyle("")).toBe(false);
  });

  it("falls back to v1 for an id that isn't a style at all", () => {
    // guards the localStorage path: an old or hand-edited value must not
    // leave the app in a half-applied state
    expect(versionOf("nonsense" as never)).toBe("v1");
  });

  it("has no duplicate ids", () => {
    expect(new Set(UI_STYLES.map((s) => s.id)).size).toBe(UI_STYLES.length);
  });
});

describe("scoreMatch", () => {
  it("matches letters in order, not necessarily together", () => {
    expect(scoreMatch("trns", "Transactions")).not.toBeNull();
    expect(scoreMatch("akb", "Akbank")).not.toBeNull();
  });

  it("refuses a query whose letters aren't all there in order", () => {
    expect(scoreMatch("zzz", "Transactions")).toBeNull();
    expect(scoreMatch("snart", "Transactions")).toBeNull();
  });

  it("scores a prefix above a scatter", () => {
    const prefix = scoreMatch("car", "Cards")!;
    const scatter = scoreMatch("car", "Recurring charges")!;
    expect(prefix).toBeGreaterThan(scatter);
  });

  it("rewards word starts", () => {
    expect(scoreMatch("sc", "Safe Cash")!).toBeGreaterThan(scoreMatch("sc", "discount")!);
  });

  it("treats an empty query as a non-filter", () => {
    expect(scoreMatch("", "anything")).toBe(0);
  });
});

describe("rankByLabel", () => {
  const items = [
    { label: "Dashboard" },
    { label: "Transactions" },
    { label: "Cards" },
    { label: "Garanti TRY" },
  ];

  it("hands back everything, in order, for a blank query", () => {
    expect(rankByLabel("  ", items)).toEqual(items);
  });

  it("drops what can't match and puts the best first", () => {
    const out = rankByLabel("car", items);
    expect(out[0].label).toBe("Cards");
    expect(out.map((x) => x.label)).not.toContain("Dashboard");
  });

  it("finds an account by the middle of its name", () => {
    expect(rankByLabel("try", items).map((x) => x.label)).toContain("Garanti TRY");
  });
});
