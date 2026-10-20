/** A page's searchParams, as Next hands them to a server page. */
export type SearchParamsRecord = Record<string, string | string[] | undefined>;

/**
 * Where an old address lands now that its page moved into another: the new
 * address with its own query (/planner?tab=evim), then whatever the old one
 * carried (?plan=…), so a bookmark or a shared link keeps meaning the same
 * thing. A key the new address sets itself is not carried over.
 */
export function movedHref(target: string, carried: SearchParamsRecord): string {
  const [path, query = ""] = target.split("?");
  const params = new URLSearchParams(query);
  const own = new Set(params.keys());
  for (const [key, value] of Object.entries(carried)) {
    if (own.has(key) || value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) params.append(key, v);
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}
