import { describe, expect, it } from "vitest";
import { balanceAfter, planAdjustment, planChange } from "../adjustments";

describe("planAdjustment", () => {
  it("records what the bank shows as missing as an expense", () => {
    // ledger says 12,500.00; the bank says 12,465.50 after an EFT fee
    expect(planAdjustment(12500, 12465.5, "TRY")).toEqual({ direction: "expense", amount: 34.5 });
  });

  it("records what the bank shows as extra as income", () => {
    expect(planAdjustment(1000, 1003.21, "USD")).toEqual({ direction: "income", amount: 3.21 });
  });

  it("returns nothing when the two already agree at the currency's precision", () => {
    expect(planAdjustment(100.004, 100, "TRY")).toBeNull();
    expect(planAdjustment(0.1 + 0.2, 0.3, "USD")).toBeNull();
  });

  it("works in each currency's own precision", () => {
    expect(planAdjustment(0.5, 0.49990001, "BTC")).toEqual({ direction: "expense", amount: 0.00009999 });
  });

  it("refuses a target too big to work out", () => {
    expect(planAdjustment(100, 1e307, "TRY")).toBeNull();
    expect(planAdjustment(100, Number.POSITIVE_INFINITY, "TRY")).toBeNull();
  });

  it("can take a balance below zero", () => {
    expect(planAdjustment(20, -5, "TRY")).toEqual({ direction: "expense", amount: 25 });
  });
});

describe("planChange", () => {
  it("turns a known change into an entry", () => {
    expect(planChange(35, "expense", "TRY")).toEqual({ direction: "expense", amount: 35 });
  });

  it("ignores a zero or unreadable amount", () => {
    expect(planChange(0, "income", "TRY")).toBeNull();
    expect(planChange(Number.NaN, "income", "TRY")).toBeNull();
  });
});

describe("balanceAfter", () => {
  it("lands exactly on the target", () => {
    const plan = planAdjustment(12500, 12465.5, "TRY");
    expect(balanceAfter(12500, plan, "TRY")).toBe(12465.5);
  });

  it("leaves the balance alone when there is nothing to record", () => {
    expect(balanceAfter(99.99, null, "USD")).toBe(99.99);
  });
});
