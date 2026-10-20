import { describe, expect, it } from "vitest";
import { CARD_SPECS } from "@/lib/ui/dashboardLayout";
import { en, tr } from "../dictionaries";

// The card catalogue builds its keys from the ids (dashboard.card_<id>), so
// the compiler can't see a missing one, and t() would print the key itself.
describe("dashboard card strings", () => {
  const lookup = (dict: typeof en, key: string): unknown =>
    key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], dict);

  it("name and describe every card in both languages", () => {
    for (const spec of CARD_SPECS) {
      for (const dict of [en, tr]) {
        expect(typeof lookup(dict, spec.labelKey), spec.labelKey).toBe("string");
        expect(typeof lookup(dict, spec.descKey), spec.descKey).toBe("string");
      }
    }
  });

  it("keep the net-worth words to the net-worth card, which the e2e finds by them", () => {
    for (const spec of CARD_SPECS) {
      for (const dict of [en, tr]) {
        const text = `${spec.id === "net-worth" ? "" : lookup(dict, spec.labelKey)} ${lookup(dict, spec.descKey)}`;
        expect(text, spec.id).not.toMatch(/net worth|toplam varlık/i);
      }
    }
  });
});
