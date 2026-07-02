import { UsdPerMap } from "@/lib/domain/fx";

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
