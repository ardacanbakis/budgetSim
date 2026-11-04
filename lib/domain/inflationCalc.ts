/**
 * The Gadgets page's inflation calculator: what a lira amount from one month
 * is worth in another month's lira, by TÜİK's consumer price index
 * (lib/data/inflation.ts, the same table the reports deflate with). The
 * table only reaches so far, so months outside it are read as its nearest
 * end, and the result says which months it actually used.
 */

export interface InflationResult {
  /** the amount in the later month's lira */
  value: number;
  /** price rise between the two months, in percent (negative if prices fell) */
  changePct: number;
  /** the same rise as a yearly rate, when the months are at least one apart */
  annualPct: number | null;
  /** the months the index was read at, after clamping to the table */
  fromMonth: string;
  toMonth: string;
  /** true when a month asked for was outside the table */
  clamped: boolean;
}

const MONTH = /^\d{4}-\d{2}$/;

function monthsBetween(a: string, b: string): number {
  const [ya, ma] = a.split("-").map(Number);
  const [yb, mb] = b.split("-").map(Number);
  return (yb - ya) * 12 + (mb - ma);
}

/** `amount` lira of `fromMonth` in `toMonth` lira (yyyy-mm each), or null for something it can't read. */
export function inflate(amount: number, fromMonth: string, toMonth: string, index: Record<string, number>): InflationResult | null {
  if (!Number.isFinite(amount) || !MONTH.test(fromMonth) || !MONTH.test(toMonth)) return null;
  const months = Object.keys(index).sort();
  if (months.length === 0) return null;
  const clamp = (m: string) => (m < months[0] ? months[0] : m > months[months.length - 1] ? months[months.length - 1] : m);
  const from = clamp(fromMonth);
  const to = clamp(toMonth);
  const ratio = index[to] / index[from];
  const span = monthsBetween(from, to);
  return {
    value: amount * ratio,
    changePct: (ratio - 1) * 100,
    annualPct: span !== 0 ? (Math.pow(ratio, 12 / span) - 1) * 100 : null,
    fromMonth: from,
    toMonth: to,
    clamped: from !== fromMonth || to !== toMonth,
  };
}
