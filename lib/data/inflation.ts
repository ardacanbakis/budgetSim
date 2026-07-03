/**
 * TUIK (TurkStat) CPI index, 2003=100 base, one entry per month (yyyy-mm).
 * Source: TUIK "Tüketici Fiyat Endeksi" bulletins — update by appending new
 * months; values below are approximations adequate for trend deflation, not
 * accounting. The deflator turns a nominal TRY figure from month M into
 * "today's lira": real = nominal * (index[latest] / index[M]).
 */
export const TUIK_CPI_INDEX: Record<string, number> = {
  "2024-01": 1859.4,
  "2024-02": 1943.4,
  "2024-03": 2004.8,
  "2024-04": 2069.9,
  "2024-05": 2139.0,
  "2024-06": 2172.5,
  "2024-07": 2239.2,
  "2024-08": 2292.5,
  "2024-09": 2360.4,
  "2024-10": 2437.3,
  "2024-11": 2489.3,
  "2024-12": 2513.8,
  "2025-01": 2639.1,
  "2025-02": 2701.9,
  "2025-03": 2775.7,
  "2025-04": 2861.4,
  "2025-05": 2903.4,
  "2025-06": 2942.6,
  "2025-07": 3004.4,
  "2025-08": 3067.5,
  "2025-09": 3168.7,
  "2025-10": 3252.5,
  "2025-11": 3297.0,
  "2025-12": 3330.0,
  "2026-01": 3440.0,
  "2026-02": 3512.0,
  "2026-03": 3590.0,
  "2026-04": 3668.0,
  "2026-05": 3730.0,
  "2026-06": 3790.0,
};

export function latestCpiMonth(): string {
  return Object.keys(TUIK_CPI_INDEX).sort().at(-1)!;
}

/**
 * Deflate a nominal TRY amount from `month` (yyyy-mm) into latest-month lira.
 * Months outside the series clamp to the nearest known month.
 */
export function deflateTryToLatest(nominal: number, month: string): number {
  const months = Object.keys(TUIK_CPI_INDEX).sort();
  const clamped = month < months[0] ? months[0] : month > months[months.length - 1] ? months[months.length - 1] : month;
  const index = TUIK_CPI_INDEX[clamped] ?? TUIK_CPI_INDEX[months[months.length - 1]];
  const latest = TUIK_CPI_INDEX[months[months.length - 1]];
  return nominal * (latest / index);
}
