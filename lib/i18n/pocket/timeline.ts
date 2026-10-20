/**
 * Pocket strings for the "timeline" package, under pocket.timeline.* —
 * English and Turkish side by side, so a key can't exist in one and not the
 * other. What both layouts say is in lib/i18n/timeline.ts (timeline.*).
 *
 * The three-way segment needs short labels: "Düzenli işlemler" doesn't fit a
 * third of a 390px phone, so Pocket says "Düzenli" there.
 */
export const en = {
  tabTimeline: "Timeline",
  tabRecurring: "Recurring",
  jumpUp: "↑ Today",
  jumpDown: "↓ Today",
  jumpLabel: "Back to today",
};

export const tr: typeof en = {
  tabTimeline: "Zaman tüneli",
  tabRecurring: "Düzenli",
  jumpUp: "↑ Bugün",
  jumpDown: "↓ Bugün",
  jumpLabel: "Bugüne dön",
};
