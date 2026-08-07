"use client";

import {
  ReactNode,
  SelectHTMLAttributes,
  InputHTMLAttributes,
  TextareaHTMLAttributes,
  ButtonHTMLAttributes,
  FormEvent,
  useEffect,
  useRef,
} from "react";

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/**
 * Shared surfaces read their shape from the --ui-* tokens in globals.css, so a
 * skin can turn a soft rounded box into a hairline rule without any component
 * knowing which skin is on. Colour still comes from the theme; only form is
 * skin-owned.
 */
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cx(
        "border border-[var(--edge)] bg-[var(--surface)] shadow-sm",
        "rounded-[var(--ui-card-radius)] border-[length:var(--ui-card-border)]",
        className
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({ title, action }: { title: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-[var(--edge-soft)] px-[var(--ui-card-pad-x)] py-[var(--ui-card-pad-y)]">
      <h2
        className="text-[length:var(--ui-head-size)] text-[color:var(--ui-head-color)]"
        style={{
          fontWeight: "var(--ui-head-weight)" as unknown as number,
          letterSpacing: "var(--ui-head-tracking)",
          textTransform: "var(--ui-head-transform)" as React.CSSProperties["textTransform"],
        }}
      >
        {title}
      </h2>
      {action}
    </div>
  );
}

/**
 * A headline number. Skins disagree about how loud these should be — Terminal
 * sets them in mono at the same weight as the rest, Editorial makes them the
 * biggest thing on screen — so size comes from the caller and family, tracking
 * and numerals come from the skin.
 */
export function Figure({
  children,
  size = "md",
  tone,
  className,
}: {
  children: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  tone?: "pos" | "neg";
  className?: string;
}) {
  const sizes = {
    sm: "text-base",
    md: "text-xl",
    lg: "text-3xl",
    xl: "text-4xl sm:text-5xl",
  } as const;
  return (
    <span
      data-figure={size}
      className={cx(
        "font-semibold tnum",
        sizes[size],
        tone === "pos" && "money-pos",
        tone === "neg" && "money-neg",
        className
      )}
      style={{
        fontFamily: "var(--ui-figure-family)",
        letterSpacing: "var(--ui-figure-tracking)",
      }}
    >
      {children}
    </span>
  );
}

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

export function Button({
  variant = "secondary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  const styles: Record<ButtonVariant, string> = {
    primary:
      "bg-teal-600 text-white hover:bg-teal-700 disabled:bg-teal-600/50 dark:bg-teal-500 dark:hover:bg-teal-400 dark:text-zinc-950",
    secondary:
      "border border-[var(--edge)] bg-[var(--surface)] text-zinc-700 hover:brightness-95 dark:text-zinc-200 dark:hover:brightness-125",
    danger: "bg-red-600 text-white hover:bg-red-700 disabled:bg-red-600/50",
    ghost: "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200",
  };
  return (
    <button
      {...props}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60",
        styles[variant],
        className
      )}
    />
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cx(
        "w-full rounded-lg border border-[var(--edge)] bg-[var(--field)] px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500 dark:text-zinc-100",
        props.type === "number" && "tnum",
        props.className
      )}
    />
  );
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cx(
        "w-full rounded-lg border border-[var(--edge)] bg-[var(--field)] px-3 py-2 font-mono text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500 dark:text-zinc-100",
        props.className
      )}
    />
  );
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cx(
        "w-full rounded-lg border border-[var(--edge)] bg-[var(--field)] px-3 py-2 text-sm text-zinc-900 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500 dark:text-zinc-100",
        props.className
      )}
    />
  );
}

export function Field({
  label,
  children,
  hint,
  error,
}: {
  label: ReactNode;
  children: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{label}</span>
      {children}
      {error ? (
        <span className="block text-xs font-medium text-red-600 dark:text-red-400">{error}</span>
      ) : hint ? (
        <span className="block text-xs text-zinc-400 dark:text-zinc-500">{hint}</span>
      ) : null}
    </label>
  );
}

export function Badge({
  children,
  tone = "zinc",
}: {
  children: ReactNode;
  tone?: "zinc" | "green" | "amber" | "red" | "sky";
}) {
  const tones = {
    zinc: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
    green: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
    amber: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
    red: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
    sky: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
  } as const;
  return (
    <span className={cx("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", tones[tone])}>
      {children}
    </span>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  wide?: boolean;
  /** when given, the body becomes a form so Enter saves from any field */
  onSubmit?: (e: FormEvent<HTMLFormElement>) => void;
}) {
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Land the caret in the first field rather than making you reach for it —
  // but only where there's a real pointer. On a phone this would throw the
  // keyboard up over the dialog before you've read it.
  useEffect(() => {
    if (!open) return;
    if (!window.matchMedia("(pointer: fine)").matches) return;
    const first = body.current?.querySelector<HTMLElement>(
      "input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled])"
    );
    first?.focus();
  }, [open]);

  if (!open) return null;
  const content = onSubmit ? <form onSubmit={onSubmit}>{children}</form> : children;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        ref={body}
        className={cx(
          "max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl bg-[var(--surface)] p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-xl sm:rounded-2xl sm:pb-4",
          wide ? "sm:max-w-2xl" : "sm:max-w-md"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{title}</h3>
          <button onClick={onClose} className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800" aria-label="Close">
            ✕
          </button>
        </div>
        {content}
      </div>
    </div>
  );
}

export function EmptyState({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-zinc-300 px-4 py-10 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
      <div>{children}</div>
      {action}
    </div>
  );
}

export function Spinner() {
  return (
    <div className="flex justify-center py-16">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-300 border-t-teal-600" />
    </div>
  );
}

/**
 * Placeholder rows that keep the page the same height while it loads, so
 * nothing jumps under the cursor when the data lands.
 */
export function Skeleton({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={cx("space-y-2", className)} aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="h-4 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800"
          style={{ width: `${100 - (i % 3) * 12}%` }}
        />
      ))}
    </div>
  );
}
