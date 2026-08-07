/**
 * Ranking for the quick jump. Pure and separate from the palette component so
 * the matching rules can be tested without mounting anything.
 */

/**
 * Subsequence match, the same rule editors use: every letter you type has to
 * appear in order, so "trns" finds Transactions and "akb" finds Akbank.
 *
 * Score rewards letters that start a word and letters that land next to the
 * previous hit, which is enough to float the obvious answer to the top without
 * a fuzzy-search dependency. Returns null when the query doesn't fit at all.
 */
export function scoreMatch(query: string, text: string): number | null {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let score = 0;
  let at = 0;
  let last = -1;
  for (const ch of q) {
    const found = t.indexOf(ch, at);
    if (found === -1) return null;
    if (found === 0 || t[found - 1] === " " || t[found - 1] === "/") score += 8;
    if (last >= 0 && found === last + 1) score += 4;
    score += 1;
    last = found;
    at = found + 1;
  }
  // an exact prefix beats an artful scatter
  if (t.startsWith(q)) score += 20;
  return score;
}

export interface Rankable {
  label: string;
}

/** Best match first; entries the query can't reach at all drop out. */
export function rankByLabel<T extends Rankable>(query: string, items: T[]): T[] {
  if (!query.trim()) return items;
  return items
    .map((item) => ({ item, score: scoreMatch(query.trim(), item.label) }))
    .filter((x): x is { item: T; score: number } => x.score !== null)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.item);
}
