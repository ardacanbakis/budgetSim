"use client";

import { ColumnCount } from "@/components/columns";
import { Shape, SurfaceId, SURFACE_SPECS } from "@/lib/ui/views";
import { useI18n } from "@/lib/i18n";

const SHAPE_ICON: Record<Shape, string> = { rows: "☰", grid: "▦", table: "▤" };

/**
 * The shape picker a screen carries in its own header.
 *
 * Icons plus an accessible name rather than words: it sits next to the page
 * title where horizontal room is scarce, and the three shapes are easier told
 * apart by silhouette than by reading "rows" and "table".
 */
export function ViewSwitcher({
  surface,
  shape,
  onShape,
  columns,
  onColumns,
}: {
  surface: SurfaceId;
  shape: Shape;
  onShape: (s: Shape) => void;
  columns?: ColumnCount;
  onColumns?: (n: ColumnCount) => void;
}) {
  const { t } = useI18n();
  const spec = SURFACE_SPECS[surface];
  // columns only mean something in a grid, so the control appears with it
  const showColumns = spec.columns && onColumns != null && shape === "grid";

  return (
    <div className="flex items-center gap-2">
      {showColumns ? (
        <div role="group" aria-label={t("views.gridColumns")} className="hidden rounded-lg border border-[var(--edge)] p-0.5 sm:flex">
          {([1, 2, 3] as ColumnCount[]).map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={columns === n}
              onClick={() => onColumns!(n)}
              className={`rounded-md px-2 py-1 text-xs tnum transition-colors ${
                columns === n
                  ? "bg-teal-600 text-white dark:bg-teal-500 dark:text-zinc-950"
                  : "text-zinc-500 hover:bg-[var(--edge-soft)]"
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      ) : null}
      <div role="group" aria-label={t("views.shape")} className="flex rounded-lg border border-[var(--edge)] p-0.5">
        {spec.shapes.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={shape === s}
            aria-label={t(`views.shape_${s}`)}
            title={t(`views.shape_${s}`)}
            onClick={() => onShape(s)}
            className={`rounded-md px-2 py-1 text-sm transition-colors ${
              shape === s
                ? "bg-teal-600 text-white dark:bg-teal-500 dark:text-zinc-950"
                : "text-zinc-500 hover:bg-[var(--edge-soft)]"
            }`}
          >
            <span aria-hidden>{SHAPE_ICON[s]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
