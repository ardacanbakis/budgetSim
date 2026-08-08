import { NextResponse } from "next/server";
import { normalizeLoanOffers } from "@/lib/domain/loanRates";

/**
 * Current Turkish bank loan rates, for the planner's borrowing card.
 *
 * Server-side so the API key never reaches the browser, and cached for an hour
 * because loan boards move daily at most and every device asking separately
 * would burn the quota for nothing.
 *
 * Configure with:
 *   COLLECT_API_KEY       the same CollectAPI key the gram-gold rate already
 *                         uses, so enabling this costs you no new account
 *   COLLECT_API_LOAN_URL  optional — override the endpoint
 *
 * The URL is an env var rather than a constant on purpose: CollectAPI has
 * several loan endpoints with different paths and query names, and which one
 * you get depends on the plan you bought. Overriding a variable beats waiting
 * on a code change.
 */

export const revalidate = 3600;

const DEFAULT_URL = "https://api.collectapi.com/economy/loans";

export type LoanRatesResponse =
  | { status: "ok"; offers: ReturnType<typeof normalizeLoanOffers>; fetchedAt: string }
  | { status: "unconfigured" }
  | { status: "error"; message: string };

export async function GET(request: Request) {
  const key = process.env.COLLECT_API_KEY;
  if (!key) {
    // not an error: the app works fine without it, you just type the rate in
    return NextResponse.json({ status: "unconfigured" } satisfies LoanRatesResponse);
  }

  const params = new URL(request.url).searchParams;
  const target = new URL(process.env.COLLECT_API_LOAN_URL || DEFAULT_URL);
  // pass through what the caller asked for, so the quote matches the plan
  for (const name of ["amount", "maturity", "type"]) {
    const value = params.get(name);
    if (value) target.searchParams.set(name, value);
  }

  try {
    const res = await fetch(target, {
      headers: {
        // the provider's own examples show the key already carrying the
        // prefix, so only add it when it's missing
        authorization: key.startsWith("apikey ") ? key : `apikey ${key}`,
        "content-type": "application/json",
      },
      next: { revalidate },
    });
    if (!res.ok) {
      return NextResponse.json({
        status: "error",
        message: `provider responded ${res.status}`,
      } satisfies LoanRatesResponse);
    }
    const offers = normalizeLoanOffers(await res.json());
    if (offers.length === 0) {
      return NextResponse.json({
        status: "error",
        message: "no readable rates in the response",
      } satisfies LoanRatesResponse);
    }
    return NextResponse.json({
      status: "ok",
      offers,
      fetchedAt: new Date().toISOString(),
    } satisfies LoanRatesResponse);
  } catch (err) {
    return NextResponse.json({
      status: "error",
      message: err instanceof Error ? err.message : "fetch failed",
    } satisfies LoanRatesResponse);
  }
}
