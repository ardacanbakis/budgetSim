"use client";

import { useEffect, useRef } from "react";
import { useI18n } from "@/lib/i18n";
import { decimalMark, KeypadKey, Op } from "@/lib/ui/pocket/keypad";

/**
 * The add sheet's 4×4 calculator keypad. Every key is a real button with a
 * spoken name; the decimal key shows the locale's mark and sends "." (the
 * expression stores one mark whatever the language). Holding ⌫ clears, a
 * shortcut for tapping it repeatedly. A hardware keyboard works too while
 * focus isn't in a text field.
 */

const LONG_PRESS_MS = 450;

const OP_LABEL: Record<Op, string> = {
  "÷": "pocket.add.keyDivide",
  "×": "pocket.add.keyMultiply",
  "−": "pocket.add.keyMinus",
  "+": "pocket.add.keyPlus",
};

const LAYOUT: KeypadKey[] = ["7", "8", "9", "÷", "4", "5", "6", "×", "1", "2", "3", "−", ".", "0", "back", "+"];

const HARDWARE: Record<string, KeypadKey> = {
  "+": "+",
  "-": "−",
  "*": "×",
  x: "×",
  "/": "÷",
  ".": ".",
  ",": ".",
  Backspace: "back",
  Delete: "clear",
};

function BackspaceGlyph() {
  return (
    <svg
      aria-hidden
      width={26}
      height={26}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 5H9l-6 7 6 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1zM17 9l-6 6M11 9l6 6" />
    </svg>
  );
}

export function Keypad({ onKey, keyboard = true }: { onKey: (key: KeypadKey) => void; keyboard?: boolean }) {
  const { t, locale } = useI18n();
  const hold = useRef<{ timer: ReturnType<typeof setTimeout> | null; fired: boolean }>({ timer: null, fired: false });

  // the latest handler, so the keyboard listener isn't re-added per keystroke
  const send = useRef(onKey);
  useEffect(() => {
    send.current = onKey;
  }, [onKey]);

  useEffect(() => {
    if (!keyboard) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;
      const key: KeypadKey | undefined = /^\d$/.test(e.key) ? (e.key as KeypadKey) : HARDWARE[e.key];
      if (!key) return;
      e.preventDefault();
      send.current(key);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [keyboard]);

  const stopHold = () => {
    if (hold.current.timer) clearTimeout(hold.current.timer);
    hold.current.timer = null;
  };

  return (
    <div className="grid grid-cols-4 gap-1.5" data-pocket-keypad>
      {LAYOUT.map((key) => {
        const isOp = key === "÷" || key === "×" || key === "−" || key === "+";
        const label =
          key === "back"
            ? t("pocket.add.keyBackspace")
            : key === "."
              ? t("pocket.add.keyDecimal")
              : isOp
                ? t(OP_LABEL[key as Op])
                : key;
        const holdHandlers =
          key === "back"
            ? {
                onPointerDown: () => {
                  hold.current.fired = false;
                  stopHold();
                  hold.current.timer = setTimeout(() => {
                    hold.current.fired = true;
                    navigator.vibrate?.(10);
                    send.current("clear");
                  }, LONG_PRESS_MS);
                },
                onPointerUp: stopHold,
                onPointerLeave: stopHold,
                onPointerCancel: stopHold,
                onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
              }
            : {};
        return (
          <button
            key={key}
            type="button"
            aria-label={label}
            onClick={() => {
              if (key === "back" && hold.current.fired) {
                hold.current.fired = false;
                return;
              }
              onKey(key);
            }}
            {...holdHandlers}
            className={`flex min-h-[52px] select-none items-center justify-center rounded-xl bg-[var(--edge-soft)] text-2xl tabular-nums transition-transform duration-75 [touch-action:manipulation] active:scale-95 active:bg-[var(--edge)] ${
              isOp ? "font-medium text-teal-700 dark:text-teal-300" : "font-normal"
            }`}
          >
            {key === "back" ? <BackspaceGlyph /> : key === "." ? decimalMark(locale) : key}
          </button>
        );
      })}
    </div>
  );
}
