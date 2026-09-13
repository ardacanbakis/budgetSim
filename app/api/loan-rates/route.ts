import { NextResponse } from "next/server";
import { LoanOffer, normalizeLoanOffers } from "@/lib/domain/loanRates";
import { evdsAsOf, EVDS_SERIES, parseEvdsLoanRates } from "@/lib/domain/tcmbLoanRates";

/**
 * Current Turkish loan rates.
 *
 * Two kinds of answer, tried in order:
 *
 *  - TCMB EVDS, the central bank's own weekly weighted-average of what banks
 *    actually charged, by loan type. Free, and the closest thing to an
 *    authoritative number — but an average, not an offer you can sign.
 *  - CollectAPI, which returns per-bank offers, for whoever has a key.
 *
 * Averages lead because they need no commercial relationship and never go
 * stale in the way a scraped shop window does. Both are labelled in the
 * response so the page can say which it is showing, since planning against an
 * average and shopping against an offer are different activities.
 *
 * Server-side so no key reaches the browser, cached for an hour because these
 * series move weekly at most.
 */

export const revalidate = 3600;

const COLLECT_DEFAULT = "https://api.collectapi.com/economy/loans";
const EVDS_DEFAULT = "https://evds2.tcmb.gov.tr/service/evds";

export interface RateAttempt {
  source: string;
  ok: boolean;
  detail?: string;
  asOf?: string;
}

export type LoanRatesResponse =
  | { status: "ok"; source: string; kind: "average" | "offers"; offers: LoanOffer[]; asOf: string | null; fetchedAt: string; attempts: RateAttempt[] }
  | { status: "unconfigured"; attempts: RateAttempt[] }
  | { status: "error"; message: string; attempts: RateAttempt[] };

const TIMEOUT_MS = 8_000;

async function getJson(url: string, init?: RequestInit) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), next: { revalidate } });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

/**
 * EVDS wants a date window, a series list and a key. The window is deliberately
 * wide: these series publish weekly and the newest week is often still blank,
 * so asking for a single day usually returns nothing at all.
 */
function evdsUrl(key: string): string {
  const base = process.env.TCMB_EVDS_URL || EVDS_DEFAULT;
  const end = new Date();
  const start = new Date(end.getTime() - 120 * 86_400_000);
  const fmt = (d: Date) =>
    `${String(d.getUTCDate()).padStart(2, "0")}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${d.getUTCFullYear()}`;
  const series = (process.env.TCMB_EVDS_SERIES || Object.keys(EVDS_SERIES).join("-")).trim();
  // EVDS takes its arguments path-style rather than as a normal query string,
  // so this is built by hand instead of with URLSearchParams
  return (
    `${base}/series=${series}` +
    `&startDate=${fmt(start)}&endDate=${fmt(end)}` +
    `&type=json&key=${encodeURIComponent(key)}`
  );
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const attempts: RateAttempt[] = [];
  const fetchedAt = new Date().toISOString();

  const evdsKey = process.env.TCMB_EVDS_KEY;
  if (evdsKey) {
    try {
      const payload = await getJson(evdsUrl(evdsKey));
      const offers = parseEvdsLoanRates(payload);
      if (offers.length > 0) {
        const asOf = evdsAsOf(payload);
        attempts.push({ source: "tcmb", ok: true, asOf: asOf ?? undefined });
        return NextResponse.json({
          status: "ok",
          source: "tcmb",
          kind: "average",
          offers,
          asOf,
          fetchedAt,
          attempts,
        } satisfies LoanRatesResponse);
      }
      attempts.push({ source: "tcmb", ok: false, detail: "no readable series in the response" });
    } catch (err) {
      attempts.push({ source: "tcmb", ok: false, detail: reason(err) });
    }
  } else {
    attempts.push({ source: "tcmb", ok: false, detail: "TCMB_EVDS_KEY not set" });
  }

  const collectKey = process.env.COLLECT_API_KEY;
  if (collectKey) {
    try {
      const target = new URL(process.env.COLLECT_API_LOAN_URL || COLLECT_DEFAULT);
      // pass through what the caller asked for, so the quote matches the plan
      for (const name of ["amount", "maturity", "type"]) {
        const value = params.get(name);
        if (value) target.searchParams.set(name, value);
      }
      const offers = normalizeLoanOffers(
        await getJson(target.toString(), {
          headers: {
            authorization: collectKey.startsWith("apikey ") ? collectKey : `apikey ${collectKey}`,
            "content-type": "application/json",
          },
        })
      );
      if (offers.length > 0) {
        attempts.push({ source: "collectapi", ok: true });
        return NextResponse.json({
          status: "ok",
          source: "collectapi",
          kind: "offers",
          offers,
          asOf: null,
          fetchedAt,
          attempts,
        } satisfies LoanRatesResponse);
      }
      attempts.push({ source: "collectapi", ok: false, detail: "no readable rates in the response" });
    } catch (err) {
      attempts.push({ source: "collectapi", ok: false, detail: reason(err) });
    }
  } else {
    attempts.push({ source: "collectapi", ok: false, detail: "COLLECT_API_KEY not set" });
  }

  // nothing configured at all is not an error: the app works fine without it,
  // you just type the rate you were quoted
  if (attempts.every((a) => a.detail?.includes("not set"))) {
    return NextResponse.json({ status: "unconfigured", attempts } satisfies LoanRatesResponse);
  }
  return NextResponse.json({
    status: "error",
    message: attempts.find((a) => !a.ok)?.detail ?? "no provider answered",
    attempts,
  } satisfies LoanRatesResponse);
}

function reason(err: unknown): string {
  if (err instanceof Error) return err.name === "TimeoutError" ? "timed out" : err.message;
  return "failed";
}
