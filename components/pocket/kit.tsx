"use client";

import Link from "next/link";
import { KeyboardEvent, ReactNode, useRef } from "react";
import { Currency } from "@/lib/domain/currencies";
import { convert, UsdPerMap } from "@/lib/domain/fx";
import { useI18n } from "@/lib/i18n";
import { formatCompact, formatSigned, MoneySign } from "@/lib/ui/pocket/format";
import { HeaderBack, usePocketHeader } from "./chrome";
import { Icon } from "./icons";

/**
 * The parts every Pocket screen is built from. They use the app's own tokens
 * (--surface, --edge, the teal accent ramp, --ui-* through the skins), so a
 * Pocket screen follows the theme and the interface style like any other.
 */

/** A screen: its large title, registered with the header, then the content. */
export function PocketPage({
  title,
  condensed,
  back,
  action,
  children,
}: {
  title: string;
  condensed?: string;
  back?: HeaderBack | null;
  action?: ReactNode;
  children: ReactNode;
}) {
  usePocketHeader({ title, condensed, back, action });
  return (
    <div className="space-y-4">
      <h1 data-pocket-title className="pt-1 text-[1.75rem] font-bold leading-[2.125rem] tracking-[-0.02em]">
        {title}
      </h1>
      {children}
    </div>
  );
}

/** A figure in its own currency: signed before the symbol, never wrapping. */
export function Money({
  amount,
  currency,
  sign = "auto",
  tone,
  className = "",
}: {
  amount: number;
  currency: Currency;
  sign?: MoneySign;
  tone?: "pos" | "neg" | "auto";
  className?: string;
}) {
  const { locale } = useI18n();
  const resolved = tone === "auto" ? (amount < 0 || sign === "out" ? "neg" : sign === "in" ? "pos" : undefined) : tone;
  return (
    <span
      data-amount
      className={`whitespace-nowrap tabular-nums ${resolved === "pos" ? "money-pos" : resolved === "neg" ? "money-neg" : ""} ${className}`}
    >
      {formatSigned(amount, currency, locale, sign)}
    </span>
  );
}

/** "≈ $1.2K": the converted figure under a native one, only when they differ. */
export function Approx({
  amount,
  from,
  to,
  usdPer,
  className = "",
}: {
  amount: number;
  from: Currency;
  to: Currency;
  usdPer: UsdPerMap | undefined;
  className?: string;
}) {
  const { locale } = useI18n();
  if (from === to || !usdPer) return null;
  const converted = convert(amount, from, to, usdPer);
  if (converted == null) return null;
  return (
    <span data-amount className={`block whitespace-nowrap text-[11px] tabular-nums text-zinc-400 ${className}`}>
      ≈ {formatCompact(converted, to, locale)}
    </span>
  );
}

/** The one big number on a screen; shrinks with the viewport instead of wrapping. */
export function FitFigure({ children, tone }: { children: ReactNode; tone?: "pos" | "neg" }) {
  return (
    <span
      data-amount
      data-figure="xl"
      className={`block whitespace-nowrap font-bold tabular-nums leading-tight ${tone === "pos" ? "money-pos" : tone === "neg" ? "money-neg" : ""}`}
      style={{
        fontSize: "clamp(1.75rem, 10vw, 2.75rem)",
        fontFamily: "var(--ui-figure-family)",
        letterSpacing: "var(--ui-figure-tracking)",
      }}
    >
      {children}
    </span>
  );
}

/** A card-shaped group with an optional head: title left, one link or button right. */
export function Section({
  title,
  action,
  children,
  flush,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  /** rows reach the card's edges (lists) instead of sitting in padding */
  flush?: boolean;
}) {
  return (
    <section className="overflow-hidden rounded-[var(--ui-card-radius)] border border-[var(--edge)] bg-[var(--surface)]">
      {title || action ? (
        <div className="flex min-h-[44px] items-center justify-between gap-2 px-4 pt-1">
          {title ? (
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
          ) : (
            <span />
          )}
          {action}
        </div>
      ) : null}
      <div className={flush ? "" : "px-4 pb-3"}>{children}</div>
    </section>
  );
}

/** A segmented control: one choice out of a few, as pressed buttons. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: ReactNode }>;
  onChange: (v: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex rounded-[var(--pocket-chip-radius,9999px)] bg-[var(--edge-soft)] p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`min-h-[36px] flex-1 rounded-[var(--pocket-chip-radius,9999px)] px-3 text-[13px] font-medium transition-colors ${
            value === o.value ? "bg-[var(--surface)] shadow-sm" : "text-zinc-500 dark:text-zinc-400"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A row of filter chips that scrolls sideways, bleeding to the screen edges. */
