/**
 * Live Turkish bank loan rates.
 *
 * The market moves and every bank quotes a different rate for the same money,
 * so typing a rate from memory into the planner means planning against a
 * number that was true once. This pulls the current board instead.
 *
 * Shapes vary between providers and between endpoints of the same provider —
 * CollectAPI alone returns `rate`, `oran` and `faiz` for the same field
 * depending on which loan endpoint you hit — so parsing is deliberately
 * forgiving about key names and strict about the result: anything that
 * doesn't yield a usable rate is dropped rather than guessed at.
 */

export interface LoanOffer {
  bank: string;
  /** the bank's name for the product, when it gives one */
  product: string | null;
  /** monthly interest as a percentage, Turkish convention (2.89 = 2.89%/mo) */
  monthlyRatePct: number;
  /** the term the rate was quoted for, when the provider says */
  termMonths: number | null;
  /** the amount the rate was quoted for, when the provider says */
  amount: number | null;
}

/** Keys a provider might use, most specific first. */
const RATE_KEYS = ["monthlyRate", "monthly_rate", "rate", "oran", "faiz", "faizOrani", "interest"];
const BANK_KEYS = ["bank", "bankName", "banka", "name", "title"];
const PRODUCT_KEYS = ["product", "type", "urun", "kredi", "description", "creditType"];
const TERM_KEYS = ["term", "termMonths", "vade", "month", "months", "maturity"];
const AMOUNT_KEYS = ["amount", "tutar", "credit", "principal"];

function pick(row: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    if (row[k] != null && row[k] !== "") return row[k];
  }
  return undefined;
}

/**
 * "2,89", "%2.89", "2.89 %" and 2.89 all mean the same thing. A comma is a
 * decimal separator in Turkish, not a thousands separator, so it becomes a
 * dot rather than being stripped.
 */
export function parseRate(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/%/g, "").replace(/\s/g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseInt_(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value) : null;
  if (typeof value !== "string") return null;
  const n = Number(value.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/**
 * A quoted rate that lands above this isn't a monthly rate — it's the annual
 * one. No Turkish consumer loan is priced at 60% *per month*; several are at
 * 60% per year. Converting rather than rejecting keeps a provider that quotes
 * annually usable instead of silently empty.
 */
const MONTHLY_CEILING = 20;

export function toMonthly(rate: number): number {
  if (rate <= MONTHLY_CEILING) return rate;
  // de-compound: the monthly rate that produces this annual one
  return (Math.pow(1 + rate / 100, 1 / 12) - 1) * 100;
}

/** Pull whatever array of offers a response happens to be wrapped in. */
export function extractRows(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null);
  if (typeof payload !== "object" || payload === null) return [];
  const obj = payload as Record<string, unknown>;
  for (const key of ["result", "data", "results", "items"]) {
    const inner = obj[key];
    if (Array.isArray(inner)) return extractRows(inner);
    // some providers nest one level further: { result: { data: [...] } }
    if (inner && typeof inner === "object") {
      const nested = extractRows(inner);
      if (nested.length > 0) return nested;
    }
  }
  return [];
}

/**
 * Normalize a provider payload into offers, best rate first. Rows without a
 * readable rate or a bank name are dropped — an offer you can't attribute is
 * worse than no offer.
 */
export function normalizeLoanOffers(payload: unknown): LoanOffer[] {
  const offers: LoanOffer[] = [];
  for (const row of extractRows(payload)) {
    const rate = parseRate(pick(row, RATE_KEYS));
    const bank = pick(row, BANK_KEYS);
    if (rate == null || rate <= 0 || typeof bank !== "string" || !bank.trim()) continue;
    const product = pick(row, PRODUCT_KEYS);
    offers.push({
      bank: bank.trim(),
      product: typeof product === "string" && product.trim() ? product.trim() : null,
      monthlyRatePct: toMonthly(rate),
      termMonths: parseInt_(pick(row, TERM_KEYS)),
      amount: parseInt_(pick(row, AMOUNT_KEYS)),
    });
  }
  return offers.sort((a, b) => a.monthlyRatePct - b.monthlyRatePct);
}
