import { describe, expect, it } from "vitest";
import { SWIPE_IDLE, SWIPE_SLOP, SWIPE_THRESHOLD, SwipeEvent, swipeOffset, swipeReducer, SwipeState } from "../pocket/swipe";

const both = { right: true, left: true };
const run = (events: SwipeEvent[], from: SwipeState = SWIPE_IDLE) => events.reduce(swipeReducer, from);
const start = (allow = both, blocked = false): SwipeEvent => ({ type: "start", x: 100, y: 300, blocked, allow });
const move = (dx: number, dy = 0): SwipeEvent => ({ type: "move", x: 100 + dx, y: 300 + dy });
const end: SwipeEvent = { type: "end" };

describe("row swipe", () => {
  it("fires right past the threshold", () => {
    const dragged = run([start(), move(20), move(SWIPE_THRESHOLD + 5)]);
    expect(dragged.phase).toBe("swiping");
    expect(dragged.armed).toBe("right");
    expect(swipeReducer(dragged, end)).toEqual({ ...SWIPE_IDLE, fired: "right" });
  });

  it("fires left past the threshold", () => {
    expect(run([start(), move(-20), move(-(SWIPE_THRESHOLD + 5)), end]).fired).toBe("left");
  });

  it("fires nothing short of the threshold, or when brought back before letting go", () => {
    const short = run([start(), move(SWIPE_THRESHOLD - 5)]);
    expect(short.phase).toBe("swiping");
    expect(short.armed).toBeNull();
    expect(swipeReducer(short, end).fired).toBeNull();
    expect(run([start(), move(SWIPE_THRESHOLD + 20), move(30), end]).fired).toBeNull();
  });

  it("lets a vertical drag scroll: the scroll wins for the rest of the touch", () => {
    const scrolled = run([start(), move(4, 30)]);
    expect(scrolled.phase).toBe("ignored");
    expect(run([start(), move(4, 30), move(SWIPE_THRESHOLD + 40, 30), end]).fired).toBeNull();
    // a diagonal that isn't clearly sideways is a scroll too
    expect(run([start(), move(20, 15)]).phase).toBe("ignored");
  });

  it("says nothing until the finger has moved past the slop; a tap is a tap", () => {
    const small = run([start(), move(SWIPE_SLOP - 3, 2)]);
    expect(small.phase).toBe("tracking");
    expect(small.offset).toBe(0);
    expect(swipeReducer(small, end)).toEqual(SWIPE_IDLE);
  });

  it("never starts while a sheet is open or selection mode is on", () => {
    const blocked = run([start(both, true), move(SWIPE_THRESHOLD + 40)]);
    expect(blocked.phase).toBe("ignored");
    expect(blocked.offset).toBe(0);
    expect(swipeReducer(blocked, end).fired).toBeNull();
  });

  it("gives only a little in a direction the row doesn't allow, and never arms it", () => {
    const leftOnly = { right: false, left: true };
    const refused = run([start(leftOnly), move(20), move(300)]);
    expect(refused.phase).toBe("swiping");
    expect(refused.armed).toBeNull();
    expect(refused.offset).toBeGreaterThan(0);
    expect(refused.offset).toBeLessThan(SWIPE_THRESHOLD / 2);
    expect(swipeReducer(refused, end).fired).toBeNull();
    // the other way still works
    expect(run([start(leftOnly), move(-20), move(-(SWIPE_THRESHOLD + 5)), end]).fired).toBe("left");
  });

  it("cancels on a second finger or a cancelled touch", () => {
    const armed = run([start(), move(20), move(SWIPE_THRESHOLD + 5)]);
    expect(swipeReducer(armed, { type: "move", x: 300, y: 300, touches: 2 }).phase).toBe("ignored");
    expect(swipeReducer(armed, { type: "cancel" })).toEqual(SWIPE_IDLE);
    expect(swipeReducer(SWIPE_IDLE, { type: "start", x: 0, y: 0, blocked: false, allow: both, touches: 2 }).phase).toBe("ignored");
  });

  it("follows the finger one to one up to the threshold, stiffer after", () => {
    expect(swipeOffset(40, both)).toBe(40);
    expect(swipeOffset(-40, both)).toBe(-40);
    expect(swipeOffset(SWIPE_THRESHOLD + 100, both)).toBeLessThan(SWIPE_THRESHOLD + 50);
    expect(swipeOffset(SWIPE_THRESHOLD + 100, both)).toBeGreaterThan(SWIPE_THRESHOLD);
  });
});