export function ChipRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
      {children}
    </div>
  );
}

export function Chip({
  active,
  onClick,
  children,
  count,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  count?: number;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`relative flex h-8 shrink-0 items-center gap-1 whitespace-nowrap rounded-[var(--pocket-chip-radius,9999px)] border px-3 text-[13px] font-medium before:absolute before:-inset-y-1.5 before:inset-x-0 before:content-[''] ${
        active
          ? "border-transparent bg-teal-600 text-white dark:bg-teal-500 dark:text-zinc-950"
          : "border-[var(--edge)] bg-[var(--surface)] text-zinc-600 dark:text-zinc-300"
      }`}
    >
      {children}
      {count != null ? <span className="tabular-nums opacity-70">{count}</span> : null}
    </button>
  );
}

/**
 * A list row that is one target: leading avatar, title and meta, trailing
 * figure. Everything else about the row lives in the action sheet it opens.
 */
export function Row({
  leading,
  title,
  meta,
  trailing,
  onClick,
  href,
  chevron,
  dim,
  ariaLabel,
}: {
  leading?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
  onClick?: () => void;
  href?: string;
  chevron?: boolean;
  dim?: boolean;
  ariaLabel?: string;
}) {
  const body = (
    <>
      {leading ? <span className="shrink-0">{leading}</span> : null}
      <span className={`min-w-0 flex-1 ${dim ? "opacity-70" : ""}`}>
        <span className="block truncate text-[15px] font-medium">{title}</span>
        {meta ? <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">{meta}</span> : null}
      </span>
      {trailing ? <span className="shrink-0 text-right">{trailing}</span> : null}
      {chevron ? <Icon name="chevron" size={18} className="shrink-0 text-zinc-400" /> : null}
    </>
  );
  const cls =
    "flex min-h-[var(--pocket-row,56px)] w-full items-center gap-3 px-4 py-2 text-left active:bg-[var(--edge-soft)]";
  if (href) {
    return (
      <Link href={href} className={cls} aria-label={ariaLabel}>
        {body}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={cls} aria-label={ariaLabel}>
      {body}
    </button>
  );
}

/** A category's colour as a soft disc with its initial; neutral when there's none. */
export function Avatar({ color, label, icon }: { color?: string | null; label: string; icon?: ReactNode }) {
  const tint = color ?? "#71717a";
  return (
    <span
      aria-hidden
      className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold"
      style={{ background: `color-mix(in srgb, ${tint} 16%, var(--surface))`, color: tint }}
    >
      {icon ?? label.trim().charAt(0).toUpperCase()}
    </span>
  );
}

/** A dismissible note at the top of a screen. */
export function NoteCard({ children, onDismiss }: { children: ReactNode; onDismiss: () => void }) {
  const { t } = useI18n();
  return (
    <div className="flex items-start gap-2 rounded-[var(--ui-card-radius)] border border-[var(--edge)] bg-[var(--surface)] py-1 pl-4 pr-1 text-sm text-zinc-600 dark:text-zinc-300">
      <p className="flex-1 py-2.5">{children}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t("pocket.dismiss")}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-zinc-400 active:bg-[var(--edge-soft)]"
      >
        <Icon name="close" size={18} />
      </button>
    </div>
  );
}

/** The 44px switch's track; the whole row is the control. */
export function SwitchTrack({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors ${
        on ? "bg-teal-600 dark:bg-teal-500" : "bg-[var(--edge)]"
      }`}
    >
      <span
        className={`absolute h-6 w-6 rounded-full bg-white shadow transition-transform dark:bg-zinc-100 ${
          on ? "translate-x-[22px]" : "translate-x-0.5"
        }`}
      />
    </span>
  );
}

/**
 * One choice of a few as a radio group: the selected one checked, arrow keys
 * move and choose, as a segmented control should read to a screen reader.
 * Drawn like the kit's Segmented.
 */
export function SegmentRadios<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (i + step + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-[var(--pocket-chip-radius,9999px)] bg-[var(--edge-soft)] p-1">
      {options.map((o, i) => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKey(e, i)}
            className={`relative min-h-[36px] flex-1 rounded-[var(--pocket-chip-radius,9999px)] px-3 text-[13px] font-medium transition-colors before:absolute before:-inset-y-1 before:inset-x-0 before:content-[''] ${
              on ? "bg-[var(--surface)] shadow-sm" : "text-zinc-500 dark:text-zinc-400"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
