/**
 * A failed database request, with the Postgres or PostgREST code kept.
 * `new Error(error.message)` dropped it, and the code is what tells a
 * foreign-key restrict apart from a missing migration or an expired session.
 */
export class DbError extends Error {
  constructor(
    message: string,
    readonly code: string | null,
    readonly details: string | null = null,
    readonly hint: string | null = null
  ) {
    super(message);
    this.name = "DbError";
  }
}

/** A read that ended with fewer rows than the table said it had (see selectAll). */
export class IncompleteReadError extends Error {
  constructor(table: string, got: number, total: number) {
    super(`${table}: read ${got} of ${total} rows. The data changed or the server cut the read short; try again.`);
    this.name = "IncompleteReadError";
  }
}

/** The `error` supabase-js returns, as something that can be thrown. */
export function toDbError(error: { message: string; code?: string | null; details?: string | null; hint?: string | null }): DbError {
  return new DbError(error.message, error.code || null, error.details || null, error.hint || null);
}

export type ErrorKind =
  /** a delete stopped because other rows still point at this one (23503) */
  | "inUse"
  /** a save pointing at a row that no longer exists (23503) */
  | "missingLink"
  /** a value one of the database's checks refused (23514) */
  | "rejected"
  /** a unique constraint (23505) */
  | "duplicate"
  /** a column, table or function the app expects isn't in the database */
  | "needsMigration"
  | "sessionExpired"
  | "offline"
  /** a read that came back short (see selectAll) */
  | "incompleteRead"
  | "unknown";

export interface ErrorDescription {
  kind: ErrorKind;
  /** shown under the plain message: the constraint name, or the raw message when nothing better is known */
  detail: string;
}

const MIGRATION_CODES = new Set(["42703", "42P01", "42883", "PGRST202", "PGRST204", "PGRST205"]);
const SESSION_CODES = new Set(["PGRST301", "PGRST303"]);

/** Turns whatever a failed save or load threw into something a person can act on. */
export function describeError(err: unknown): ErrorDescription {
  const message = err instanceof Error ? err.message : String(err);
  const code = err instanceof DbError ? err.code : null;

  if (err instanceof IncompleteReadError) return { kind: "incompleteRead", detail: message };
  if ((code && SESSION_CODES.has(code)) || /jwt expired/i.test(message)) return { kind: "sessionExpired", detail: message };
  if (/failed to fetch|networkerror|network request failed|load failed/i.test(message)) return { kind: "offline", detail: message };
  if (code && MIGRATION_CODES.has(code)) return { kind: "needsMigration", detail: message };
  if (code === "23503") {
    return { kind: /^update or delete/i.test(message) ? "inUse" : "missingLink", detail: message };
  }
  if (code === "23514") {
    return { kind: "rejected", detail: /constraint "([^"]+)"/.exec(message)?.[1] ?? message };
  }
  if (code === "23505") return { kind: "duplicate", detail: message };
  return { kind: "unknown", detail: message };
}
