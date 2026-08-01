"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";

/**
 * How many columns a list page spreads its groups over. Device-local, per page:
 * a 34" screen wants three, a laptop wants one, and that's a property of the
 * screen you're sitting at rather than of the account.
 */
export type ColumnCount = 1 | 2 | 3;

export function useColumns(storageKey: string, initial: ColumnCount = 1) {
  const [columns, setColumns] = useState<ColumnCount>(initial);

  useEffect(() => {
    queueMicrotask(() => {
      const saved = Number(window.localStorage.getItem(storageKey));
      if (saved === 1 || saved === 2 || saved === 3) setColumns(saved);
    });
  }, [storageKey]);

  function update(next: ColumnCount) {
    setColumns(next);
    window.localStorage.setItem(storageKey, String(next));
  }

  return { columns, setColumns: update };
}

/** Tailwind can't see computed class names, so the variants are spelled out. */
export function columnClass(columns: ColumnCount): string {
  if (columns === 3) return "grid items-start gap-4 lg:grid-cols-2 2xl:grid-cols-3";
  if (columns === 2) return "grid items-start gap-4 xl:grid-cols-2";
  return "space-y-4";
}

export function ColumnsToggle({
  columns,
  onChange,
  max = 3,
}: {
  columns: ColumnCount;
  onChange: (next: ColumnCount) => void;
  max?: 2 | 3;
}) {
  const { t } = useI18n();
  const options: ColumnCount[] = max === 3 ? [1, 2, 3] : [1, 2];
  return (
    <div className="no-print hidden gap-1 rounded-lg bg-[var(--edge-soft)] p-1 lg:flex" role="group" aria-label={t("common.columns")}>
      {options.map((n) => (
        <button
          key={n}
          onClick={() => onChange(n)}
          aria-pressed={columns === n}
          title={t("common.columnsN", { count: n })}
          className={`rounded-md px-2.5 py-1 text-xs font-medium tabular-nums ${
            columns === n ? "bg-[var(--surface)] shadow-sm" : "text-zinc-500"
          }`}
        >
          {n}
        </button>
      ))}
    </div>
  );
}
