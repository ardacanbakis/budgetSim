import { LoanOffer } from "./loanRates";

/**
 * Turkish loan rates from TCMB's EVDS statistics service.
 *
 * This is the central bank's own weekly series of weighted-average rates that
 * banks actually charged, by loan type. It is not a shop window: there are no
 * per-bank offers here, and the number is a market average rather than a quote
 * you can sign. That makes it the right thing to plan against and the wrong
 * thing to mistake for an offer, which is why offers from it are labelled as
 * an average rather than given a bank's name.
 *
 * EVDS quotes ANNUAL rates. Everything else in this app is monthly, the way
 * Turkish banks write it, so the conversion happens here — de-compounded, not
 * divided by twelve, because 60%/year is 3.99%/month and not 5%.
 */

/** Weighted-average rate series, by loan type. Overridable: TCMB renumbers. */
export const EVDS_SERIES: Record<string, string> = {
  "TP.KTF10": "ihtiyac",
  "TP.KTF11": "tasit",
  "TP.KTF12": "konut",
  "TP.KTF17": "ticari",
};

export const LOAN_TYPE_LABELS: Record<string, string> = {
  ihtiyac: "İhtiyaç",
  tasit: "Taşıt",
  konut: "Konut",
  ticari: "Ticari",
};

/** Annual percentage to the monthly rate that compounds to it. */
export function annualToMonthlyPct(annualPct: number): number {
  return (Math.pow(1 + annualPct / 100, 1 / 12) - 1) * 100;
}

/**
 * An EVDS rate outside this band is a series that does not mean what we think
 * it means — a volume in thousands of lira, say — rather than a rate.
 */
function plausibleAnnual(n: number): boolean {
  return n > 0 && n < 500;
}

function parseNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const n = Number(value.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/**
 * Normalize an EVDS response into offers.
 *
 * Shape: { "items": [ { "Tarih": "05-09-2026", "TP_KTF10": "58.42", … } ] }
 * EVDS replaces the dots in a series code with underscores in the keys, which
 * is the detail that silently returns nothing if you look for the code as
 * written. The most recent item with a usable value wins.
 */
export function parseEvdsLoanRates(payload: unknown): LoanOffer[] {
  const root = payload as { items?: Array<Record<string, unknown>> } | null;
  const items = Array.isArray(root?.items) ? root!.items : [];
  if (items.length === 0) return [];

  const offers: LoanOffer[] = [];
  for (const [code, type] of Object.entries(EVDS_SERIES)) {
    const key = code.replace(/\./g, "_");
    // walk back from the newest row: the latest week is often still blank
    for (let i = items.length - 1; i >= 0; i--) {
      const annual = parseNumber(items[i]?.[key]);
      if (annual == null || !plausibleAnnual(annual)) continue;
      offers.push({
        bank: "TCMB",
        product: LOAN_TYPE_LABELS[type] ?? type,
        monthlyRatePct: annualToMonthlyPct(annual),
        termMonths: null,
        amount: null,
      });
      break;
    }
  }
  return offers.sort((a, b) => a.monthlyRatePct - b.monthlyRatePct);
}

/** The date EVDS stamped the newest row it returned, when it gave one. */
export function evdsAsOf(payload: unknown): string | null {
  const root = payload as { items?: Array<Record<string, unknown>> } | null;
  const items = Array.isArray(root?.items) ? root!.items : [];
  for (let i = items.length - 1; i >= 0; i--) {
    const date = items[i]?.["Tarih"];
    if (typeof date === "string" && date.trim()) return date.trim();
  }
  return null;
}
