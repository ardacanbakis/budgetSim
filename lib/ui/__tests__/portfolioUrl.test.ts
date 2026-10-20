import { describe, expect, it } from "vitest";
import { loanHref, portfolioHref, readPortfolioQuery } from "../portfolioUrl";

const q = (s: string) => readPortfolioQuery(new URLSearchParams(s));

describe("the Portfolio's address", () => {
  it("reads the view, a loan and an account, ignoring a view it doesn't know", () => {
    expect(q("")).toEqual({ view: null, loan: null, account: null });
    expect(q("view=debts&loan=l1")).toEqual({ view: "debts", loan: "l1", account: null });
    expect(q("view=cards&account=a1")).toEqual({ view: null, loan: null, account: "a1" });
    expect(q("view=all&loan=")).toEqual({ view: "all", loan: null, account: null });
  });

  it("writes All as no view at all", () => {
    expect(portfolioHref()).toBe("/accounts");
    expect(portfolioHref({ view: "all" })).toBe("/accounts");
    expect(portfolioHref({ view: "assets" })).toBe("/accounts?view=assets");
    expect(portfolioHref({ view: "debts", loan: "a b" })).toBe("/accounts?view=debts&loan=a+b");
  });

  it("opens a loan in the Debts view, and round-trips", () => {
    expect(loanHref("l1")).toBe("/accounts?view=debts&loan=l1");
    expect(loanHref()).toBe("/accounts?view=debts");
    expect(q(loanHref("l1").split("?")[1])).toEqual({ view: "debts", loan: "l1", account: null });
  });
});
