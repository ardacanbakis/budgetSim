"use client";

import { CSSProperties, ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import { CardSize, cardHeightPx } from "@/lib/ui/plannerCards";
import { usePocket } from "@/lib/ui/usePocket";
import { useI18n } from "@/lib/i18n";

/**
 * The one frame every card on the Plan page sits in — Forecast, Evim sistemi
 * and the loan simulator alike:
 * - a header of one fixed height: the title (a real heading), an optional
 *   one-line hint under it, and the card's own actions on the right;
 * - an optional toolbar under it that stays put while the body scrolls (the
 *   projections' horizon slider);
 * - the body, with the same padding in every card;
 * - a footer for actions and links, shared with the Show all button.
 *
 * With a `size` (lib/ui/plannerCards.ts) the card is that tall whatever it
 * holds: content that doesn't fit scrolls inside the body, a fade marks that
 * there's more, and Show all lets the card grow to its content. Without one
 * the card is as tall as its content (a form you fill in top to bottom).
 * `fill` is for the chart: the body has no padding and no scroll, and what's
 * in it fills the card.
 *
 * The layout rules — fixed heights, rows of equal cards, the custom canvas,
 * and Pocket, where nothing scrolls inside a card and the rest waits behind
 * Show all — live in app/globals.css under [data-plan-card].
 */
const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");

export function PlanCard({
  id,
  title,
  hint,
  actions,
  toolbar,
  footer,
  size,
  fill = false,
  className,
  children,
}: {
  /** names the card for the page and for tests: data-plan-card="<id>" */
  id: string;
  title: ReactNode;
  /** one line; anything longer is cut and shown in full on hover */
  hint?: string;
  actions?: ReactNode;
  toolbar?: ReactNode;
  footer?: ReactNode;
  size?: CardSize;
  fill?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const pocket = usePocket();
  const bodyId = useId();
  const body = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  // what the body holds against what it shows: whether there's more, and
  // whether you've scrolled to the end of it
  const [overflow, setOverflow] = useState({ more: false, atEnd: true });
  const capped = size != null && !fill;

  const measure = useCallback(() => {
    const el = body.current;
    if (!el || !capped) return;
    const more = el.scrollHeight > el.clientHeight + 1;
    const atEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
    setOverflow((prev) => (prev.more === more && prev.atEnd === atEnd ? prev : { more, atEnd }));
  }, [capped]);

  useEffect(() => {
    const el = body.current;
    if (!el || !capped) return;
    measure();
    // the body's own size and its content's both change what fits
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    for (const child of Array.from(el.children)) observer.observe(child);
    const mutations = new MutationObserver(() => {
      for (const child of Array.from(el.children)) observer.observe(child);
      measure();
    });
    mutations.observe(el, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      mutations.disconnect();
    };
  }, [capped, measure]);

  const canToggle = capped && (expanded || overflow.more);
  const titleText = typeof title === "string" ? title : undefined;

  return (
    <div
      data-plan-card={id}
      data-size={size}
      data-expanded={capped ? String(expanded) : undefined}
      style={size ? ({ "--card-h": `${cardHeightPx(size)}px` } as CSSProperties) : undefined}
      className={cx(
        "overflow-hidden border border-[var(--edge)] bg-[var(--surface)] shadow-sm",
        "rounded-[var(--ui-card-radius)] border-[length:var(--ui-card-border)]",
        className
      )}
    >
      <header
        data-plan-card-header
        className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-[var(--edge-soft)] px-[var(--ui-card-pad-x)]"
      >
        <div className="min-w-0 flex-1">
          <h2
            className="truncate text-[length:var(--ui-head-size)] leading-5 text-[color:var(--ui-head-color)]"
            style={{
              fontWeight: "var(--ui-head-weight)" as unknown as number,
              letterSpacing: "var(--ui-head-tracking)",
              textTransform: "var(--ui-head-transform)" as CSSProperties["textTransform"],
            }}
            title={titleText}
          >
            {title}
          </h2>
          {hint ? (
            <p className="truncate text-xs leading-4 text-zinc-500" title={hint}>
              {hint}
            </p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </header>

      {toolbar ? (
        <div data-plan-card-toolbar className="shrink-0 border-b border-[var(--edge-soft)] px-[var(--ui-card-pad-x)] py-3">
          {toolbar}
        </div>
      ) : null}

      <div data-plan-card-region className="relative">
        <div
          ref={body}
          id={bodyId}
          data-plan-card-body
          data-fill={fill ? "" : undefined}
          onScroll={measure}
          // on a phone the hidden rest isn't scrollable, so a field you tab
          // into down there opens the card rather than staying out of sight
          onFocus={() => {
            if (pocket && capped && !expanded && overflow.more) setExpanded(true);
          }}
          className={fill ? "p-2" : "px-[var(--ui-card-pad-x)] py-3"}
        >
          {children}
        </div>
        {capped && !expanded && overflow.more && !overflow.atEnd ? (
          <div
            aria-hidden
            data-plan-card-fade
            className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-[var(--surface)] to-transparent"
          />
        ) : null}
      </div>

      {footer || canToggle ? (
        <footer
          data-plan-card-footer
          className="flex min-h-11 shrink-0 items-center justify-between gap-3 border-t border-[var(--edge-soft)] px-[var(--ui-card-pad-x)] py-1.5 text-xs text-zinc-500"
        >
          <div className="min-w-0 flex-1">
            {/* a note keeps the footer to one line, like the header's hint */}
            {typeof footer === "string" ? (
              <p className="truncate" title={footer}>
                {footer}
              </p>
            ) : (
              footer
            )}
          </div>
          {canToggle ? (
            <button
              type="button"
              data-plan-card-toggle
              aria-expanded={expanded}
              aria-controls={bodyId}
              aria-label={
                titleText
                  ? t(expanded ? "planCards.showLessOf" : "planCards.showAllOf", { title: titleText })
                  : undefined
              }
              onClick={() => {
                setExpanded((v) => !v);
                // collapsing starts the body from the top again
                if (expanded && body.current) body.current.scrollTop = 0;
              }}
              className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-teal-700 hover:bg-[var(--edge-soft)] dark:text-teal-300"
            >
              {expanded ? t("planCards.showLess") : t("planCards.showAll")} {expanded ? "↑" : "↓"}
            </button>
          ) : null}
        </footer>
      ) : null}
    </div>
  );
}
