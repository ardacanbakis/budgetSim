import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { FxSnapshot } from "@/lib/domain/fx";
import { FALLBACK_USD_PER } from "@/lib/rates/fallback";
import { DemoRepo } from "../demoRepo";
import { BackupFile } from "../repo";
import { SupabaseRepo } from "../supabaseRepo";

const snapshot: FxSnapshot = { usdPer: FALLBACK_USD_PER, at: "2026-10-16T09:00:00.000Z" };

/** A demo backup with one ordinary entry and one adjustment. */
async function backupWithAdjustment(): Promise<BackupFile> {
  const demo = new DemoRepo();
  const bank = await demo.createAccount({ name: "EnPara TRY", currency: "TRY", kind: "fiat", openingBalance: 100 });
  for (const adjustment of [false, true]) {
    await demo.createTransaction({
      accountId: bank.id,
      direction: "expense",
      categoryId: null,
      amount: 5,
      status: "completed",
      dueDate: "2026-10-14",
      description: adjustment ? "EFT fee" : "Simit",
      fxSnapshot: snapshot,
      adjustment,
    });
  }
  return demo.exportAll();
}

/**
 * The real supabase-js client against a stand-in for PostgREST that records
 * every request. `missingAdjustment` makes the server answer the way a
 * database without migration 0016 does.
 */
function repoAgainst(server: { missingAdjustment: boolean }) {
  const requests: { method: string; url: string; prefer: string | null }[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const prefer = new Headers(init?.headers).get("prefer");
    requests.push({ method, url, prefer });
    if (server.missingAdjustment && method === "GET" && url.includes("select=adjustment")) {
      return new Response(JSON.stringify({ code: "42703", message: 'column transactions.adjustment does not exist' }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  };
  const client = createClient("https://example.supabase.co", "anon-key", {
    global: { fetch },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { repo: new SupabaseRepo(client, "user-1"), requests };
}

describe("restoring a backup that holds adjustments", () => {
  it("refuses before deleting anything when the database lacks migration 0016", async () => {
    const backup = await backupWithAdjustment();
    const { repo, requests } = repoAgainst({ missingAdjustment: true });
    await expect(repo.importAll(backup)).rejects.toBeTruthy();
    expect(requests.some((r) => r.method === "DELETE")).toBe(false);
  });

  it("inserts rows without the flag as the column's default, not NULL", async () => {
    const backup = await backupWithAdjustment();
    const { repo, requests } = repoAgainst({ missingAdjustment: false });
    await repo.importAll(backup);
    const insert = requests.find((r) => r.method === "POST" && /\/transactions\?/.test(r.url));
    expect(insert).toBeDefined();
    expect(insert!.url).toContain("adjustment");
    expect(insert!.prefer).toContain("missing=default");
  });
});
