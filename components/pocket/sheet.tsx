"use client";

import { ReactNode, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/lib/i18n";
import { Icon, IconName } from "./icons";

/**
 * Pocket's bottom sheet. Every form in Pocket opens in one, including the
 * Classic modals (components/ui.tsx Modal hands itself to this on a Pocket
 * phone), so each gets the same handle, 44px close, keyboard inset and focus
 * handling without touching its markup.
 *
 * - the handle (a real button) toggles natural and full height; dragging the
 *   handle or header down closes past a quarter of the panel or a flick
 * - Escape closes; Tab stays inside; focus starts on [data-autofocus] or the
 *   title and goes back to whatever opened the sheet
 * - the page behind doesn't scroll while it's open
 * - the panel rides above the on-screen keyboard (visualViewport)
 */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** How far the on-screen keyboard covers the layout viewport, in px. */
function useKeyboardInset(active: boolean): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!active || !vv) return;
    const update = () => setInset(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    queueMicrotask(update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, [active]);
  return active ? inset : 0;
}

export function PocketSheet({
  open,
  onClose,
  title,
  children,
  footer,
  size = "auto",
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  /** pinned under the scrolling body: the sheet's main button(s) */
  footer?: ReactNode;
  /** "full" starts at full height (wide forms) */
  size?: "auto" | "full";
}) {
  const { t } = useI18n();
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);
  const drag = useRef<{ startY: number; startT: number; dy: number } | null>(null);
  const [full, setFull] = useState(size === "full");
  const keyboard = useKeyboardInset(open);

  // the latest onClose, without making it a dependency of the focus effect
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    root.style.overflow = "hidden";
    const el = panel.current;
    const first = el?.querySelector<HTMLElement>("[data-autofocus]") ?? el?.querySelector<HTMLElement>(`#${CSS.escape(titleId)}`);
    first?.focus({ preventScroll: true });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close.current();
        return;
      }
      if (e.key !== "Tab" || !el) return;
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null);
      if (items.length === 0) return;
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstItem) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && document.activeElement === lastItem) {
        e.preventDefault();
        firstItem.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      root.style.overflow = previousOverflow;
      const back = opener.current;
      if (back instanceof HTMLElement) back.focus({ preventScroll: true });
    };
  }, [open, titleId]);

  if (!open || typeof document === "undefined") return null;

  // drag to dismiss: direct style writes, no re-render per pointer move
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    drag.current = { startY: e.clientY, startT: e.timeStamp, dy: 0 };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !panel.current) return;
    d.dy = Math.max(0, e.clientY - d.startY);
    panel.current.style.transition = "none";
    panel.current.style.transform = `translateY(${d.dy}px)`;
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    const el = panel.current;
    if (!d || !el) return;
    const velocity = d.dy / Math.max(1, e.timeStamp - d.startT);
    el.style.transition = "transform 300ms var(--pocket-ease, ease-out)";
    if (d.dy > el.offsetHeight * 0.25 || (d.dy > 24 && velocity > 0.4)) {
      el.style.transform = "translateY(100%)";
      setTimeout(() => close.current(), 180);
    } else {
      el.style.transform = "";
    }
  };
  const dragHandlers = { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp };

  return createPortal(
    <div className="fixed inset-0 z-50" data-pocket-sheet-root>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-pocket-sheet
        className="absolute inset-x-0 flex flex-col rounded-t-[var(--pocket-sheet-radius,1rem)] bg-[var(--surface)] shadow-xl"
        style={{
          bottom: keyboard,
          maxHeight: `calc(100dvh - env(safe-area-inset-top) - 8px - ${keyboard}px)`,
          height: full ? `calc(100dvh - env(safe-area-inset-top) - 8px - ${keyboard}px)` : undefined,
          overscrollBehavior: "contain",
        }}
      >
        <button
          type="button"
          aria-label={t("pocket.resize")}
          onClick={() => setFull((f) => !f)}
          className="flex h-6 w-full shrink-0 touch-none items-center justify-center"
          {...dragHandlers}
        >
          <span aria-hidden className="h-[5px] w-9 rounded-full bg-[var(--edge)]" />
        </button>
        <div className="flex h-12 shrink-0 touch-none items-center gap-2 pl-4 pr-1" {...dragHandlers}>
          <h2 id={titleId} tabIndex={-1} className="min-w-0 flex-1 truncate text-base font-semibold outline-none">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="flex h-11 w-11 items-center justify-center rounded-full text-zinc-500 active:bg-[var(--edge-soft)]"
          >
            <Icon name="close" size={20} />
          </button>
        </div>
        <div data-pocket-sheet-body className="min-h-0 flex-1 overflow-y-auto px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          {children}
        </div>
        {footer ? (
          <div className="shrink-0 border-t border-[var(--edge-soft)] px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3">{footer}</div>
        ) : null}
      </div>
    </div>,
    document.body
  );
}

export interface ActionItem {
  label: ReactNode;
  onSelect: () => void;
  icon?: IconName;
  /** a line under the label */
  hint?: ReactNode;
  /** primary: the usual choice, first; danger: last, armed by a first tap */
  tone?: "primary" | "danger";
  disabled?: boolean;
}

/**
 * A list of actions in a sheet: the usual one first, a destructive one last
 * and red, which needs a second tap within four seconds (never a browser
 * confirm). Cancel sits apart.
 */
export function PocketActionSheet({
  open,
  onClose,
  title,
  summary,
  items,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  summary?: ReactNode;
  items: ActionItem[];
}) {
  const { t } = useI18n();
  const [armed, setArmed] = useState<number | null>(null);

  useEffect(() => {
    if (armed == null) return;
    const timer = setTimeout(() => setArmed(null), 4000);
    return () => clearTimeout(timer);
  }, [armed]);

  return (
    <PocketSheet open={open} onClose={onClose} title={title}>
      {summary ? <div className="pb-3">{summary}</div> : null}
      <ul className="divide-y divide-[var(--edge-soft)] overflow-hidden rounded-[var(--ui-card-radius)] border border-[var(--edge)]">
        {items.map((item, i) => {
          const danger = item.tone === "danger";
          const isArmed = armed === i;
          return (
            <li key={i}>
              <button
                type="button"
                disabled={item.disabled}
                onClick={() => {
                  if (danger && !isArmed) {
                    setArmed(i);
                    return;
                  }
                  setArmed(null);
                  item.onSelect();
                }}
                className={`flex min-h-[56px] w-full items-center gap-3 px-4 py-2 text-left active:bg-[var(--edge-soft)] disabled:opacity-50 ${
                  danger
                    ? "text-red-600 dark:text-red-400"
                    : item.tone === "primary"
                      ? "font-semibold text-teal-700 dark:text-teal-300"
                      : ""
                }`}
              >
                {item.icon ? <Icon name={item.icon} size={20} className="shrink-0 opacity-80" /> : null}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px]">{isArmed ? t("pocket.tapAgain") : item.label}</span>
                  {item.hint && !isArmed ? <span className="block truncate text-xs text-zinc-500">{item.hint}</span> : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        onClick={onClose}
        className="mt-3 flex min-h-[52px] w-full items-center justify-center rounded-[var(--ui-card-radius)] border border-[var(--edge)] text-[15px] font-medium active:bg-[var(--edge-soft)]"
      >
        {t("common.cancel")}
      </button>
    </PocketSheet>
  );
}
