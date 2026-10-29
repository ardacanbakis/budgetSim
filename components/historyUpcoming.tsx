"use client";

import { ReactNode, useEffect, useState } from "react";
import { Segmented } from "@/components/pocket/kit";
import { useI18n } from "@/lib/i18n";

/** Which of an item's lists show: what happened, what's planned, or both at once. */
export type HistoryLayout = "history" | "upcoming" | "both";

const STORAGE_KEY = "renovator-history-layout";
const LAYOUTS: HistoryLayout[] = ["history", "upcoming", "both"];

/**
 * Device-local and shared by every item, like the column count: choosing side
 * by side once applies to every account, card, asset and debt. Both is the
 * default, as both lists showed before there was a choice.
 */
export function useHistoryLayout() {
  const [layout, setLayout] = useState<HistoryLayout>("both");

  useEffect(() => {
    queueMicrotask(() => {
      try {
        const saved = window.localStorage.getItem(STORAGE_KEY);
        if (LAYOUTS.includes(saved as HistoryLayout)) setLayout(saved as HistoryLayout);
      } catch {
        // storage blocked: the default stands
      }
    });
  }, []);

  function update(next: HistoryLayout) {
    setLayout(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // storage blocked: the choice lasts until the page closes
    }
  }

  return [layout, update] as const;
}

/**
 * An item's History and Upcoming as two tabs, or both at once: side by side
 * (past on the left, planned on the right) once the pane has room, else
 * Upcoming above History, as they always stacked. The pane's own width
 * decides (a container query), so a narrow side pane stacks where a wide
 * modal doesn't.
 */
export function HistoryUpcoming({
  history,
  upcoming,
  historyCount,
  upcomingCount,
  historyAction,
  pocket,
  layout: controlled,
  onLayout,
  historyEmpty,
  className = "",
  emptyClassName = "px-4 py-3 text-sm text-zinc-400",
}: {
  history: ReactNode;
  upcoming: ReactNode;
  historyCount: number;
  upcomingCount: number;
  /** shown beside the control while History is visible, e.g. its sort order */
  historyAction?: ReactNode;
  /** Pocket's segmented control and wording */
  pocket?: boolean;
  /** from the caller's own useHistoryLayout, when the layout changes more than these lists (a modal's width) */
  layout?: HistoryLayout;
  onLayout?: (next: HistoryLayout) => void;
  /** what an empty History says, when "No activity" isn't the right words */
  historyEmpty?: string;
  className?: string;
  emptyClassName?: string;
}) {
  const { t } = useI18n();
  const [own, setOwn] = useHistoryLayout();
  const layout = controlled ?? own;
  const setLayout = onLayout ?? setOwn;
  const both = layout === "both";
  const counted = (label: string, count: number) => (
    <>
      {label}
      {count > 0 ? <span className="ml-1 text-[11px] tabular-nums text-zinc-400">{count}</span> : null}
    </>
  );
  const options: Array<{ value: HistoryLayout; label: ReactNode }> = [
    { value: "history", label: counted(t("portfolio.history"), historyCount) },
    { value: "upcoming", label: counted(t("portfolio.upcoming"), upcomingCount) },
    { value: "both", label: pocket ? t("portfolio.both") : `⇆ ${t("portfolio.sideBySide")}` },
  ];
  // with both showing, each list says which it is; a tab already does
  const Heading = pocket ? "h2" : "h3";
  const head = (label: string, tone: string) =>
    both ? <Heading className={`px-4 pt-2 text-[11px] font-semibold uppercase tracking-wide ${tone}`}>{label}</Heading> : null;

  return (
    <div className={`@container ${className}`} data-history-layout={layout}>
      <div className={`flex flex-wrap items-center justify-between gap-2 ${pocket ? "" : "px-4 pt-3"}`}>
        {pocket ? (
          <div className="w-full">
            <Segmented label={t("portfolio.layoutLabel")} value={layout} options={options} onChange={setLayout} fit />
          </div>
        ) : (
          <div className="flex gap-1 rounded-lg bg-[var(--edge-soft)] p-1" role="group" aria-label={t("portfolio.layoutLabel")}>
            {options.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => setLayout(o.value)}
                aria-pressed={layout === o.value}
                title={o.value === "both" ? t("portfolio.bothHint") : undefined}
                className={`rounded-md px-2.5 py-1 text-xs font-medium ${layout === o.value ? "bg-[var(--surface)] shadow-sm" : "text-zinc-500"}`}
              >
                {o.label}
              </button>
            ))}
          </div>
        )}
        {layout !== "upcoming" && historyAction ? <div className={pocket ? "w-full text-right" : ""}>{historyAction}</div> : null}
      </div>
      <div className={both ? "grid items-start gap-3 @xl:grid-cols-2" : ""}>
        {layout !== "history" ? (
          // stacked, the short planned list leads; side by side, it's on the right
          <div className="min-w-0 @xl:order-last" data-history-column="upcoming">
            {head(t("portfolio.upcoming"), "text-amber-600")}
            {upcomingCount > 0 ? upcoming : <p className={emptyClassName}>{t("portfolio.noUpcoming")}</p>}
          </div>
        ) : null}
        {layout !== "upcoming" ? (
          <div className="min-w-0" data-history-column="history">
            {head(t("portfolio.history"), "text-zinc-400")}
            {historyCount > 0 ? history : <p className={emptyClassName}>{historyEmpty ?? t("portfolio.noHistory")}</p>}
          </div>
        ) : null}
      </div>
    </div>
  );
}
