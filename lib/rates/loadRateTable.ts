import { RateTable } from "@/lib/domain/fx";
import { fallbackTable } from "./fallback";

/**
 * One load of the rate table, for useRates.
 *
 * A failed fetch is rethrown when a table is already showing, so React Query
 * keeps that last good table instead of replacing it. Only when there is
 * nothing yet (offline from the start) does the static fallback stand in,
 * flagged stale, so amounts can still be converted. The next good fetch
 * replaces it.
 */
export async function loadRateTable(
  fetchTable: () => Promise<RateTable>,
  showing: RateTable | undefined
): Promise<RateTable> {
  try {
    return await fetchTable();
  } catch (err) {
    if (showing !== undefined) throw err;
    return fallbackTable();
  }
}
