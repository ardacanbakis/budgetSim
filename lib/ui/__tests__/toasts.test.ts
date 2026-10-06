import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toDbError } from "@/lib/data/errors";
import { currentToasts, dismissToast, showErrorToast, TOAST_MS } from "../toasts";

const pg = (code: string, message: string) => toDbError({ code, message });

beforeEach(() => {
  vi.useFakeTimers();
  for (const t of currentToasts()) dismissToast(t.id);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("error toasts", () => {
  it("says what failed in plain terms, and goes away on its own", () => {
    showErrorToast("save", pg("23514", 'new row violates check constraint "transactions_amount_check"'));
    expect(currentToasts()).toMatchObject([{ action: "save", kind: "rejected", detail: "transactions_amount_check" }]);
    vi.advanceTimersByTime(TOAST_MS);
    expect(currentToasts()).toEqual([]);
  });

  it("can be dismissed early", () => {
    showErrorToast("save", new Error("boom"));
    dismissToast(currentToasts()[0].id);
    expect(currentToasts()).toEqual([]);
  });

  it("keeps what needs action on screen until it's dismissed", () => {
    showErrorToast("load", pg("PGRST301", "JWT expired"));
    vi.advanceTimersByTime(TOAST_MS * 10);
    expect(currentToasts()).toHaveLength(1);
  });

  it("says a shared cause once, even when every list on the page fails with it", () => {
    showErrorToast("load", pg("42703", "column transactions.legacy does not exist"));
    showErrorToast("load", pg("42703", "column accounts.credit_limit does not exist"));
    showErrorToast("save", pg("PGRST204", "Could not find the 'legacy' column"));
    expect(currentToasts()).toHaveLength(1);
  });

  it("doesn't repeat the same failure, but shows different ones", () => {
    showErrorToast("save", new Error("boom"));
    showErrorToast("save", new Error("boom"));
    showErrorToast("save", new Error("bang"));
    expect(currentToasts().map((t) => t.detail)).toEqual(["boom", "bang"]);
  });

  it("shows at most three at a time, the newest", () => {
    for (const n of [1, 2, 3, 4]) showErrorToast("save", new Error(`failure ${n}`));
    expect(currentToasts().map((t) => t.detail)).toEqual(["failure 2", "failure 3", "failure 4"]);
  });
});
