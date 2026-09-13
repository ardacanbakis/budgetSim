"use client";

import { Card, CardHeader, Fieldset } from "@/components/ui";
import { ColumnCount } from "@/components/columns";
import { useApp } from "@/lib/data/provider";
import { useSurfaceView } from "@/lib/ui/useViews";
import { DENSITIES, Density, Shape, SURFACES, SURFACE_SPECS, SurfaceId } from "@/lib/ui/views";
import { useI18n } from "@/lib/i18n";

/**
 * Every screen's shape, in one place.
 *
 * Each page already carries its own switcher, which is where you change it in
 * passing. This is for setting the app up the way you want it once, without
 * visiting six pages to do it — and it is the only place that shows the
 * choices side by side, which is how you notice you left one on a shape you
 * did not mean.
 */
export function ViewsCard() {
  const { t } = useI18n();
  const { density, setDensity } = useApp();

  return (
    <Card>
      <CardHeader title={t("views.title")} />
      <div className="space-y-4 p-4">
        <Fieldset label={t("views.density")} hint={t("views.densityHint")}>
          <div role="group" aria-label={t("views.density")} className="flex rounded-lg border border-[var(--edge)] p-0.5">
            {DENSITIES.map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={density === d}
                onClick={() => setDensity(d as Density)}
                className={`flex-1 rounded-md px-2 py-1.5 text-sm font-medium transition-colors ${
                  density === d
                    ? "bg-teal-600 text-white dark:bg-teal-500 dark:text-zinc-950"
                    : "text-zinc-600 hover:bg-[var(--edge-soft)] dark:text-zinc-300"
                }`}
              >
                {t(`views.density_${d}`)}
              </button>
            ))}
          </div>
        </Fieldset>

        <div className="space-y-2">
          <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{t("views.perScreen")}</span>
          <ul className="divide-y divide-[var(--edge-soft)] rounded-lg border border-[var(--edge)]">
            {SURFACES.map((id) => (
              <SurfaceRow key={id} id={id} />
            ))}
          </ul>
        </div>
      </div>
    </Card>
  );
}

function SurfaceRow({ id }: { id: SurfaceId }) {
  const { t } = useI18n();
  const view = useSurfaceView(id);
  const spec = SURFACE_SPECS[id];

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
      <span className="text-sm">{t(`nav.${id === "accounts" ? "accounts" : id}`)}</span>
      <span className="flex items-center gap-2">
        {spec.columns && view.shape === "grid" ? (
          <span role="group" aria-label={`${t("views.gridColumns")} — ${id}`} className="flex rounded-lg border border-[var(--edge)] p-0.5">
            {([1, 2, 3] as ColumnCount[]).map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={view.columns === n}
                onClick={() => view.setColumns(n)}
                className={`rounded-md px-2 py-1 text-xs tnum transition-colors ${
                  view.columns === n
                    ? "bg-teal-600 text-white dark:bg-teal-500 dark:text-zinc-950"
                    : "text-zinc-500 hover:bg-[var(--edge-soft)]"
                }`}
              >
                {n}
              </button>
            ))}
          </span>
        ) : null}
        <span role="group" aria-label={`${t("views.shape")} — ${id}`} className="flex rounded-lg border border-[var(--edge)] p-0.5">
          {spec.shapes.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={view.shape === s}
              onClick={() => view.setShape(s as Shape)}
              className={`rounded-md px-2 py-1 text-xs transition-colors ${
                view.shape === s
                  ? "bg-teal-600 text-white dark:bg-teal-500 dark:text-zinc-950"
                  : "text-zinc-500 hover:bg-[var(--edge-soft)]"
              }`}
            >
              {t(`views.shape_${s}`)}
            </button>
          ))}
        </span>
      </span>
    </li>
  );
}
