import { NextResponse } from "next/server";
import { isHistoryRange } from "@/lib/domain/rateHistory";
import { fetchRateHistory, fetchRatesOn } from "@/lib/rates/fetchHistory";

/**
 * Exchange-rate history for the Gadgets page (lib/domain/rateHistory.ts):
 *   ?days=30|90|365   each currency's series over that many days
 *   ?on=yyyy-mm-dd    every currency's rate on one past date
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const on = params.get("on");
  if (on != null) {
    const today = new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(on) || Number.isNaN(Date.parse(on)) || on > today || on < "1999-01-04") {
      return NextResponse.json({ error: "on must be a date from 1999-01-04 to today" }, { status: 400 });
    }
    return NextResponse.json(await fetchRatesOn(on));
  }
  const days = Number(params.get("days") ?? 90);
  if (!isHistoryRange(days)) return NextResponse.json({ error: "days must be 30, 90 or 365" }, { status: 400 });
  return NextResponse.json(await fetchRateHistory(days));
}
