import { RateTable, UsdPerMap } from "@/lib/domain/fx";

/**
 * Static fallback rates (approximate, mid-2026) used only when every live
 * source is unreachable — e.g. demo mode offline. The UI marks them stale.
 */
export const FALLBACK_USD_PER: UsdPerMap = {
  USD: 1,
  TRY: 1 / 41.8,
  EUR: 1.09,
  BTC: 104000,
  XAU_G: 78.5,
};

export const FALLBACK_SOURCE = "fallback";

/** The whole table as the client uses it when /api/rates can't be reached. */
export function fallbackTable(): RateTable {
  return {
    usdPer: FALLBACK_USD_PER,
    fetchedAt: new Date().toISOString(),
    sources: { USD: FALLBACK_SOURCE },
    stale: true,
  };
}

/**
 * Rates that mustn't be frozen into history or a net-worth snapshot: the
 * client couldn't reach /api/rates at all, or the server had to fill some
 * currency from the static rates above.
 */
export function isStaleTable(table: RateTable): boolean {
  return table.stale === true || Object.values(table.sources).some((s) => s === FALLBACK_SOURCE);
}
