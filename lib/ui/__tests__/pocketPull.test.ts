import { describe, expect, it } from "vitest";
import { PULL_IDLE, PULL_MAX, PULL_SLOP, PULL_THRESHOLD, PullEvent, pullReducer, PullState, resist } from "../pocket/pull";

const run = (events: PullEvent[], from: PullState = PULL_IDLE) => events.reduce(pullReducer, from);
const top = (x = 100, y = 100): PullEvent => ({ type: "start", x, y, scrollY: 0, blocked: false });
const move = (x: number, y: number): PullEvent => ({ type: "move", x, y });

/** finger travel that brings the indicator to the threshold */
const ARM = (PULL_THRESHOLD * PULL_MAX) / (PULL_MAX - PULL_THRESHOLD) + 1;

describe("pull to refresh", () => {
  it("refreshes after a long enough pull down from the top", () => {
    const pulled = run([top(), move(100, 100 + ARM)]);
    expect(pulled.phase).toBe("armed");
    expect(pulled.distance).toBeGreaterThanOrEqual(PULL_THRESHOLD);
    const released = pullReducer(pulled, { type: "end" });
    expect(released.phase).toBe("refreshing");
    expect(pullReducer(released, { type: "done" })).toEqual(PULL_IDLE);
  });

  it("puts it back when let go short of the threshold", () => {
    const pulled = run([top(), move(100, 100 + ARM - 20)]);
    expect(pulled.phase).toBe("pulling");
    expect(pullReducer(pulled, { type: "end" })).toEqual(PULL_IDLE);
  });

  it("disarms when the finger goes back up before letting go", () => {
    const state = run([top(), move(100, 100 + ARM), move(100, 120), { type: "end" }]);
    expect(state.phase).toBe("idle");
  });

  it("never starts below the top of the page", () => {
    const state = run([{ type: "start", x: 100, y: 100, scrollY: 1, blocked: false }, move(100, 100 + ARM), { type: "end" }]);
    expect(state.phase).toBe("idle");
  });

  it("never starts with a sheet open", () => {
    const started = pullReducer(PULL_IDLE, { type: "start", x: 100, y: 100, scrollY: 0, blocked: true });
    expect(started.phase).toBe("ignored");
    expect(pullReducer(started, move(100, 100 + ARM)).phase).toBe("ignored");
  });

  it("lets a sideways drag go: a row's swipe or a strip's scroll wins", () => {
    const state = run([top(), move(100 + 40, 100 + 20), move(100 + 40, 100 + ARM)]);
    expect(state.phase).toBe("ignored");
    expect(pullReducer(state, { type: "end" }).phase).toBe("idle");
  });

  it("lets an upward drag go: that's a scroll", () => {
    expect(run([top(), move(100, 100 - 30), move(100, 100 + ARM)]).phase).toBe("ignored");
  });

  it("says nothing until the finger has moved past the slop", () => {
    const state = run([top(), move(100 + 3, 100 + PULL_SLOP - 4)]);
    expect(state.phase).toBe("tracking");
    expect(state.distance).toBe(0);
    // a tap is just a tap
    expect(pullReducer(state, { type: "end" })).toEqual(PULL_IDLE);
  });

  it("cancels on a second finger or a cancelled touch", () => {
    const pulled = run([top(), move(100, 100 + ARM)]);
    expect(pullReducer(pulled, { type: "move", x: 100, y: 100 + ARM, touches: 2 }).phase).toBe("ignored");
    expect(pullReducer(pulled, { type: "cancel" })).toEqual(PULL_IDLE);
    expect(pullReducer(PULL_IDLE, { type: "start", x: 0, y: 0, scrollY: 0, blocked: false, touches: 2 }).phase).toBe("ignored");
  });

  it("runs one refresh at a time", () => {
    const refreshing = run([top(), move(100, 100 + ARM), { type: "end" }]);
    expect(pullReducer(refreshing, top()).phase).toBe("refreshing");
    expect(pullReducer(refreshing, move(100, 400)).phase).toBe("refreshing");
    expect(pullReducer(refreshing, { type: "cancel" }).phase).toBe("refreshing");
  });

  it("resists: one to one at first, ever stiffer, never past the maximum", () => {
    expect(resist(0)).toBe(0);
    expect(resist(-20)).toBe(0);
    expect(resist(10)).toBeGreaterThan(9);
    expect(resist(200) - resist(100)).toBeLessThan(resist(100) - resist(0));
    expect(resist(10_000)).toBeLessThan(PULL_MAX);
  });
});
