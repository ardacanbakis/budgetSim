import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PHONE_QUERY } from "../phone";

/**
 * Pocket must never reach the default design. That holds only while every
 * Pocket rule sits in the one block of app/globals.css that is gated by the
 * phone media query and html[data-phone="pocket"] — this keeps it so.
 */
const css = readFileSync(join(__dirname, "../../../app/globals.css"), "utf8");
const begin = css.indexOf("/* POCKET:BEGIN");
const end = css.indexOf("/* POCKET:END */");

describe("Pocket's CSS", () => {
  it("lives in one marked block", () => {
    expect(begin).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(begin);
  });

  it("has no Pocket selector outside that block", () => {
    const outside = css.slice(0, begin) + css.slice(end);
    expect(outside).not.toMatch(/data-phone|data-hide-amounts|data-pocket|\.pocket-/);
  });

  it("gates the block with the same media query the app uses", () => {
    const block = css.slice(begin, end);
    const queries = [...block.matchAll(/@media\s*([^{]+)\{/g)].map((m) => m[1].trim());
    const gates = queries.filter((q) => !q.startsWith("(prefers-reduced-motion"));
    expect(gates.length).toBeGreaterThan(0);
    for (const q of gates) expect(q).toBe(PHONE_QUERY);
  });

  it("scopes every rule in the block to html[data-phone=pocket]", () => {
    const block = css.slice(begin, end);
    // the top-level gate starts a line; the variant's own copy is indented
    const start = block.indexOf(`\n@media ${PHONE_QUERY} {`);
    expect(start).toBeGreaterThan(0);
    const body = block.slice(start).replace(/\/\*[\s\S]*?\*\//g, "");
    // a selector is what sits between one brace and the next opening one, unless it's an at-rule
    const selectors = [...body.matchAll(/(?:^|[{}])\s*([^\s@{}][^{}]*)\{/g)].map((m) => m[1].trim()).filter(Boolean);
    expect(selectors.length).toBeGreaterThan(10);
    for (const selector of selectors) {
      for (const part of selector.split(/,(?![^(]*\))/)) expect(part.trim()).toMatch(/^html\[data-phone="pocket"\]/);
    }
  });
});
