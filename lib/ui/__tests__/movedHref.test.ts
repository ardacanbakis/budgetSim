import { describe, expect, it } from "vitest";
import { movedHref } from "../movedHref";

describe("movedHref", () => {
  it("lands on the new address with the old query after its own", () => {
    expect(movedHref("/planner?tab=evim", {})).toBe("/planner?tab=evim");
    expect(movedHref("/planner?tab=evim", { plan: "p-1" })).toBe("/planner?tab=evim&plan=p-1");
    expect(movedHref("/accounts?view=debts", { loan: "l 2" })).toBe("/accounts?view=debts&loan=l+2");
  });

  it("keeps the new address's own keys, and every value of a repeated one", () => {
    expect(movedHref("/planner?tab=evim", { tab: "forecast", plan: "p" })).toBe("/planner?tab=evim&plan=p");
    expect(movedHref("/x", { a: ["1", "2"], b: undefined })).toBe("/x?a=1&a=2");
  });
});
