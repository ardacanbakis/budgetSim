import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { DemoRepo } from "../demoRepo";
import { describeError } from "../errors";
import { SupabaseRepo } from "../supabaseRepo";

/** Rate alerts and pinned conversions (migration 0025), in both repos. */

describe("rate alerts and pins in the demo", () => {
  it("fire, are dismissed and re-armed, and travel with a backup", async () => {
    const demo = new DemoRepo();
    await demo.importAll({ ...(await demo.exportAll()), rateAlerts: [], pinnedConversions: [] });
    const alert = await demo.createRateAlert({ fromUnit: "USD", toUnit: "TRY", direction: "above", threshold: 43 });
    expect(alert).toMatchObject({ triggeredAt: null, triggeredRate: null, acknowledgedAt: null });

    await demo.updateRateAlert(alert.id, { triggeredAt: "2026-11-04T10:00:00Z", triggeredRate: 43.2 });
    await demo.updateRateAlert(alert.id, { acknowledgedAt: "2026-11-04T10:05:00Z" });
    expect((await demo.listRateAlerts())[0]).toMatchObject({ triggeredRate: 43.2, acknowledgedAt: "2026-11-04T10:05:00Z" });

    await demo.updateRateAlert(alert.id, { triggeredAt: null, triggeredRate: null, acknowledgedAt: null });
    expect((await demo.listRateAlerts())[0].triggeredAt).toBeNull();

    const pin = await demo.createPinnedConversion({ fromUnit: "gold:ceyrek", toUnit: "TRY", amount: 2 });
    const backup = await demo.exportAll();
    const other = new DemoRepo();
    await other.importAll(backup);
    expect(await other.listRateAlerts()).toEqual(await demo.listRateAlerts());
    expect(await other.listPinnedConversions()).toEqual([pin]);

    await demo.deletePinnedConversion(pin.id);
    await demo.deleteRateAlert(alert.id);
    expect(await demo.listPinnedConversions()).toEqual([]);
    expect(await demo.listRateAlerts()).toEqual([]);
  });
});

function repoWithout0025() {
  const fetch = async (input: RequestInfo | URL) => {
    if (/\/(rate_alerts|pinned_conversions)/.test(String(input))) {
      return new Response(JSON.stringify({ code: "PGRST205", message: "Could not find the table in the schema cache" }), {
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

describe("on a database without migration 0025", () => {
  it("there are none, and adding one names the file to run", async () => {
    const repo = repoWithout0025();
    expect(await repo.listRateAlerts()).toEqual([]);
    expect(await repo.listPinnedConversions()).toEqual([]);
    for (const attempt of [
      repo.createRateAlert({ fromUnit: "USD", toUnit: "TRY", direction: "above", threshold: 43 }),
      repo.createPinnedConversion({ fromUnit: "USD", toUnit: "TRY", amount: 100 }),
    ]) {
      const err = await attempt.catch((e: unknown) => e);
      expect(describeError(err)).toMatchObject({ kind: "needsMigration", migration: "0025_rate_gadgets.sql" });
    }
  });
});
