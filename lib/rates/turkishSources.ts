/**
 * Free, keyless Turkish market data for gold and the lira.
 *
 * Gram gold is the number people in Turkey actually price things against, and
 * the sources that quote it well are Turkish ones quoting the Kapalıçarşı
 * free market — not an international spot feed converted through an ECB
 * reference rate. Both providers here are free and need no key, so gold works
 * out of the box instead of only for whoever has a CollectAPI subscription.
 *
 * Everything in this file is a pure parser. Shapes differ between providers
 * and between versions of the same provider, and the network is the part most
 * likely to change, so the parsing is tested against recorded payloads and the
 * fetching is kept somewhere else.
 */

export interface GoldQuote {
  /** price of one gram of gold, in TRY */
  tryPerGram: number;
  /** provider's own timestamp, when it gives one */
  asOf: string | null;
}

export interface FxQuote {
  /** lira per one USD, e.g. 41.80 */
  tryPerUsd: number;
  /** lira per one EUR, when the provider quotes it */
  tryPerEur: number | null;
  asOf: string | null;
}

/**
 * Turkish numbers use "." for thousands and "," for the decimal — "4.123,45"
 * is four thousand, not four. Getting this backwards silently divides gold by
 * a thousand, which looks plausible enough on a chart to go unnoticed, so it
 * is handled explicitly rather than by stripping punctuation.
 *
 * Plain machine decimals ("4123.45") and real numbers pass through unharmed.
 */
export function parseTurkishNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[^\d.,-]/g, "").trim();
  if (!cleaned) return null;

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");

  let normalized: string;
  if (lastComma > lastDot) {
    // comma is the decimal separator: dots are thousands grouping
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (lastDot > lastComma) {
    // dot is the decimal separator: commas are thousands grouping
    normalized = cleaned.replace(/,/g, "");
  } else {
    normalized = cleaned;
  }

  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

/** A gram price this far outside the plausible band is a parse error, not a rally. */
const MIN_GRAM_TRY = 100;
const MAX_GRAM_TRY = 1_000_000;

export function plausibleGram(n: number | null): n is number {
  return n != null && n >= MIN_GRAM_TRY && n <= MAX_GRAM_TRY;
}

const MIN_TRY_PER_USD = 1;
const MAX_TRY_PER_USD = 10_000;

export function plausibleUsd(n: number | null): n is number {
  return n != null && n >= MIN_TRY_PER_USD && n <= MAX_TRY_PER_USD;
}

type Row = Record<string, unknown>;

const asRow = (v: unknown): Row | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : null;

/** First readable number among several candidate keys. */
function pickNumber(row: Row | null, keys: string[]): number | null {
  if (!row) return null;
  for (const key of keys) {
    const n = parseTurkishNumber(row[key]);
    if (n != null) return n;
  }
  return null;
}

/** Selling price is what you'd pay, so it leads; buying is the fallback. */
const SELL_KEYS = ["Selling", "satis", "Satış", "Satis", "selling", "sell"];
const BUY_KEYS = ["Buying", "alis", "Alış", "Alis", "buying", "buy"];

function priceOf(row: Row | null): number | null {
  return pickNumber(row, SELL_KEYS) ?? pickNumber(row, BUY_KEYS);
}

function asOfOf(payload: Row, row: Row | null): string | null {
  const candidates = [payload["Update_Date"], payload["Meta_Data"], row?.["tarih"], row?.["Update_Date"]];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
    const meta = asRow(c);
    const inner = meta?.["Update_Date"];
    if (typeof inner === "string" && inner.trim()) return inner.trim();
  }
  return null;
}

/**
 * Truncgil (finance.truncgil.com). Two shapes in the wild:
 *   v4  { "GRA": { "Type": "Gold", "Buying": 4123.45, "Selling": 4125 }, ... }
 *   v3  { "Gram Altın": { "Alış": "4.123,45", "Satış": "4.125,00" }, ... }
 * Both are accepted because which one a deployment gets depends on the URL it
 * was pointed at, and that is an environment variable.
 */
export function parseTruncgilGold(payload: unknown): GoldQuote | null {
  const root = asRow(payload);
  if (!root) return null;
  const row =
    asRow(root["GRA"]) ??
    asRow(root["gram-altin"]) ??
    asRow(root["Gram Altın"]) ??
    asRow(root["Gram Altin"]);
  const price = priceOf(row);
  if (!plausibleGram(price)) return null;
  return { tryPerGram: price, asOf: asOfOf(root, row) };
}

export function parseTruncgilFx(payload: unknown): FxQuote | null {
  const root = asRow(payload);
  if (!root) return null;
  const usdRow = asRow(root["USD"]) ?? asRow(root["Amerikan Doları"]);
  const eurRow = asRow(root["EUR"]) ?? asRow(root["Euro"]);
  const usd = priceOf(usdRow);
  if (!plausibleUsd(usd)) return null;
  const eur = priceOf(eurRow);
  return {
    tryPerUsd: usd,
    tryPerEur: plausibleUsd(eur) ? eur : null,
    asOf: asOfOf(root, usdRow),
  };
}

/**
 * GenelPara (api.genelpara.com/embed/altin.json). Flat map keyed by an
 * abbreviation — "GA" is gram altın — with dotted decimals as strings.
 */
export function parseGenelParaGold(payload: unknown): GoldQuote | null {
  const root = asRow(payload);
  if (!root) return null;
  const row = asRow(root["GA"]) ?? asRow(root["gram"]) ?? asRow(root["gramaltin"]);
  const price = priceOf(row);
  if (!plausibleGram(price)) return null;
  return { tryPerGram: price, asOf: asOfOf(root, row) };
}

export function parseGenelParaFx(payload: unknown): FxQuote | null {
  const root = asRow(payload);
  if (!root) return null;
  const usd = priceOf(asRow(root["USD"]));
  if (!plausibleUsd(usd)) return null;
  const eur = priceOf(asRow(root["EUR"]));
  return { tryPerUsd: usd, tryPerEur: plausibleUsd(eur) ? eur : null, asOf: asOfOf(root, asRow(root["USD"])) };
}

/** CollectAPI's goldPrice, which the app already supported — kept as a source. */
export function parseCollectApiGold(payload: unknown): GoldQuote | null {
  const root = asRow(payload);
  const list = root?.["result"];
  if (!Array.isArray(list)) return null;
  const gram = list
    .map(asRow)
    .find((r) => typeof r?.["name"] === "string" && (r["name"] as string).toLocaleLowerCase("tr").includes("gram altın"));
  const price = priceOf(gram ?? null);
  if (!plausibleGram(price)) return null;
  return { tryPerGram: price, asOf: null };
}
