import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { DemoRepo } from "../demoRepo";
import { describeError } from "../errors";
import { SupabaseRepo } from "../supabaseRepo";

/** The Gadgets page's timers (migration 0024), in both repos. */

describe("timers in the demo", () => {
  it("are created, edited and deleted, and come back as copies", async () => {
    const demo = new DemoRepo();
    await demo.importAll({ ...(await demo.exportAll()), timers: [] });
    const trip = await demo.createTimer({ name: "Trip", kind: "until", targetAt: "2030-12-31T15:30:00.000Z" });
    expect(await demo.listTimers()).toEqual([trip]);

    await demo.updateTimer(trip.id, { kind: "since", name: "Since the trip" });
    const [edited] = await demo.listTimers();
    expect(edited).toMatchObject({ id: trip.id, name: "Since the trip", kind: "since", targetAt: trip.targetAt });

    edited.name = "changed in the cache";
    expect((await demo.listTimers())[0].name).toBe("Since the trip");

    await demo.deleteTimer(trip.id);
    expect(await demo.listTimers()).toEqual([]);
  });

  it("travel with a backup", async () => {
    const demo = new DemoRepo();
    const timer = await demo.createTimer({ name: "Quit smoking", kind: "since", targetAt: "2025-01-01T08:00:00.000Z" });
    const backup = await demo.exportAll();
    expect(backup.timers).toContainEqual(timer);

    const other = new DemoRepo();
    await other.importAll(backup);
    expect(await other.listTimers()).toContainEqual(timer);
    // a backup from before timers restores with none
    await other.importAll({ ...backup, timers: undefined });
    expect(await other.listTimers()).toEqual([]);
  });
});

/** The real supabase-js client against a PostgREST stand-in that has no timers table. */
function repoWithoutTimers() {
  const fetch = async (input: RequestInfo | URL) => {
    if (String(input).includes("/timers")) {
      return new Response(JSON.stringify({ code: "PGRST205", message: "Could not find the table 'public.timers' in the schema cache" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  };
  const client = createClient("https://example.supabase.co", "anon-key", {
    global: { fetch },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return new SupabaseRepo(client, "user-1");
}

describe("timers on a database without migration 0024", () => {
  it("read as none", async () => {
    expect(await repoWithoutTimers().listTimers()).toEqual([]);
  });

  it("refuse a new one, naming the file to run", async () => {
    const err = await repoWithoutTimers()
      .createTimer({ name: "Trip", kind: "until", targetAt: "2030-12-31T15:30:00.000Z" })
      .catch((e: unknown) => e);
    expect(describeError(err)).toMatchObject({ kind: "needsMigration", migration: "0024_timers.sql" });
  });
});
