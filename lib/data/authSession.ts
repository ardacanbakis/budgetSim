export interface AuthIdentity {
  userId: string | null;
  email: string | null;
}

/**
 * What an auth event means for the app's data.
 *
 * Supabase reports far more often than anyone actually signs in or out:
 * INITIAL_SESSION when the listener attaches, TOKEN_REFRESHED about hourly,
 * and SIGNED_IN again whenever a tab comes back into focus. Only a different
 * user, or none, means the loaded data belongs to someone else and has to go.
 * Rebuilding the repo and clearing every query on each of those events threw
 * away half-filled forms and reloaded the whole ledger for nothing.
 *
 *   "user"  a new session: build a repo for it and drop what was loaded
 *   "email" same user, new address: update it and keep everything else
 *   "none"  nothing changed
 */
export function authChange(current: AuthIdentity | undefined, next: AuthIdentity): "user" | "email" | "none" {
  if (current === undefined || current.userId !== next.userId) return "user";
  return current.email !== next.email ? "email" : "none";
}
