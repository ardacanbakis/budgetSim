import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoRepo } from "../demoRepo";

/*
 * DemoRepo with a browser-like localStorage that can be told to refuse
 * writes, the way a full one does.
 */

let failing = false;
const stored = new Map<string, string>();

beforeEach(() => {
  failing = false;
  stored.clear();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (failing) throw new Error("The quota has been exceeded.");
        stored.set(key, value);
      },
      removeItem: (key: string) => stored.delete(key),
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DemoRepo when saving fails", () => {
  it("reports the failure and leaves nothing behind in memory", async () => {
    const repo = new DemoRepo();
    const before = (await repo.listAccounts()).length;

    failing = true;
    await expect(repo.createAccount({ name: "Extra", currency: "TRY", kind: "fiat", openingBalance: 0 })).rejects.toThrow("quota");
    // what didn't persist didn't happen
    expect(await repo.listAccounts()).toHaveLength(before);
  });

  it("redoes the work on the next try instead of finding it already done", async () => {
    const repo = new DemoRepo();
    const [account] = await repo.listAccounts();
    const tpl = await repo.createTemplate({
      name: "Probe bill",
      accountId: account.id,
      direction: "expense",
      categoryId: null,
      amount: 100,
      frequency: "monthly",
      startDate: "2026-12-01",
      endDate: null,
      autoComplete: false,
    });

    failing = true;
    await expect(repo.materializeTemplates(12)).rejects.toThrow("quota");
    failing = false;
    expect(await repo.materializeTemplates(12)).toBeGreaterThan(0);

    // and it's in storage, not just in memory
    const reopened = new DemoRepo();
    expect((await reopened.listTransactions()).some((t) => t.recurringTemplateId === tpl.id)).toBe(true);
  });
});
