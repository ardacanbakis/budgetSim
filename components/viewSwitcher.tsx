"use client";

import { ColumnCount } from "@/components/columns";
import { Shape, SurfaceId, SURFACE_SPECS } from "@/lib/ui/views";
import { useI18n } from "@/lib/i18n";

const SHAPE_ICON: Record<Shape, string> = {
  rows: "☰",
  grid: "▦",
  table: "▤",
  matrix: "⊞",
  calendar: "▦",
  payoff: "⇣",
};

/** Beyond this many shapes, silhouettes stop telling them apart: they get names. */
const ICONS_UP_TO = 3;

/**
 * The shape picker a screen carries in its own header, and the pin that makes
 * the shape on screen that screen's default.
 *
 * Up to ICONS_UP_TO shapes it is icons plus an accessible name rather than
 * words: it sits next to the page title where horizontal room is scarce, and
 * three shapes are easier told apart by silhouette than by reading "rows" and
 * "table". Past that the shapes stop being forms of one list and start being
 * different questions — a matrix of the months ahead is not a "grid" — so
 * they are named in a menu instead, where the name is the whole point.
 *
 * The pin shows only once a screen has something worth pinning (more than
 * one shape) and reads as pressed while the shape on screen is the default.
 */
export function ViewSwitcher({
  surface,
  shape,
  onShape,
  columns,
  onColumns,
  isDefault,
  onSetDefault,
  onClearDefault,
}: {
  surface: SurfaceId;
  shape: Shape;
  onShape: (s: Shape) => void;
  columns?: ColumnCount;
  onColumns?: (n: ColumnCount) => void;
  /** the shape on screen is this screen's pinned default */
  isDefault?: boolean;
  onSetDefault?: () => void;
  onClearDefault?: () => void;
}) {
  const { t } = useI18n();
  const spec = SURFACE_SPECS[surface];
  // columns only mean something in a grid, so the control appears with it
  const showColumns = spec.columns && onColumns != null && shape === "grid";
  const pinnable = onSetDefault != null && onClearDefault != null && spec.shapes.length > 1;

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
      {spec.shapes.length > ICONS_UP_TO ? (
        <select
          aria-label={t("views.shape")}
          value={shape}
          onChange={(e) => onShape(e.target.value as Shape)}
          data-view-select={surface}
          className="rounded-lg border border-[var(--edge)] bg-transparent px-2 py-1 text-sm text-zinc-700 dark:text-zinc-200"
        >
          {spec.shapes.map((s) => (
            <option key={s} value={s}>
              {t(`views.shape_${s}`)}
            </option>
          ))}
        </select>
      ) : (
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
      )}
      {pinnable ? (
        <button
          type="button"
          aria-pressed={isDefault === true}
          aria-label={isDefault ? t("views.unsetDefault") : t("views.setDefault")}
          title={isDefault ? t("views.unsetDefault") : t("views.setDefaultHint")}
          onClick={() => (isDefault ? onClearDefault!() : onSetDefault!())}
          data-view-default={isDefault ? "on" : "off"}
          className={`rounded-lg border px-2 py-1 text-sm transition-colors ${
            isDefault
              ? "border-teal-600 bg-teal-600 text-white dark:border-teal-500 dark:bg-teal-500 dark:text-zinc-950"
              : "border-[var(--edge)] text-zinc-500 hover:bg-[var(--edge-soft)]"
          }`}
        >
          <span aria-hidden>{isDefault ? "★" : "☆"}</span>
        </button>
      ) : null}
    </div>
  );
}
