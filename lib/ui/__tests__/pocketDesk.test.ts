import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The desk pages (Reports, and Plan with its Evim sistemi and loan simulator tabs) keep their Classic
 * markup inside Pocket. All they gain are marker classes and pocket: variant
 * classes, which must do nothing outside Pocket and must actually take effect
 * inside it. These checks hold the class lists to that.
 */
const root = join(__dirname, "../../..");
const DESK_FILES = [
  "components/loanSimulator.tsx",
  "app/(app)/reports/page.tsx",
  "app/(app)/planner/page.tsx",
  "components/evimTab.tsx",
  "components/scenarioBar.tsx",
  "components/columns.tsx",
  "components/plannerGrid.tsx",
  "components/savingsControls.tsx",
];
const sources = DESK_FILES.map((file) => ({ file, text: readFileSync(join(root, file), "utf8") }));

const css = readFileSync(join(root, "app/globals.css"), "utf8");
const pocketBlock = css.slice(css.indexOf("/* POCKET:BEGIN"), css.indexOf("/* POCKET:END */"));

/** every pocket-* marker and pocket:… utility written in a class list */
function pocketTokens(text: string): string[] {
  return [...text.matchAll(/(?<![\w-])pocket[-:][^\s"'`{}]+/g)].map((m) => m[0]);
}

/** "a:[&_td:first-child]:b!" → ["a", "[&_td:first-child]", "b!"]: colons inside brackets don't split */
function splitVariants(token: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of token) {
    if (ch === "[" || ch === "(") depth++;
    if (ch === "]" || ch === ")") depth--;
    if (ch === ":" && depth === 0) {
      parts.push(current);
      current = "";
    } else current += ch;
  }
  parts.push(current);
  return parts;
}

/** the class lists of the stacked tables (table.stack-sm) in a source file */
function stackTables(text: string): string[][] {
  return [...text.matchAll(/<table className="([^"]*)"/g)]
    .map((m) => m[1].split(/\s+/))
    .filter((classes) => classes.includes("stack-sm"));
}

const DISPLAY = new Set(["grid", "flex", "block", "table", "table-row", "table-cell", "table-header-group", "table-row-group"]);

describe("splitVariants", () => {
  it("splits on the colons between variants only", () => {
    expect(splitVariants("pocket:max-sm:[&_td:not(:first-child)::before]:mr-auto")).toEqual([
      "pocket",
      "max-sm",
      "[&_td:not(:first-child)::before]",
      "mr-auto",
    ]);
    expect(splitVariants("pocket-first")).toEqual(["pocket-first"]);
  });
});

describe("desk pages in Pocket", () => {
  it("use only markers that have a rule in the Pocket block", () => {
    const markers = new Set(sources.flatMap(({ text }) => pocketTokens(text).filter((t) => t.startsWith("pocket-"))));
    expect(markers.size).toBeGreaterThan(0);
    for (const marker of markers) expect(pocketBlock, marker).toContain(`html[data-phone="pocket"] .${marker} `);
  });

  it("write every other Pocket class through the pocket: variant, so it is gated like the block", () => {
    for (const { file, text } of sources) {
      for (const token of pocketTokens(text)) {
        if (token.startsWith("pocket-")) continue;
        expect(splitVariants(token)[0], `${file}: ${token}`).toBe("pocket");
      }
    }
  });

  it("reshape a stacked table only below 640px, where it is stacked", () => {
    // between 640px and Pocket's 768px a stack-sm table is a real table, and a
    // row turned into a grid there would scramble it
    const tables = sources.flatMap(({ file, text }) => stackTables(text).map((classes) => ({ file, classes })));
    expect(tables.length).toBe(5);
    for (const { file, classes } of tables) {
      for (const token of classes.filter((c) => c.startsWith("pocket:"))) {
        expect(splitVariants(token).slice(0, 2), `${file}: ${token}`).toEqual(["pocket", "max-sm"]);
      }
    }
  });

  it("mark a display change on a stacked table important, or the unlayered stack-sm rules win", () => {
    for (const { file, text } of sources) {
      for (const classes of stackTables(text)) {
        for (const token of classes.filter((c) => c.startsWith("pocket:"))) {
          const utility = splitVariants(token).at(-1)!;
          if (DISPLAY.has(utility.replace(/!$/, ""))) expect(utility, `${file}: ${token}`).toMatch(/!$/);
        }
      }
    }
  });

  it("give every stacked table on these pages a Pocket shape", () => {
    for (const { file, text } of sources) {
      for (const classes of stackTables(text)) {
        const shaped = classes.some((c) => c === "pocket:max-sm:[&_tr]:grid!" || c === "pocket:max-sm:table!");
        expect(shaped, `${file}: ${classes.slice(0, 4).join(" ")}`).toBe(true);
      }
    }
  });
});
