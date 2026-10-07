import { describe, expect, it } from "vitest";
import { describeError, IncompleteReadError, toDbError } from "../errors";

/** What supabase-js hands back in `error` for a failed request. */
const pg = (code: string, message: string) => toDbError({ code, message, details: null, hint: null });

describe("toDbError", () => {
  it("keeps the code, details and hint that a plain Error would drop", () => {
    const err = toDbError({ code: "23503", message: "violates foreign key", details: "Key is still referenced", hint: "" });
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("violates foreign key");
    expect(err.code).toBe("23503");
    expect(err.details).toBe("Key is still referenced");
  });
});

describe("describeError", () => {
  it("a delete blocked by rows that still point at it", () => {
    const err = pg("23503", 'update or delete on table "accounts" violates foreign key constraint "transactions_account_id_fkey" on table "transactions"');
    expect(describeError(err).kind).toBe("inUse");
  });

  it("a save that points at something no longer there", () => {
    const err = pg("23503", 'insert or update on table "transactions" violates foreign key constraint "transactions_account_id_fkey"');
    expect(describeError(err).kind).toBe("missingLink");
  });

  it("a value the database's checks turn down", () => {
    const err = pg("23514", 'new row for relation "transactions" violates check constraint "transactions_amount_check"');
    expect(describeError(err)).toEqual({ kind: "rejected", detail: "transactions_amount_check" });
  });

  it("a duplicate", () => {
    expect(describeError(pg("23505", "duplicate key value violates unique constraint")).kind).toBe("duplicate");
  });

  it("a database that hasn't had the latest migration", () => {
    for (const code of ["42703", "42P01", "42883", "PGRST202", "PGRST204", "PGRST205"]) {
      expect(describeError(pg(code, "column transactions.legacy does not exist")).kind).toBe("needsMigration");
    }
  });

  it("an expired session, by code or by message", () => {
    expect(describeError(pg("PGRST301", "JWT expired")).kind).toBe("sessionExpired");
    expect(describeError(pg("PGRST303", "JWT expired")).kind).toBe("sessionExpired");
    expect(describeError(new Error("JWT expired")).kind).toBe("sessionExpired");
  });

  it("no connection, from the browser or from supabase-js", () => {
    expect(describeError(new TypeError("Failed to fetch")).kind).toBe("offline");
    expect(describeError(pg("", "TypeError: Failed to fetch")).kind).toBe("offline");
    expect(describeError(new TypeError("NetworkError when attempting to fetch resource.")).kind).toBe("offline");
  });

  it("a read cut short", () => {
    expect(describeError(new IncompleteReadError("transactions", 1000, 1240)).kind).toBe("incompleteRead");
  });

  it("anything else, with its own message kept as the detail", () => {
    expect(describeError(new Error("loan schedule is empty"))).toEqual({ kind: "unknown", detail: "loan schedule is empty" });
    expect(describeError("boom")).toEqual({ kind: "unknown", detail: "boom" });
    expect(describeError(pg("XX000", "internal error"))).toEqual({ kind: "unknown", detail: "internal error" });
  });
});
