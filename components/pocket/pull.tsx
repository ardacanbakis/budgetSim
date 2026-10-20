"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { PULL_IDLE, PULL_THRESHOLD, PullEvent, PullPhase, pullReducer } from "@/lib/ui/pocket/pull";
import { Icon } from "./icons";

/** the spinner stays at least this long, so a quick refresh doesn't just flash */
const MIN_SPIN_MS = 400;
/** how long "Up to date" stays in the live region */
const SAID_MS = 3000;

/**
 * Pull-to-refresh for the whole of Pocket: pull down from the top of any
 * screen and every query is fetched again, rates included. The gesture is
 * lib/ui/pocket/pull.ts; this feeds it the window's touches and draws the
 * indicator under the header. Mount it once, in the shell.
 *
 * - a page that isn't at the top, or any sheet or dialog open (the quick
 *   jump too), never pulls; a sideways or upward drag lets go at once;
 * - the indicator follows the finger with direct style writes (no render
 *   per move); with reduced motion it doesn't spin or glide back;
 * - "Refreshing…" and then "Up to date" are said through a polite live region.
 */
export function PullToRefresh() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const state = useRef(PULL_IDLE);
  const indicator = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<PullPhase>("idle");
  const [said, setSaid] = useState("");
  // the latest t, so a change of language doesn't re-attach mid-refresh
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  useEffect(() => {
    let alive = true;
    let sayTimer: ReturnType<typeof setTimeout> | null = null;
    const draw = (distance: number, following: boolean) => {
      const el = indicator.current;
      if (!el) return;
      // while the finger moves, no transition; afterwards, the class's (when motion is welcome)
      el.style.transition = following ? "none" : "";
      el.style.transform = `translate(-50%, ${distance - 48}px)`;
      el.style.opacity = String(Math.min(1, distance / PULL_THRESHOLD));
      const icon = el.firstElementChild as HTMLElement | null;
      if (icon && following) icon.style.transform = `rotate(${(distance / PULL_THRESHOLD) * 270}deg)`;
    };

    const refresh = async () => {
      setSaid(tRef.current("pocket.refreshing"));
      try {
        await Promise.all([queryClient.invalidateQueries(), new Promise((r) => setTimeout(r, MIN_SPIN_MS))]);
      } catch {
        // a failed refetch shows its own error; the indicator still goes away
      }
      if (!alive) return;
      dispatch({ type: "done" });
      setSaid(tRef.current("pocket.refreshed"));
      sayTimer = setTimeout(() => setSaid(""), SAID_MS);
    };

    const dispatch = (event: PullEvent) => {
      const before = state.current;
      const next = pullReducer(before, event);
      if (next === before) return;
      state.current = next;
      const moving = next.phase === "pulling" || next.phase === "armed";
      if (moving || next.phase !== before.phase) draw(next.distance, moving);
      if (next.phase !== before.phase) {
        setPhase(next.phase);
        if (next.phase === "armed") navigator.vibrate?.(8);
        if (next.phase === "refreshing") void refresh();
      }
    };

    const onStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (!touch) return;
      dispatch({
        type: "start",
        x: touch.clientX,
        y: touch.clientY,
        scrollY: window.scrollY,
        // a sheet, the quick jump or any other modal owns the touch
        blocked: document.querySelector("[data-pocket-sheet-root], [aria-modal='true']") != null,
        touches: e.touches.length,
      });
    };
    const onMove = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (touch) dispatch({ type: "move", x: touch.clientX, y: touch.clientY, touches: e.touches.length });
    };
    const onEnd = () => dispatch({ type: "end" });
    const onCancel = () => dispatch({ type: "cancel" });

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onCancel);
    return () => {
      alive = false;
      if (sayTimer) clearTimeout(sayTimer);
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onCancel);
    };
  }, [queryClient]);

  const armed = phase === "armed" || phase === "refreshing";
  return (
    <>
      <div
        ref={indicator}
        aria-hidden
        data-pull-indicator={phase}
        className="no-print pointer-events-none fixed left-1/2 top-[var(--pocket-top,44px)] z-30 flex h-9 w-9 items-center justify-center rounded-full border border-[var(--edge)] bg-[var(--surface)] opacity-0 shadow-md motion-safe:transition-[transform,opacity] motion-safe:duration-200"
        style={{ transform: "translate(-50%, -48px)" }}
      >
        <span className={`flex ${armed ? "text-teal-600 dark:text-teal-400" : "text-zinc-400"}`}>
          <Icon name="refresh" size={18} className={phase === "refreshing" ? "motion-safe:animate-spin" : undefined} />
        </span>
      </div>
      <div role="status" aria-live="polite" className="sr-only" data-pull-status>
        {phase === "armed" ? t("pocket.releaseToRefresh") : said}
      </div>
    </>
  );
}
