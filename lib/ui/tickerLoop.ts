/**
 * The arithmetic of the rate tape's loop (components/rateTicker.tsx), pure so
 * it can be checked without a screen.
 *
 * The quotes are laid out as one "set", repeated side by side. The tape
 * slides left by `offset` pixels and wraps it into [0, set width): one set
 * along, the picture is the same as at 0, so the loop has no seam. For that
 * the repeats must cover the visible width at every offset, which takes
 * enough sets to fill it plus one sliding in (tickerCopies).
 */

/** How many sets fill `viewport` pixels at any offset: at least two. */
export function tickerCopies(viewport: number, set: number): number {
  if (!(set > 0) || !(viewport > 0)) return 2;
  return Math.max(2, Math.ceil(viewport / set) + 1);
}

/** `offset` brought into [0, set): dragging past either end carries on round. */
export function wrapOffset(offset: number, set: number): number {
  if (!(set > 0) || !Number.isFinite(offset)) return 0;
  const r = offset % set;
  return r < 0 ? r + set : r;
}

/**
 * The speed a fling leaves behind after `seconds`, slowing smoothly (to
 * about a twentieth in a second), and nothing once it's too slow to see.
 */
export function coast(velocity: number, seconds: number): number {
  const next = velocity * Math.pow(0.05, seconds);
  return Math.abs(next) < 5 ? 0 : next;
}
