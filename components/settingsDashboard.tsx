"use client";

import { ReactNode, useEffect } from "react";
import { Button, Card, CardHeader, Select } from "@/components/ui";
import { useApp } from "@/lib/data/provider";
import { useRates } from "@/lib/data/queries";
import { useI18n } from "@/lib/i18n";
import { dashboardAccountLines } from "@/lib/ui/dashboardAccounts";
import {
  CARD_IDS,
  cardSpec,
  CardId,
  DashboardStyle,
  isCardVisible,
  moveCard,
  navAllows,
  NormalizedLayout,
  resetAccounts,
  resetCards,
  setAccountHidden,
  setAccountLimit,
  setCardVisible,
  setHideEmpty,
  setUpcomingDays,
  UPCOMING_DAYS,
} from "@/lib/ui/dashboardLayout";
import { AccountLine } from "@/lib/ui/pocket/portfolioSections";
import { formatSigned } from "@/lib/ui/pocket/format";
import { useDashboardLayout } from "@/lib/ui/useDashboardLayout";
import { useDashboardData } from "@/lib/useDashboardData";

/**
 * Settings → Dashboard: which cards the dashboards show and in what order,
 * and which accounts they list. Both are synced (user_settings.dashboard_
 * layout, through useDashboardLayout), so they say "on every device"; Pocket's
 * Home keeps its own sections on the phone and has its own card below these.
 */

/** Rows Classic's Accounts card can be set to list; null = all of them. */
const LIMITS = [5, 8, null] as const;

/** The anchor the dashboards' "2 hidden · 1 empty" links to. */
export const ACCOUNTS_ANCHOR = "accounts";

export function DashboardCardsCard() {
  const { t } = useI18n();
  const { uiStyle, uiVersion } = useApp();
  const { layout, navHrefs, update } = useDashboardLayout();
  if (!layout) return null;
  const style: DashboardStyle = uiVersion === "v2" ? "v2" : "classic";
  const customised = layout.hidden.length > 0 || layout.shown.length > 0 || layout.order.some((id, i) => id !== CARD_IDS[i]);

  return (
    <Card>
      <CardHeader
        title={t("dashboard.cardsTitle")}
        action={
          customised ? (
            <Button variant="ghost" onClick={() => update(resetCards)}>
              {t("dashboard.cardsReset")}
            </Button>
          ) : undefined
        }
      />
      <p className="px-4 pt-2 text-xs text-zinc-500">{t("dashboard.cardsHint", { style: t(`style.${uiStyle}`) })}</p>
      <ul data-dashboard-cards className="divide-y divide-[var(--edge-soft)]">
        {layout.order.map((id, index) => (
          <CardRow
            key={id}
            id={id}
            layout={layout}
            style={style}
            navHrefs={navHrefs}
            first={index === 0}
            last={index === layout.order.length - 1}
            onToggle={(on) => update((l) => setCardVisible(l, id, on))}
            onMove={(delta) => update((l) => moveCard(l, l.order, id, delta))}
          >
            {id === "upcoming" && isCardVisible(layout, id, style, navHrefs) ? (
              <UpcomingRange value={layout.upcomingDays} onChange={(d) => update((l) => setUpcomingDays(l, d))} />
            ) : null}
          </CardRow>
        ))}
      </ul>
    </Card>
  );
}

function CardRow({
  id,
  layout,
  style,
  navHrefs,
  first,
  last,
  onToggle,
  onMove,
  children,
}: {
  id: CardId;
  layout: NormalizedLayout;
  style: DashboardStyle;
  navHrefs: readonly string[];
  first: boolean;
  last: boolean;
  onToggle: (on: boolean) => void;
  onMove: (delta: -1 | 1) => void;
  children?: ReactNode;
}) {
  const { t } = useI18n();
  const spec = cardSpec(id);
  const label = t(spec.labelKey);
  const allowed = navAllows(id, navHrefs);
  const on = isCardVisible(layout, id, style, navHrefs);
  return (
    <li data-card-row={id} className="px-4 py-2">
      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={on}
          disabled={!allowed}
          onChange={(e) => onToggle(e.target.checked)}
          aria-label={t("dashboard.cardShow", { card: label })}
          title={allowed ? undefined : t("dashboard.cardNeedsPage")}
          className="h-4 w-4 shrink-0 accent-teal-600 disabled:opacity-40"
        />
        <span className="min-w-0 flex-1">
          <span className={`block text-sm ${on ? "" : "text-zinc-400"}`}>{label}</span>
          <span className="block text-xs text-zinc-500">{allowed ? t(spec.descKey) : t("dashboard.cardNeedsPage")}</span>
        </span>
        <button
          type="button"
          onClick={() => onMove(-1)}
          disabled={first}
          className="px-1.5 text-zinc-400 hover:text-zinc-700 disabled:opacity-30 dark:hover:text-zinc-200"
          aria-label={`${t("layout.moveUp")}: ${label}`}
        >
          ↑
        </button>
        <button
          type="button"
          onClick={() => onMove(1)}
          disabled={last}
          className="px-1.5 text-zinc-400 hover:text-zinc-700 disabled:opacity-30 dark:hover:text-zinc-200"
          aria-label={`${t("layout.moveDown")}: ${label}`}
        >
          ↓
        </button>
      </div>
      {children}
    </li>
  );
}

