"use client";

import { ChangeEvent, InputHTMLAttributes, useId, useRef, useState } from "react";
import { formatForField, parseTypedDate } from "@/lib/domain/dates";
import { todayISO } from "@/lib/domain/recurrence";
import { useI18n } from "@/lib/i18n";

/**
 * A date field you can type into and still pick from a calendar.
 *
 * The box is text: "17", "17 oct", "17 eki", "17.10", "2026-10-17", "dün" —
 * read by parseTypedDate (lib/domain/dates.ts), with what isn't typed taken
 * from the date already there. While typing, the date it understood shows at
 * the right; a typed date that can't be read, or falls outside min/max, keeps
 * the form from submitting and says why. Off the field it shows "17 Oct 2026".
 *
 * The calendar button opens the browser's own picker through a hidden native
 * date input, so phones still get their wheel or calendar.
 *
 * It speaks the native field's language: `value` and `onChange(e)` carry
 * yyyy-mm-dd ("" when cleared), so every form keeps reading e.target.value.
 */
export function DateInput({
  value,
  onChange,
  min,
  max,
  required,
  disabled,
  className = "",
  id,
  ...rest
}: InputHTMLAttributes<HTMLInputElement>) {
  const { t, locale } = useI18n();
  const iso = typeof value === "string" ? value : "";
  const [typed, setTyped] = useState<string | null>(null);
  const native = useRef<HTMLInputElement>(null);
  const hintId = useId();

  const emit = (next: string) => {
    onChange?.({ target: { value: next }, currentTarget: { value: next } } as unknown as ChangeEvent<HTMLInputElement>);
  };

  const today = todayISO();
  const base = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : today;
  const parsed = typed == null ? null : parseTypedDate(typed, base, today);
  const minIso = typeof min === "string" ? min : undefined;
  const maxIso = typeof max === "string" ? max : undefined;
  const outOfRange = parsed != null && ((minIso != null && parsed < minIso) || (maxIso != null && parsed > maxIso));
  const unreadable = typed != null && typed.trim() !== "" && parsed == null;
  const problem = unreadable ? t("common.notADate") : outOfRange ? t("common.dateOutOfRange") : "";
  const shown = typed ?? formatForField(iso, locale);
  // what was understood, while it differs from what's in the box
  const preview = typed != null && parsed != null && !outOfRange && formatForField(parsed, locale) !== typed.trim() ? formatForField(parsed, locale) : null;

  return (
    <span className={`relative block min-w-[9.5rem] ${className.includes("w-") ? "" : "w-full"}`}>
      <input
        {...rest}
        id={id}
        type="text"
        inputMode="text"
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="done"
        data-date-input
        disabled={disabled}
        required={required}
        value={shown}
        placeholder={t("common.datePlaceholder")}
        aria-invalid={problem ? true : undefined}
        aria-describedby={problem || preview ? hintId : undefined}
        ref={(el) => {
          // the form won't submit while the typed text isn't a usable date
          el?.setCustomValidity(problem);
        }}
        onChange={(e) => {
          const text = e.target.value;
          setTyped(text);
          if (text.trim() === "") {
            emit("");
            return;
          }
          const next = parseTypedDate(text, base, today);
          const inRange = next != null && !((minIso != null && next < minIso) || (maxIso != null && next > maxIso));
          if (next && inRange && next !== iso) emit(next);
        }}
        onFocus={(e) => {
          rest.onFocus?.(e);
          // start from the shown text, selected, so typing replaces it
          setTyped(formatForField(iso, locale));
          queueMicrotask(() => e.target.select());
        }}
        onBlur={(e) => {
          rest.onBlur?.(e);
          // a readable date settles into its usual form; anything else stays for fixing
          if (!problem) setTyped(null);
        }}
        className={`w-full rounded-lg border bg-[var(--field)] py-2 pl-3 pr-10 text-sm tabular-nums text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-1 dark:text-zinc-100 ${
          problem
            ? "border-red-500 focus:border-red-500 focus:ring-red-500"
            : "border-[var(--edge)] focus:border-teal-500 focus:ring-teal-500"
        } ${className}`}
      />
      {preview ? (
        <span
          id={hintId}
          aria-live="polite"
          className="pointer-events-none absolute right-10 top-1/2 -translate-y-1/2 rounded bg-[var(--edge-soft)] px-1.5 py-0.5 text-xs text-zinc-500 dark:text-zinc-400"
        >
          {preview}
        </span>
      ) : problem ? (
        <span id={hintId} className="sr-only" aria-live="polite">
          {problem}
        </span>
      ) : null}
      <button
        type="button"
        disabled={disabled}
        aria-label={t("common.openCalendar")}
        title={t("common.openCalendar")}
        onClick={() => {
          const el = native.current;
          if (!el) return;
          try {
            el.showPicker();
          } catch {
            el.focus();
            el.click();
          }
        }}
        className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-zinc-500 hover:bg-[var(--edge-soft)] hover:text-zinc-700 disabled:opacity-40 dark:text-zinc-400 dark:hover:text-zinc-200"
      >
        <svg aria-hidden width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 6h16v14H4zM4 10h16M8 3v4M16 3v4" />
        </svg>
      </button>
      {/* the browser's own picker, opened by the button above */}
      <input
        ref={native}
        type="date"
        tabIndex={-1}
        aria-hidden
        value={iso}
        min={minIso}
        max={maxIso}
        onChange={(e) => {
          setTyped(null);
          emit(e.target.value);
        }}
        className="pointer-events-none absolute bottom-0 right-0 h-px w-px opacity-0"
      />
    </span>
  );
}
