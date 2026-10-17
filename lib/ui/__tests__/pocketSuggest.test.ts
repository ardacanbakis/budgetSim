import { describe, expect, it } from "vitest";
import { Account, Category, Transaction } from "@/lib/data/types";
import { accountOrder, descriptionSuggestions, topCategories } from "../pocket/suggest";

let n = 0;
function tx(over: Partial<Transaction>): Transaction {
  n += 1;
  return {
    id: `t${n}`,
    accountId: "try",
    direction: "expense",
    categoryId: null,
    amount: 10,
    status: "completed",
    dueDate: "2026-10-10",
    completedAt: null,
    description: "",
    fxSnapshot: null,
    transferGroupId: null,
    transferMarketRate: null,
    recurringTemplateId: null,
    loanId: null,
    victvsPayoutId: null,
    purchaseId: null,
    legacy: false,
    createdAt: `2026-10-10T10:00:${String(n % 60).padStart(2, "0")}Z`,
    ...over,
  };
}

const cat = (id: string, direction: "income" | "expense" = "expense"): Category => ({ id, name: id, direction, color: "#000" });
const acc = (id: string, over: Partial<Account> = {}): Account => ({
  id,
  name: id,
  currency: "TRY",
  kind: "fiat",
  openingBalance: 0,
  archived: false,
  paymentAccountId: null,
  paymentDay: null,
  createdAt: "2026-01-01",
  ...over,
});

describe("descriptionSuggestions", () => {
  const list = [
    tx({ description: "Migros", categoryId: "food", accountId: "try", dueDate: "2026-10-01" }),
    tx({ description: "migros", categoryId: "home", accountId: "card", dueDate: "2026-10-08" }),
    tx({ description: "Metro", categoryId: "food", dueDate: "2026-10-05" }),
    tx({ description: "İstanbulkart", categoryId: "transport", dueDate: "2026-10-02" }),
    tx({ description: "Salary", direction: "income", dueDate: "2026-10-09" }),
    tx({ description: "To Wise USD", transferGroupId: "g1", dueDate: "2026-10-09" }),
    tx({ description: "Balance adjustment", adjustment: true, dueDate: "2026-10-09" }),
  ];

  it("matches by prefix in any case, newest use first, each description once", () => {
    const found = descriptionSuggestions(list, "m", "expense", "en");
    expect(found.map((s) => s.description)).toEqual(["migros", "Metro"]);
  });

  it("carries the account and category of the most recent use", () => {
    const [migros] = descriptionSuggestions(list, "MIG", "expense", "en");
    expect(migros).toEqual({ description: "migros", categoryId: "home", accountId: "card" });
  });

  it("lowercases the Turkish way in Turkish", () => {
    expect(descriptionSuggestions(list, "i̇st", "expense", "en").map((s) => s.description)).toEqual(["İstanbulkart"]);
    expect(descriptionSuggestions(list, "ist", "expense", "tr").map((s) => s.description)).toEqual(["İstanbulkart"]);
  });

  it("keeps to the direction and leaves out transfers and adjustments", () => {
    expect(descriptionSuggestions(list, "", "income", "en").map((s) => s.description)).toEqual(["Salary"]);
    const all = descriptionSuggestions(list, "", "expense", "en", 10).map((s) => s.description);
    expect(all).not.toContain("To Wise USD");
    expect(all).not.toContain("Balance adjustment");
  });

  it("stops at the limit", () => {
    expect(descriptionSuggestions(list, "", "expense", "en", 2)).toHaveLength(2);
  });
});

describe("topCategories", () => {
  const categories = [cat("rent"), cat("food"), cat("fun"), cat("health"), cat("salary", "income")];
  const today = "2026-10-16";

  it("orders by use in the last 90 days, then fills with the rest", () => {
    const list = [
      tx({ categoryId: "food", dueDate: "2026-10-01" }),
      tx({ categoryId: "food", dueDate: "2026-09-01" }),
      tx({ categoryId: "fun", dueDate: "2026-10-02" }),
      // too old to count
      tx({ categoryId: "health", dueDate: "2026-06-01" }),
      tx({ categoryId: "health", dueDate: "2026-06-02" }),
      tx({ categoryId: "health", dueDate: "2026-06-03" }),
    ];
    expect(topCategories(list, categories, "expense", today).map((c) => c.id)).toEqual(["food", "fun", "rent", "health"]);
  });

  it("breaks a tie by the more recent use", () => {
    const list = [tx({ categoryId: "rent", dueDate: "2026-09-01" }), tx({ categoryId: "fun", dueDate: "2026-10-01" })];
    expect(topCategories(list, categories, "expense", today, 2).map((c) => c.id)).toEqual(["fun", "rent"]);
  });

  it("only offers the direction's own categories, up to the limit", () => {
    expect(topCategories([], categories, "income", today).map((c) => c.id)).toEqual(["salary"]);
    expect(topCategories([], categories, "expense", today, 2)).toHaveLength(2);
  });

  it("ignores future planned rows and transfers", () => {
    const list = [tx({ categoryId: "health", dueDate: "2026-11-01" }), tx({ categoryId: "fun", transferGroupId: "g" })];
    expect(topCategories(list, categories, "expense", today)[0].id).toBe("rent");
  });
});

describe("accountOrder", () => {
  const accounts = [acc("try"), acc("usd"), acc("old", { archived: true }), acc("card", { kind: "credit_card" })];

  it("puts the last-used account first and keeps the rest in order, cards included", () => {
    expect(accountOrder(accounts, "card").map((a) => a.id)).toEqual(["card", "try", "usd"]);
    expect(accountOrder(accounts, null).map((a) => a.id)).toEqual(["try", "usd", "card"]);
  });

  it("leaves out archived accounts unless an edited entry is on one", () => {
    expect(accountOrder(accounts, "old").map((a) => a.id)).toEqual(["try", "usd", "card"]);
    expect(accountOrder(accounts, null, "old").map((a) => a.id)).toEqual(["try", "usd", "old", "card"]);
  });
});
