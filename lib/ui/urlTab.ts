/**
 * A tab kept in the URL (?tab=income): the value when it is one of the
 * allowed ones, else the fallback. Classic and Pocket read the Activity tabs
 * through this one rule, so a link means the same tab in both layouts.
 */
export function parseTab<T extends string>(value: string | null | undefined, allowed: readonly T[], fallback: T): T {
  return value != null && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}
