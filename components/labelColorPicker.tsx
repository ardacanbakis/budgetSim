"use client";

import { Badge } from "@/components/ui";
import { LABEL_COLORS, LABELED_STATUSES, LabeledStatus, SWATCH_CLASS, useLabelColor } from "@/lib/ui/labelColors";
import { useI18n } from "@/lib/i18n";

/**
 * One row per status label: the label as it will look, then a swatch per
 * colour. Used inline on the Recurring screen and in Settings → Views, the
 * same way a screen's shape can be changed in either place.
 */
export function LabelColorSettings() {
  return (
    <ul className="divide-y divide-[var(--edge-soft)] rounded-lg border border-[var(--edge)]">
      {LABELED_STATUSES.map((s) => (
        <LabelColorRow key={s} status={s} />
      ))}
    </ul>
  );
}

function LabelColorRow({ status }: { status: LabeledStatus }) {
  const { t } = useI18n();
  const [color, setColor] = useLabelColor(status);
  const name = t(`recurring.status_${status}`);

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
      <Badge tone={color}>{name}</Badge>
      <span role="group" aria-label={t("recurring.labelColorFor", { label: name })} className="flex flex-wrap gap-1.5">
        {LABEL_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            aria-pressed={color === c}
            aria-label={t(`recurring.color_${c}`)}
            title={t(`recurring.color_${c}`)}
            onClick={() => setColor(c)}
            className={`h-7 w-7 rounded-full ${SWATCH_CLASS[c]} ring-offset-2 ring-offset-[var(--surface)] transition-transform ${
              color === c ? "ring-2 ring-zinc-900 dark:ring-zinc-100" : "hover:scale-110"
            }`}
          />
        ))}
      </span>
    </li>
  );
}
