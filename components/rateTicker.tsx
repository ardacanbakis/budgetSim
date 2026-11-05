"use client";

import { useEffect, useRef, useState } from "react";
import { useRates } from "@/lib/data/queries";
import { isStaleTable } from "@/lib/rates/fallback";
import { buildTickerItems, formatTickerValue, TickerItem } from "@/lib/domain/ticker";
import { useI18n } from "@/lib/i18n";
import { coast, tickerCopies, wrapOffset } from "@/lib/ui/tickerLoop";

/** How fast the tape runs on its own, in pixels a second. */
const SPEED = 40;
/** How long it waits after you let go before running on its own again. */
const RESUME_MS = 1500;
/** The fastest a fling can throw it, in pixels a second. */
const MAX_FLING = 4000;
/** How far an arrow key moves it, in pixels. */
const KEY_STEP = 120;

/**
 * Scrolling market-rate tape, the way finance channels run one: USD/TRY,
 * EUR/TRY, EUR/USD, BTC and gram gold with their 24h move. Opt-in from
 * Settings → Preferences, on Standard's header and under Pocket's.
 *
 * The quotes are one set, repeated as many times as it takes to fill the
 * width (lib/ui/tickerLoop.ts), so the tape runs edge to edge in an endless
 * loop however wide the screen and however few the quotes. It runs on its
 * own, pauses under the mouse, and can be pulled either way: with the mouse
 * held down, or a finger (a vertical swipe still scrolls the page). Let go
 * and it coasts, then carries on by itself. The arrow keys move it too.
 * With reduced motion it only moves when you move it. Only the first set is
 * read out; the repeats are aria-hidden.
 */
export function RateTicker() {
  const { locale, t } = useI18n();
  const rates = useRates();
  const viewport = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const firstSet = useRef<HTMLDivElement>(null);
  const [copies, setCopies] = useState(2);
  const [grabbing, setGrabbing] = useState(false);
  // what moves every frame lives outside React, so a frame never re-renders
  const motion = useRef({
    offset: 0,
    set: 0,
    hover: false,
    drag: null as null | { x: number; time: number },
    velocity: 0,
    resumeAt: 0,
  });

  const items = rates.data ? buildTickerItems(rates.data.usdPer, rates.data.prevUsdPer) : [];
  const hasItems = items.length > 0;

  // one set's width, and how many sets it takes to fill the tape
  useEffect(() => {
    const view = viewport.current;
    const set = firstSet.current;
    if (!view || !set) return;
    const measure = () => {
      motion.current.set = set.offsetWidth;
      setCopies(tickerCopies(view.clientWidth, set.offsetWidth));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(view);
    observer.observe(set);
    return () => observer.disconnect();
  }, [hasItems]);

  // the loop: on its own, coasting after a fling, or still while held
  useEffect(() => {
    if (!hasItems) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const m = motion.current;
      const seconds = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (!m.drag) {
        if (m.velocity !== 0) {
          m.offset += m.velocity * seconds;
          m.velocity = coast(m.velocity, seconds);
        } else if (!m.hover && !reduced.matches && now >= m.resumeAt) {
          m.offset += SPEED * seconds;
        }
      }
      m.offset = wrapOffset(m.offset, m.set);
      if (track.current) track.current.style.transform = `translate3d(${-m.offset}px, 0, 0)`;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [hasItems]);

  if (!rates.data || !hasItems) return null;
  const stale = isStaleTable(rates.data);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    motion.current.drag = { x: e.clientX, time: e.timeStamp };
    motion.current.velocity = 0;
    setGrabbing(true);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const m = motion.current;
    if (!m.drag) return;
    const dx = e.clientX - m.drag.x;
    const dt = Math.max(1, e.timeStamp - m.drag.time) / 1000;
    // pulling right brings what's gone by back into view
    m.offset -= dx;
    const v = Math.max(-MAX_FLING, Math.min(MAX_FLING, -dx / dt));
    m.velocity = m.velocity * 0.6 + v * 0.4;
    m.drag = { x: e.clientX, time: e.timeStamp };
  };
  const onPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    const m = motion.current;
    if (!m.drag) return;
    // held still before letting go: no fling
    if (e.timeStamp - m.drag.time > 80) m.velocity = 0;
    m.drag = null;
    m.resumeAt = performance.now() + RESUME_MS;
    setGrabbing(false);
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const m = motion.current;
    m.offset += e.key === "ArrowRight" ? KEY_STEP : -KEY_STEP;
    m.velocity = 0;
    m.resumeAt = performance.now() + RESUME_MS;
  };

  return (
    <div
      className="no-print relative flex items-center overflow-hidden border-b border-[var(--edge)] bg-[var(--surface)] py-1.5"
      role="marquee"
      aria-label={t("settings.rateTicker")}
    >
      <span className="z-10 shrink-0 border-r border-[var(--edge)] bg-[var(--surface)] px-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
        {stale ? t("common.stale") : t("settings.rateTickerLive")}
      </span>
      <div
        ref={viewport}
        data-ticker
        tabIndex={0}
        className={`min-w-0 flex-1 select-none overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-500 ${
          grabbing ? "cursor-grabbing" : "cursor-grab"
        }`}
        // horizontal pulls are the tape's; a vertical swipe still scrolls the page
        style={{ touchAction: "pan-y" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onPointerEnter={(e) => {
          if (e.pointerType === "mouse") motion.current.hover = true;
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse") motion.current.hover = false;
        }}
        onKeyDown={onKeyDown}
      >
        <div ref={track} data-ticker-track className="flex w-max will-change-transform">
          {Array.from({ length: copies }, (_, copy) => (
            <div key={copy} ref={copy === 0 ? firstSet : undefined} className="flex shrink-0 gap-6 pl-6" aria-hidden={copy > 0 || undefined}>
              {items.map((item) => (
                <Quote key={`${copy}-${item.id}`} item={item} locale={locale} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Quote({ item, locale }: { item: TickerItem; locale: string }) {
  const up = item.changePct != null && item.changePct > 0;
  const down = item.changePct != null && item.changePct < 0;
  return (
    <span className="flex items-baseline gap-1.5 whitespace-nowrap text-xs">
      <span className="font-medium text-zinc-500">{item.label}</span>
      <span className="font-semibold tabular-nums">{formatTickerValue(item, locale)}</span>
      {item.changePct != null ? (
        <span className={`tabular-nums ${up ? "text-green-600" : down ? "text-red-600" : "text-zinc-400"}`}>
          {up ? "▲" : down ? "▼" : "▬"} {Math.abs(item.changePct).toFixed(2)}%
        </span>
      ) : null}
    </span>
  );
}
