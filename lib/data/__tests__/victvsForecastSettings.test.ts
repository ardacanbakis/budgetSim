import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { DemoRepo } from "../demoRepo";
import { DbError, describeError } from "../errors";
import { SupabaseRepo } from "../supabaseRepo";

/**
 * The VICTVS forecast's own figures (user_settings.victvs_forecast, migration
 * 0017), through the real supabase-js client against a stand-in for
 * PostgREST. `missingColumn` answers the way a database without 0017 does.
 */
function repoAgainst(server: { missingColumn: boolean; row?: Record<string, unknown> }) {
  const requests: { method: string; url: string; body: string | null }[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? init.body : null;
    requests.push({ method, url, body });
    if (server.missingColumn && method === "POST" && body?.includes("victvs_forecast")) {
      return new Response(
        JSON.stringify({ code: "PGRST204", message: "Could not find the 'victvs_forecast' column of 'user_settings' in the schema cache" }),
        { status: 400, headers: { "content-type": "application/json" } }
      );
    }
    if (method === "GET") {
      return new Response(JSON.stringify(server.row ?? null), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(null, { status: 201 });
  };
  const client = createClient("https://example.supabase.co", "anon-key", {
    global: { fetch },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { repo: new SupabaseRepo(client, "user-1"), requests };
}

const ROW = { theme: "system", compact: false, dashboard_layout: null };

describe("the VICTVS forecast's figures in user_settings", () => {
  it("reads a database without 0017 as no figures of your own", async () => {
    const { repo } = repoAgainst({ missingColumn: true, row: ROW });
    expect((await repo.getUserSettings()).victvsForecast).toBeNull();
  });

  it("reads and writes them as victvs_forecast", async () => {
    const stored = { overrides: { "2026-12": 900 } };
    const { repo, requests } = repoAgainst({ missingColumn: false, row: { ...ROW, victvs_forecast: stored } });
    expect((await repo.getUserSettings()).victvsForecast).toEqual(stored);
    await repo.saveUserSettings({ victvsForecast: { overrides: { "2027-01": 0 } } });
    const upsert = requests.find((r) => r.method === "POST");
    expect(JSON.parse(upsert!.body!)).toMatchObject({ victvs_forecast: { overrides: { "2027-01": 0 } } });
  });

  it("keeps every other setting saving on a database without 0017", async () => {
    const { repo, requests } = repoAgainst({ missingColumn: true });
    await repo.saveUserSettings({ compact: true });
    expect(requests.find((r) => r.method === "POST")!.body).not.toContain("victvs_forecast");
  });

  it("says which file to run when a forecast edit needs it", async () => {
    const { repo } = repoAgainst({ missingColumn: true });
    const err = await repo.saveUserSettings({ victvsForecast: { overrides: { "2026-12": 900 } } }).catch((e) => e);
    expect(err).toBeInstanceOf(DbError);
    expect(describeError(err)).toMatchObject({ kind: "needsMigration", migration: "0017_victvs_forecast.sql" });
  });

  it("keeps them in the demo, and an older sandbox without them reads as none", async () => {
    const demo = new DemoRepo();
    expect((await demo.getUserSettings()).victvsForecast).toBeNull();
    await demo.saveUserSettings({ victvsForecast: { overrides: { "2026-12": 900 } } });
    expect((await demo.getUserSettings()).victvsForecast).toEqual({ overrides: { "2026-12": 900 } });
  });
});
