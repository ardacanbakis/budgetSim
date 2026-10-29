/**
 * What a list grouped by year and month starts with folded: everything after
 * this month (months still to come, and whole years ahead) always, so the
 * list opens on now and what's behind it; earlier years too when Settings'
 * "collapse history" is on. Keys are the ones the lists toggle: a year
 * ("2026") and a month ("2026-11").
 */
export function initialFold(
  groups: ReadonlyArray<readonly [string, ReadonlyArray<{ month: string }>]>,
  thisMonth: string,
  collapseHistory: boolean
): Set<string> {
  const thisYear = thisMonth.slice(0, 4);
  const folded = new Set<string>();
  for (const [year, months] of groups) {
    if (year > thisYear || (collapseHistory && year < thisYear)) folded.add(year);
    // a month ahead stays folded inside its year, opened or not
    for (const m of months) if (m.month > thisMonth) folded.add(m.month);
  }
  return folded;
}
