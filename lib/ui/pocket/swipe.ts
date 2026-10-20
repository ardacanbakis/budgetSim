/**
 * Swiping a Pocket list row, as a pure reducer over touch events.
 *
 * Right marks a planned row paid (the same path as its ✓, Undo included);
 * left opens the row's actions sheet. Neither does anything destructive, and
 * both stay reachable without a finger: the row is a button and the ✓ is
 * its own button.
 *
 * The rules, all here so they can be tested without a finger:
 * - nothing starts while a sheet is open or selection mode is on (the caller
 *   says so with `blocked`);
 * - the first SWIPE_SLOP px decide what the gesture is: clearly sideways is
 *   a swipe; anything more vertical is a scroll, and the scroll wins for the
 *   rest of the touch;
 * - the row follows the finger; past SWIPE_THRESHOLD in a direction the row
 *   allows, it's armed, and letting go fires it. A direction the row doesn't
 *   allow (right on a row that can't be marked paid) only gives a little, and
 *   never arms;
 * - letting go short of the threshold, a second finger or a cancelled touch
 *   puts the row back and fires nothing.
 *
 * components/pocket/rowSwipe.tsx feeds it a row's touches and reads `fired`
 * from the state that "end" returns.
 */

export type SwipeDirection = "right" | "left";

export interface SwipeState {
  phase: "idle" | "tracking" | "swiping" | "ignored";
  startX: number;
  startY: number;
  /** how far the row has moved sideways, after resistance; + is right */
  offset: number;
  /** past the threshold in an allowed direction: letting go fires it */
  armed: SwipeDirection | null;
  /** set by "end" when a swipe completed */
  fired: SwipeDirection | null;
  /** which directions this row allows, from "start" */
  allow: { right: boolean; left: boolean };
}

export type SwipeEvent =
  | { type: "start"; x: number; y: number; blocked: boolean; allow: { right: boolean; left: boolean }; touches?: number }
  | { type: "move"; x: number; y: number; touches?: number }
  | { type: "end" }
  | { type: "cancel" };

/** finger travel that decides between a swipe and a scroll */
export const SWIPE_SLOP = 10;
/** row travel that arms a swipe */
export const SWIPE_THRESHOLD = 80;
/** past the threshold, the row follows the finger at this rate */
const PAST_RATE = 0.35;
/** a direction the row doesn't allow gives this much of the finger's travel, at most MAX_REFUSED */
const REFUSED_RATE = 0.2;
const MAX_REFUSED = 24;
/** how much more sideways than vertical a swipe must be */
const SIDEWAYS_RATIO = 1.5;

export const SWIPE_IDLE: SwipeState = {
  phase: "idle",
  startX: 0,
  startY: 0,
  offset: 0,
  armed: null,
  fired: null,
  allow: { right: false, left: false },
};

/** Finger travel (dx) to row travel: one to one up to the threshold, stiffer after; little in a refused direction. */
export function swipeOffset(dx: number, allow: SwipeState["allow"]): number {
  const allowed = dx > 0 ? allow.right : allow.left;
  const size = Math.abs(dx);
  const moved = !allowed
    ? Math.min(MAX_REFUSED, size * REFUSED_RATE)
    : size <= SWIPE_THRESHOLD
      ? size
      : SWIPE_THRESHOLD + (size - SWIPE_THRESHOLD) * PAST_RATE;
  return Math.sign(dx) * moved;
}

export function swipeReducer(state: SwipeState, event: SwipeEvent): SwipeState {
  switch (event.type) {
    case "start":
      if (event.blocked || (event.touches ?? 1) > 1 || (!event.allow.right && !event.allow.left)) {
        return { ...SWIPE_IDLE, phase: "ignored" };
      }
      return { ...SWIPE_IDLE, phase: "tracking", startX: event.x, startY: event.y, allow: event.allow };
    case "move": {
      if (state.phase === "idle" || state.phase === "ignored") return state;
      if ((event.touches ?? 1) > 1) return { ...SWIPE_IDLE, phase: "ignored" };
      const dx = event.x - state.startX;
      const dy = event.y - state.startY;
      if (state.phase === "tracking") {
        if (Math.hypot(dx, dy) < SWIPE_SLOP) return state;
        // anything but clearly sideways is a scroll, and the scroll keeps the touch
        if (Math.abs(dx) < Math.abs(dy) * SIDEWAYS_RATIO) return { ...state, phase: "ignored" };
      }
      const offset = swipeOffset(dx, state.allow);
      const direction: SwipeDirection = offset > 0 ? "right" : "left";
      const armed = Math.abs(offset) >= SWIPE_THRESHOLD && state.allow[direction] ? direction : null;
      return { ...state, phase: "swiping", offset, armed };
    }
    case "end":
      return { ...SWIPE_IDLE, fired: state.phase === "swiping" ? state.armed : null };
    case "cancel":
      return SWIPE_IDLE;
  }
}
