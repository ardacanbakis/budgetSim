"use client";

import { ReactNode } from "react";
import { Account } from "@/lib/data/types";
import { useI18n } from "@/lib/i18n";
import { ActivityChip, ActivityFilters } from "@/lib/ui/pocket/activityFilter";
import { Icon } from "./icons";
import { Chip, ChipRow } from "./kit";
import { PocketSheet } from "./sheet";

/**
 * Activity's filter bar: the search field, the chip row, and the sheet that
 * picks an account. State lives in the screen (components/pocket/activity.tsx);
 * the rules (which chips exclude which) are lib/ui/pocket/activityFilter.ts.
 *
 * - ActivitySearch: a 44px rounded field on --edge-soft, 16px text (no iOS
 *   zoom), a magnifier and a 44px clear button.
 * - ActivityChips: All accounts ▾ (opens the sheet, aria-haspopup=dialog),
 *   Planned, Overdue (n), Income, Expense (aria-pressed toggles with a ✕ when
 *   on), and the order. 32px chips with 44px hit areas, scrolling sideways.
 * - AccountSheet: a radio list of the accounts the ledger lists (not cards:
 *   nothing on a card is listed here, as in Classic).
 * - RowsSkeleton: placeholder rows while the ledger loads.
 */

const CHIP =
  "relative flex h-8 shrink-0 items-center gap-1 whitespace-nowrap rounded-[var(--pocket-chip-radius,9999px)] border px-3 text-[13px] font-medium before:absolute before:-inset-y-1.5 before:inset-x-0 before:content-['']";
const CHIP_ON = "border-transparent bg-teal-600 text-white dark:bg-teal-500 dark:text-zinc-950";
const CHIP_OFF = "border-[var(--edge)] bg-[var(--surface)] text-zinc-600 dark:text-zinc-300";

/** ⇅ and ▾, drawn like the icons in icons.tsx (that set is core-owned). */
function Glyph({ name, size = 14 }: { name: "sort" | "caret"; size?: number }) {
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={name === "sort" ? "M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4" : "m6 9 6 6 6-6"} />
    </svg>
  );
}

export function ActivitySearch({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { t } = useI18n();
  const label = t("pocket.activity.searchActivity");
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 dark:text-zinc-500">
        <Icon name="search" size={18} />
      </span>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        placeholder={label}
        enterKeyHint="search"
        autoComplete="off"
        className="h-11 w-full text-ellipsis rounded-full border border-transparent bg-[var(--edge-soft)] pl-10 pr-11 text-base text-zinc-900 placeholder:text-zinc-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500 dark:text-zinc-100 dark:placeholder:text-zinc-500 [&::-webkit-search-cancel-button]:hidden"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label={t("pocket.activity.clearSearch")}
          className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center rounded-full text-zinc-500 active:bg-[var(--edge)] dark:text-zinc-400"
        >
          <span aria-hidden className="flex h-5 w-5 items-center justify-center rounded-full bg-zinc-400 text-white dark:bg-zinc-500 dark:text-zinc-900">
            <Icon name="close" size={12} />
          </span>
        </button>
      ) : null}
    </div>
  );
}

/** A toggle chip from the kit, with the ✕ an active chip carries. */
function Toggle({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Chip active={active} onClick={onClick}>
      {children}
      {active ? <Icon name="close" size={14} className="-mr-1" /> : null}
    </Chip>
  );
}

