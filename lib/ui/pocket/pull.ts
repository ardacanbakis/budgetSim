/**
 * Pull-to-refresh for Pocket's shell, as a pure reducer over touch events.
 * Pocket turns the browser's own gesture off (overscroll-behavior-y: none in
 * app/globals.css, because Android's fired over sheets), and an installed PWA
 * has no reload button, so this is the way to fetch everything again.
 *
 * The rules, all here so they can be tested without a finger:
 * - a pull starts only with the page at the very top (scrollY 0), with no
 *   sheet or dialog open, and never while a refresh is still running;
 * - the first PULL_SLOP px decide what the gesture is: down and mostly
 *   vertical is a pull; sideways (a row's swipe, a strip of chips) or up (a
 *   scroll) lets go for the rest of the touch, so a small wobble never pulls;
 * - the indicator follows the finger with resistance (resist()), and lets go
 *   to refresh only once it has travelled PULL_THRESHOLD;
 * - a second finger, a cancelled touch or a release short of the threshold
 *   puts it back without refreshing.
 *
 * The shell (usePullToRefresh in components/pocket/shell.tsx) feeds it
 * touchstart/move/end/cancel and runs the refresh when it says "refreshing".
 */

export type PullPhase =
  /** no touch, or one that isn't a pull */
  | "idle"
  /** a touch at the top, not yet moved far enough to say what it is */
  | "tracking"
  /** pulling, not yet far enough to refresh */
  | "pulling"
  /** far enough: letting go refreshes */
  | "armed"
  /** the refresh is running */
  | "refreshing"
  /** this touch isn't a pull (scrolling, swiping, a sheet open); wait for the next */
  | "ignored";

export interface PullState {
  phase: PullPhase;
  startX: number;
  startY: number;
  /** how far the indicator has come down, after resistance, in px */
  distance: number;
}

export type PullEvent =
  | { type: "start"; x: number; y: number; scrollY: number; blocked: boolean; touches?: number }
  | { type: "move"; x: number; y: number; touches?: number }
  | { type: "end" }
  | { type: "cancel" }
  /** the refresh finished (or failed) */
  | { type: "done" };

/** finger travel that decides between a pull and anything else */
export const PULL_SLOP = 10;
/** indicator travel (after resistance) that arms the refresh */
export const PULL_THRESHOLD = 64;
/** the indicator never comes further than this */
export const PULL_MAX = 120;
/** how much more vertical than sideways a pull must be */
const VERTICAL_RATIO = 1.5;

export const PULL_IDLE: PullState = { phase: "idle", startX: 0, startY: 0, distance: 0 };

/** Finger travel to indicator travel: one to one at first, then ever stiffer, never past PULL_MAX. */
export function resist(dy: number): number {
  if (dy <= 0) return 0;
  return (PULL_MAX * dy) / (dy + PULL_MAX);
}

export function pullReducer(state: PullState, event: PullEvent): PullState {
  switch (event.type) {
    case "start": {
      // a refresh runs to its end; a new touch doesn't start another
      if (state.phase === "refreshing") return state;
      if (event.blocked || event.scrollY > 0 || (event.touches ?? 1) > 1) return { ...PULL_IDLE, phase: "ignored" };
      return { phase: "tracking", startX: event.x, startY: event.y, distance: 0 };
    }
    case "move": {
      if (state.phase === "idle" || state.phase === "ignored" || state.phase === "refreshing") return state;
      if ((event.touches ?? 1) > 1) return { ...PULL_IDLE, phase: "ignored" };
      const dx = event.x - state.startX;
      const dy = event.y - state.startY;
      if (state.phase === "tracking") {
        if (Math.hypot(dx, dy) < PULL_SLOP) return state;
        // down, and clearly more down than sideways; anything else is someone else's gesture
        if (dy <= 0 || dy < Math.abs(dx) * VERTICAL_RATIO) return { ...state, phase: "ignored", distance: 0 };
      }
      const distance = resist(dy);
      return { ...state, phase: distance >= PULL_THRESHOLD ? "armed" : "pulling", distance };
    }
    case "end":
      if (state.phase === "armed") return { ...state, phase: "refreshing", distance: PULL_THRESHOLD };
      if (state.phase === "refreshing") return state;
      return PULL_IDLE;
    case "cancel":
      return state.phase === "refreshing" ? state : PULL_IDLE;
    case "done":
      return PULL_IDLE;
  }
}
