import { CURRENCIES, Currency, CURRENCY_META, isCurrency } from "./currencies";
import { RateTable } from "./fx";
import { GOLD_META, GOLD_TYPES, GoldType, goldRatiosOf, isGoldType } from "./gold";

/**
 * The Gadgets page's converter: every unit the rate table prices, against
 * every other. That's the five account currencies (TRY, USD, EUR, BTC and
 * gram gold), plus each other kind of gold (çeyrek, tam, 22 ayar…) the gold
 * feed prices that day, as `gold:<type>`.
 *
 * Gold is at a dealer's buying price (alış), as everywhere else in the app:
 * a coin is worth its own price ÷ the gram price in grams of gram gold
 * (lib/domain/gold.ts). A coin type the feed didn't price isn't offered,
 * rather than shown at a stand-in.
 */

export type GoldUnit = `gold:${Exclude<GoldType, "gram">}`;
export type ConverterUnit = Currency | GoldUnit;

export const DEFAULT_FROM: ConverterUnit = "USD";
export const DEFAULT_TO: ConverterUnit = "TRY";

export function goldTypeOf(unit: ConverterUnit): GoldType | null {
  if (!unit.startsWith("gold:")) return null;
  const type = unit.slice(5);
  return isGoldType(type) ? type : null;
}

export function isConverterUnit(value: string): value is ConverterUnit {
  if (isCurrency(value)) return true;
  const type = value.startsWith("gold:") ? value.slice(5) : "";
  return isGoldType(type) && type !== "gram";
}

/** The units this table can price: the currencies with a rate, then the gold types with a live price. */
export function availableUnits(table: Pick<RateTable, "usdPer" | "goldTry"> | undefined): ConverterUnit[] {
  if (!table) return [];
  const units: ConverterUnit[] = CURRENCIES.filter((c) => table.usdPer[c] != null && table.usdPer[c]! > 0);
  if (table.usdPer.XAU_G && table.usdPer.TRY) {
    for (const type of GOLD_TYPES) {
      if (type === "gram") continue;
      const price = table.goldTry?.[type];
      if (price && price > 0) units.push(`gold:${type}`);
    }
  }
  return units;
}

/** How many USD one unit is worth, or null when the table can't say. */
export function usdPerUnit(unit: ConverterUnit, table: Pick<RateTable, "usdPer" | "goldTry">): number | null {
  if (isCurrency(unit)) {
    const rate = table.usdPer[unit];
    return rate != null && rate > 0 ? rate : null;
  }
  const type = goldTypeOf(unit);
  const gram = table.usdPer.XAU_G;
  if (!type || !gram || !table.goldTry?.[type]) return null;
  return goldRatiosOf(table)[type] * gram;
}

/** An amount of one unit in another, unrounded; null when either has no rate. */
export function convertUnits(
  amount: number,
  from: ConverterUnit,
  to: ConverterUnit,
  table: Pick<RateTable, "usdPer" | "goldTry">
): number | null {
  if (!Number.isFinite(amount)) return null;
  if (from === to) return amount;
  const a = usdPerUnit(from, table);
  const b = usdPerUnit(to, table);
  if (a == null || b == null) return null;
  return (amount * a) / b;
}

/** Decimals a result is shown to: BTC to the satoshi, everything else to the cent or hundredth of a coin. */
export function unitDecimals(unit: ConverterUnit): number {
  return isCurrency(unit) ? CURRENCY_META[unit].decimals : 2;
}

/** "g" or "pcs": how a gold type is counted. Currencies have none. */
export function unitMeasure(unit: ConverterUnit): "g" | "pcs" | null {
  if (unit === "XAU_G") return "g";
  const type = goldTypeOf(unit);
  return type ? GOLD_META[type].unit : null;
}

/**
 * A rate as a person reads it: four decimals for anything from 1 up
 * (41.8000 → "41.8"), six significant digits below that, so a lira in
 * bitcoin doesn't come out as 0.
 */
export function formatRate(value: number, locale = "en"): string {
  const intl = locale === "tr" ? "tr-TR" : "en-US";
  const abs = Math.abs(value);
  if (abs >= 1 || abs === 0) return new Intl.NumberFormat(intl, { maximumFractionDigits: 4 }).format(value);
  return new Intl.NumberFormat(intl, { maximumSignificantDigits: 6 }).format(value);
}

/** An amount in a unit, to that unit's decimals, without a symbol: the caller puts the unit's name next to it. */
export function formatUnitAmount(value: number, unit: ConverterUnit, locale = "en"): string {
  const decimals = unitDecimals(unit);
  // tiny results (a lira in bitcoin) would round to 0 at a fixed precision
  if (value !== 0 && Math.abs(value) < 10 ** -decimals) return formatRate(value, locale);
  return new Intl.NumberFormat(locale === "tr" ? "tr-TR" : "en-US", {
    minimumFractionDigits: Math.min(decimals, 2),
    maximumFractionDigits: decimals,
  }).format(value);
}
