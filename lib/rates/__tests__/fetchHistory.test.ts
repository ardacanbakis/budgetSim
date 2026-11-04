import { describe, expect, it } from "vitest";
import { fetchRateHistory, fetchRatesOn } from "../fetchHistory";

/** A stand-in for the two providers: answers by URL, or fails. */
function fakeFetch(answers: Record<string, unknown>) {
  const asked: string[] = [];
  const fetcher = async (url: string) => {
    asked.push(url);
    const key = Object.keys(answers).find((k) => url.includes(k));
    if (!key || answers[key] === "down") return new Response("down", { status: 503 });
    return new Response(JSON.stringify(answers[key]), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { fetcher, asked };
}

describe("fetchRateHistory", () => {
  it("asks both sources for the range and keeps what each answered", async () => {
    const { fetcher, asked } = fakeFetch({
      "frankfurter.dev": { rates: { "2026-10-05": { TRY: 41, EUR: 0.9 } } },
      "coingecko.com": { prices: [[Date.UTC(2026, 9, 5, 12), 95000]] },
    });
    const history = await fetchRateHistory(30, new Date("2026-11-04T12:00:00Z"), fetcher);
    expect(asked[0]).toContain("/v1/2026-10-05..2026-11-04?base=USD&symbols=TRY,EUR");
    expect(asked[1]).toContain("market_chart?vs_currency=usd&days=30");
    expect(history.series.TRY).toEqual([["2026-10-05", 1 / 41]]);
    expect(history.series.BTC).toEqual([["2026-10-05", 95000]]);
  });

  it("still serves the fiat pairs when bitcoin's source is down", async () => {
    const { fetcher } = fakeFetch({ "frankfurter.dev": { rates: { "2026-10-05": { TRY: 41 } } }, "coingecko.com": "down" });
    const history = await fetchRateHistory(90, new Date("2026-11-04T12:00:00Z"), fetcher);
    expect(Object.keys(history.series)).toEqual(["TRY"]);
  });
});

describe("fetchRatesOn", () => {
  it("reads the day's rates, and the business day the ECB answered with", async () => {
    const { fetcher, asked } = fakeFetch({
      "frankfurter.dev": { date: "2025-03-14", rates: { TRY: 36.6, EUR: 0.92 } },
      "coingecko.com": { market_data: { current_price: { usd: 81000 } } },
    });
    const on = await fetchRatesOn("2025-03-16", fetcher);
    expect(asked[1]).toContain("history?date=16-03-2025");
    expect(on.date).toBe("2025-03-14");
    expect(on.usdPer.USD).toBe(1);
    expect(on.usdPer.TRY).toBeCloseTo(1 / 36.6);
    expect(on.usdPer.BTC).toBe(81000);
  });
});
