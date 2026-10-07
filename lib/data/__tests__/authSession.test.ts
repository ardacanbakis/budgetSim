import { describe, expect, it } from "vitest";
import { authChange } from "../authSession";

const alice = { userId: "u-alice", email: "alice@example.com" };
const bob = { userId: "u-bob", email: "bob@example.com" };
const nobody = { userId: null, email: null };

describe("authChange", () => {
  it("the first answer about who's signed in sets up the session", () => {
    expect(authChange(undefined, alice)).toBe("user");
    expect(authChange(undefined, nobody)).toBe("user");
  });

  it("ignores events that don't change who's signed in", () => {
    // INITIAL_SESSION after getSession, TOKEN_REFRESHED about hourly, and the
    // SIGNED_IN supabase-js fires again when a tab comes back into focus
    expect(authChange(alice, { ...alice })).toBe("none");
    expect(authChange(nobody, { ...nobody })).toBe("none");
  });

  it("treats signing in, signing out and switching accounts as a new user", () => {
    expect(authChange(nobody, alice)).toBe("user");
    expect(authChange(alice, nobody)).toBe("user");
    expect(authChange(alice, bob)).toBe("user");
  });

  it("only updates the address when the same user changes their email", () => {
    expect(authChange(alice, { ...alice, email: "alice@new.example.com" })).toBe("email");
  });
});