function UpcomingRange({ value, onChange }: { value: number; onChange: (days: (typeof UPCOMING_DAYS)[number]) => void }) {
  const { t } = useI18n();
  return (
    <div role="group" aria-label={t("dashboard.upcomingRange")} className="mt-2 flex items-center gap-2 pl-7">
      <span className="text-xs text-zinc-500">{t("dashboard.upcomingRange")}</span>
      <div className="flex gap-1 rounded-lg bg-[var(--edge-soft)] p-0.5">
        {UPCOMING_DAYS.map((d) => (
          <button
            key={d}
            type="button"
            aria-pressed={value === d}
            onClick={() => onChange(d)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium ${
              value === d ? "bg-teal-600 text-white dark:bg-teal-500 dark:text-zinc-950" : "text-zinc-600 dark:text-zinc-300"
            }`}
          >
            {t("dashboard.upcomingDaysN", { count: d })}
          </button>
        ))}
      </div>
    </div>
  );
}

const GROUPS = [
  { key: "groupCash", kinds: ["fiat"] },
  { key: "groupCryptoGold", kinds: ["crypto", "gold"] },
  { key: "groupCards", kinds: ["credit_card"] },
] as const;

export function DashboardAccountsCard() {
  const { t, locale } = useI18n();
  const { displayCurrency } = useApp();
  const rates = useRates();
  const derived = useDashboardData(displayCurrency);
  const { layout, update } = useDashboardLayout();

  // the dashboards' "2 hidden · 1 empty" links here; the card renders after
  // the page has loaded, too late for the browser's own jump to the anchor
  const ready = layout != null && derived != null;
  useEffect(() => {
    if (ready && window.location.hash === `#${ACCOUNTS_ANCHOR}`) {
      document.getElementById(ACCOUNTS_ANCHOR)?.scrollIntoView({ block: "start" });
    }
  }, [ready]);

  if (!layout || !derived) return null;
  const lines = dashboardAccountLines({ ...derived, usdPer: rates.data?.usdPer, display: displayCurrency });
  const emptyCount = lines.filter((l) => l.empty).length;
  const prefs = layout.accounts;
  const customised = prefs.hidden.length > 0 || prefs.hideEmpty || prefs.limit !== 5;

  const row = (line: AccountLine) => {
    const listed = !prefs.hidden.includes(line.account.id);
    return (
      <li key={line.account.id} className="flex items-center gap-3 px-4 py-2">
        <input
          type="checkbox"
          checked={listed}
          onChange={(e) => update((l) => setAccountHidden(l, line.account.id, !e.target.checked))}
          aria-label={t("dashboard.accountShow", { name: line.account.name })}
          className="h-4 w-4 shrink-0 accent-teal-600"
        />
        <span className={`min-w-0 flex-1 truncate text-sm ${listed ? "" : "text-zinc-400 line-through"}`}>{line.account.name}</span>
        {line.empty ? (
          <span className="rounded-full bg-[var(--edge-soft)] px-2 py-0.5 text-[11px] text-zinc-500">{t("dashboard.emptyTag")}</span>
        ) : null}
        <span data-amount className="shrink-0 text-sm tabular-nums text-zinc-600 dark:text-zinc-300">
          {formatSigned(line.shown.amount, line.shown.currency, locale)}
        </span>
      </li>
    );
  };

  return (
    <Card>
      <span id={ACCOUNTS_ANCHOR} className="block scroll-mt-20" />
      <CardHeader
        title={t("dashboard.accountsTitle")}
        action={
          customised ? (
            <Button variant="ghost" onClick={() => update(resetAccounts)}>
              {t("dashboard.accountsReset")}
            </Button>
          ) : undefined
        }
      />
      <div className="space-y-3 px-4 pt-3">
        <p className="text-xs text-zinc-500">{t("dashboard.accountsHint")}</p>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            role="switch"
            checked={prefs.hideEmpty}
            onChange={(e) => update((l) => setHideEmpty(l, e.target.checked))}
            className="h-4 w-4 accent-teal-600"
          />
          <span className="text-sm">{t("dashboard.hideEmptyN", { count: emptyCount })}</span>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-sm">{t("dashboard.classicLimit")}</span>
          <Select
            value={prefs.limit == null ? "all" : String(prefs.limit)}
            onChange={(e) => update((l) => setAccountLimit(l, e.target.value === "all" ? null : Number(e.target.value)))}
            className="w-auto"
          >
            {/* a limit someone saved elsewhere stays selectable */}
            {[...new Set<number | null>([...LIMITS, prefs.limit])].map((n) => (
              <option key={n ?? "all"} value={n ?? "all"}>
                {n == null ? t("dashboard.limitAll") : n}
              </option>
            ))}
          </Select>
        </label>
      </div>
      {GROUPS.map((group) => {
        const rows = lines.filter((l) => (group.kinds as readonly string[]).includes(l.account.kind));
        if (rows.length === 0) return null;
        return (
          <div key={group.key} className="mt-3">
            <h3 className="px-4 text-xs font-medium uppercase tracking-wide text-zinc-400">{t(`dashboard.${group.key}`)}</h3>
            <ul className="divide-y divide-[var(--edge-soft)]">{rows.map(row)}</ul>
          </div>
        );
      })}
    </Card>
  );
}