export function ActivityChips({
  filters,
  accountName,
  overdueCount,
  onChip,
  onAccounts,
  onSort,
}: {
  filters: ActivityFilters;
  /** the account shown, or null for all of them */
  accountName: string | null;
  overdueCount: number;
  onChip: (chip: ActivityChip) => void;
  onAccounts: () => void;
  onSort: () => void;
}) {
  const { t } = useI18n();
  const accountLabel = accountName ?? t("pocket.activity.allAccounts");
  const order = filters.sort === "newest" ? t("portfolio.sortLatest") : t("portfolio.sortOldest");
  return (
    <ChipRow label={t("pocket.activity.filters")}>
      <button
        type="button"
        onClick={onAccounts}
        aria-haspopup="dialog"
        aria-label={`${t("tx.filterAccount")}: ${accountLabel}`}
        className={`${CHIP} ${accountName ? CHIP_ON : CHIP_OFF}`}
      >
        <span className="max-w-[10rem] truncate">{accountLabel}</span>
        <Glyph name="caret" />
      </button>
      <Toggle active={filters.planned} onClick={() => onChip("planned")}>
        {t("tx.planned")}
      </Toggle>
      <Toggle active={filters.overdue} onClick={() => onChip("overdue")}>
        {t("pocket.activity.overdueN", { count: overdueCount })}
      </Toggle>
      <Toggle active={filters.direction === "income"} onClick={() => onChip("income")}>
        {t("tx.income")}
      </Toggle>
      <Toggle active={filters.direction === "expense"} onClick={() => onChip("expense")}>
        {t("tx.expense")}
      </Toggle>
      <button
        type="button"
        onClick={onSort}
        aria-label={t("pocket.activity.sortBy", { order })}
        className={`${CHIP} ${CHIP_OFF}`}
      >
        {order}
        <Glyph name="sort" />
      </button>
    </ChipRow>
  );
}

export function AccountSheet({
  open,
  onClose,
  accounts,
  value,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  accounts: readonly Account[];
  value: string | null;
  onChange: (accountId: string | null) => void;
}) {
  const { t } = useI18n();
  // cards have their own page: nothing on them is listed here (as the Classic filter)
  const options: Array<{ id: string | null; name: string; meta?: string }> = [
    { id: null, name: t("pocket.activity.allAccounts") },
    ...accounts
      .filter((a) => a.kind !== "credit_card")
      .sort((a, b) => Number(a.archived) - Number(b.archived))
      .map((a) => ({ id: a.id, name: a.name, meta: a.currency === "XAU_G" ? "g" : a.currency })),
  ];
  return (
    <PocketSheet open={open} onClose={onClose} title={t("pocket.chooseAccount")}>
      <div
        role="radiogroup"
        aria-label={t("tx.filterAccount")}
        className="divide-y divide-[var(--edge-soft)] overflow-hidden rounded-[var(--ui-card-radius)] border border-[var(--edge)]"
      >
        {options.map((o) => {
          const checked = o.id === value;
          return (
            <button
              key={o.id ?? "all"}
              type="button"
              role="radio"
              aria-checked={checked}
              data-autofocus={checked ? "" : undefined}
              onClick={() => {
                onChange(o.id);
                onClose();
              }}
              className="flex min-h-[56px] w-full items-center gap-3 px-4 py-2 text-left active:bg-[var(--edge-soft)]"
            >
              <span className={`min-w-0 flex-1 truncate text-[15px] ${checked ? "font-semibold" : ""}`}>{o.name}</span>
              {o.meta ? <span className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400">{o.meta}</span> : null}
              <span className={`flex h-6 w-6 shrink-0 items-center justify-center ${checked ? "text-teal-600 dark:text-teal-400" : "text-transparent"}`}>
                <Icon name="check" size={18} />
              </span>
            </button>
          );
        })}
      </div>
    </PocketSheet>
  );
}

/** Row-shaped placeholders, so the page keeps its height while the ledger loads. */
export function RowsSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div
      aria-hidden
      className="divide-y divide-[var(--edge-soft)] overflow-hidden rounded-[var(--ui-card-radius)] border border-[var(--edge)] bg-[var(--surface)]"
    >
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex min-h-[var(--pocket-row-tx,60px)] items-center gap-3 px-4 py-2">
          <span className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-[var(--edge-soft)]" />
          <span className="min-w-0 flex-1 space-y-2">
            <span className="block h-3.5 animate-pulse rounded bg-[var(--edge-soft)]" style={{ width: `${70 - (i % 3) * 12}%` }} />
            <span className="block h-3 w-1/3 animate-pulse rounded bg-[var(--edge-soft)]" />
          </span>
          <span className="h-4 w-16 shrink-0 animate-pulse rounded bg-[var(--edge-soft)]" />
        </div>
      ))}
    </div>
  );
}
