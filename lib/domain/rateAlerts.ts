import { ConverterUnit, convertUnits, isConverterUnit } from "./converter";
import { RateTable } from "./fx";

/**
 * Rate alerts for the Gadgets page: "tell me when USD → TRY goes above 43",
 * "when a çeyrek drops below ₺5,000". Any pair the converter offers can be
 * watched (lib/domain/converter.ts). An alert is checked against the shared
 * rate table whenever the app has a live one; the first time it's met, the
 * moment and the rate are recorded on it (migration 0025), so it fires once
 * and says when. Re-arming clears that.
 */

export type AlertDirection = "above" | "below";

export interface AlertSpec {
  fromUnit: string;
  toUnit: string;
  direction: AlertDirection;
  threshold: number;
  triggeredAt: string | null;
}

/** How many `to` per one `from` today, or null when either has no rate (or the units aren't known). */
export function alertRate(alert: Pick<AlertSpec, "fromUnit" | "toUnit">, table: Pick<RateTable, "usdPer" | "goldTry">): number | null {
  if (!isConverterUnit(alert.fromUnit) || !isConverterUnit(alert.toUnit)) return null;
  return convertUnits(1, alert.fromUnit as ConverterUnit, alert.toUnit as ConverterUnit, table);
}

/** Whether a rate meets the alert: at or past its threshold, in its direction. */
export function isMet(alert: Pick<AlertSpec, "direction" | "threshold">, rate: number): boolean {
  return alert.direction === "above" ? rate >= alert.threshold : rate <= alert.threshold;
}

/**
 * How far the rate still has to move, as a share of today's rate: positive
 * means it has that far to go, 0 or less means it's there.
 */
export function distancePct(alert: Pick<AlertSpec, "direction" | "threshold">, rate: number): number {
  if (rate === 0) return 0;
  const gap = alert.direction === "above" ? alert.threshold - rate : rate - alert.threshold;
  return (gap / rate) * 100;
}

/** The armed alerts this table meets, each with the rate that met it. */
export function newlyMet<T extends AlertSpec>(alerts: T[], table: Pick<RateTable, "usdPer" | "goldTry">): { alert: T; rate: number }[] {
  const met: { alert: T; rate: number }[] = [];
  for (const alert of alerts) {
    if (alert.triggeredAt) continue;
    const rate = alertRate(alert, table);
    if (rate != null && isMet(alert, rate)) met.push({ alert, rate });
  }
  return met;
}
