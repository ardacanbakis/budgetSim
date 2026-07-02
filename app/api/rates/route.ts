import { NextResponse } from "next/server";
import { fetchRateTable } from "@/lib/rates/fetchRates";

export const revalidate = 900; // one shared answer per 15 minutes, for every device

let historyWrittenAt = 0;

export async function GET() {
  const table = await fetchRateTable();

  // Optional rate history: written when a service role key is configured,
  // at most once per hour. Read-path never depends on it.
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (serviceKey && url && Date.now() - historyWrittenAt > 3600_000) {
    historyWrittenAt = Date.now();
    const rows = Object.entries(table.usdPer)
      .filter(([, v]) => v != null)
      .map(([currency, usd_per]) => ({
        currency,
        usd_per,
        source: table.sources[currency as keyof typeof table.sources] ?? "unknown",
      }));
    fetch(`${url}/rest/v1/fx_rates`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        authorization: `Bearer ${serviceKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(rows),
    }).catch(() => undefined);
  }

  return NextResponse.json(table);
}
