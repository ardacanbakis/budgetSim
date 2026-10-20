"use client";

import { ReactNode, useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { SWIPE_IDLE, SwipeDirection, SwipeEvent, swipeReducer } from "@/lib/ui/pocket/swipe";
import { Icon } from "./icons";

/** how long the row takes to slide back, when motion is welcome */
const SETTLE_MS = 200;
/** a click this soon after a swipe is the swipe's own, not a tap */
const CLICK_AFTER_SWIPE_MS = 500;

export interface RowSwipe {
  /** swiping right: mark paid; absent, the row only gives a little that way */
  right?: () => void;
  /** swiping left: the row's actions */
  left?: () => void;
}

/**
 * A list row (an <li>) that can be swiped: right to mark paid, left for its
 * actions (lib/ui/pocket/swipe.ts has the rules). While the row moves, what
 * the swipe will do shows behind it, and it says so more strongly once
 * letting go would do it. With `swipe` null (selection mode, or nothing to
 * swipe to) it's a plain row. The row's own buttons are untouched, so
 * keyboard and screen-reader users reach the same actions by them.
 */
export function SwipeableRow({ swipe, className = "", children }: { swipe: RowSwipe | null; className?: string; children: ReactNode }) {
  const { t } = useI18n();
  const content = useRef<HTMLDivElement>(null);
  const state = useRef(SWIPE_IDLE);
  const swipedAt = useRef(0);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hint, setHint] = useState<{ direction: SwipeDirection; armed: boolean } | null>(null);

  useEffect(
    () => () => {
      if (settle.current) clearTimeout(settle.current);
    },
    []
  );

  const dispatch = (event: SwipeEvent) => {
    const before = state.current;
    const next = swipeReducer(before, event);
    state.current = next;
    const el = content.current;
    if (!el) return;
    if (next.phase === "swiping") {
      if (settle.current) clearTimeout(settle.current);
      el.style.transition = "none";
      el.style.transform = `translateX(${next.offset}px)`;
      const direction: SwipeDirection = next.offset > 0 ? "right" : "left";
      const armed = next.armed != null;
      if (armed && before.armed == null) navigator.vibrate?.(8);
      setHint((h) => (h && h.direction === direction && h.armed === armed ? h : { direction, armed }));
      return;
    }
    if (before.phase !== "swiping") return;
    // let go, or cancelled: slide back (at once with reduced motion), then act
    swipedAt.current = Date.now();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.style.transition = reduced ? "none" : `transform ${SETTLE_MS}ms var(--pocket-ease, ease-out)`;
    el.style.transform = "";
    settle.current = setTimeout(() => setHint(null), reduced ? 0 : SETTLE_MS);
    if (next.fired === "right") swipe?.right?.();
    else if (next.fired === "left") swipe?.left?.();
  };

  const handlers = swipe
    ? {
        onTouchStart: (e: React.TouchEvent) => {
          const touch = e.touches[0];
          if (!touch) return;
          dispatch({
            type: "start",
            x: touch.clientX,
            y: touch.clientY,
            blocked: document.querySelector("[data-pocket-sheet-root]") != null,
            allow: { right: swipe.right != null, left: swipe.left != null },
            touches: e.touches.length,
          });
        },
        onTouchMove: (e: React.TouchEvent) => {
          const touch = e.touches[0];
          if (touch) dispatch({ type: "move", x: touch.clientX, y: touch.clientY, touches: e.touches.length });
        },
        onTouchEnd: () => dispatch({ type: "end" }),
        onTouchCancel: () => dispatch({ type: "cancel" }),
        // the browser may still call the end of a swipe a click: it isn't a tap
        onClickCapture: (e: React.MouseEvent) => {
          if (Date.now() - swipedAt.current < CLICK_AFTER_SWIPE_MS) {
            e.preventDefault();
            e.stopPropagation();
          }
        },
      }
    : {};

  return (
    <li
      className={`relative ${hint ? "overflow-hidden" : ""} ${className}`}
      data-swipe={hint ? hint.direction : undefined}
      data-swipe-armed={hint?.armed ? "" : undefined}
      {...handlers}
    >
      {hint ? <SwipeHint direction={hint.direction} armed={hint.armed} label={hint.direction === "right" ? t("pocket.lists.swipePaid") : t("pocket.lists.swipeOptions")} /> : null}
      <div ref={content} className={`relative flex items-center bg-[var(--surface)] ${swipe ? "touch-pan-y" : ""}`}>
        {children}
      </div>
    </li>
  );
}

/** What's behind a row while it's swiped: Paid (right) or Options (left); stronger once armed. */
function SwipeHint({ direction, armed, label }: { direction: SwipeDirection; armed: boolean; label: string }) {
  const right = direction === "right";
  const tone = right
    ? armed
      ? "bg-emerald-600 text-white dark:bg-emerald-500 dark:text-zinc-950"
      : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
    : armed
      ? "bg-zinc-600 text-white dark:bg-zinc-300 dark:text-zinc-950"
      : "bg-[var(--edge-soft)] text-zinc-700 dark:text-zinc-200";
  return (
    <div
      aria-hidden
      data-swipe-hint={direction}
      className={`absolute inset-0 flex items-center gap-2 px-5 text-sm font-semibold ${right ? "justify-start" : "justify-end"} ${tone}`}
    >
      {right ? <Icon name="check" size={20} /> : null}
      <span>{label}</span>
      {right ? null : <Icon name="more" size={20} />}
    </div>
  );
}
