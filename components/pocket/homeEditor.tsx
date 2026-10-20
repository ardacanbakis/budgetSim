"use client";

import { useId, useState } from "react";
import { useApp } from "@/lib/data/provider";
import { useRates } from "@/lib/data/queries";
import { useI18n } from "@/lib/i18n";
import { dashboardAccountLines } from "@/lib/ui/dashboardAccounts";
import { setAccountHidden, setHideEmpty } from "@/lib/ui/dashboardLayout";
import {
  canMove,
  HOME_SECTIONS_KEY,
  moveSection,
  parseSections,
  resetSections,
  SectionId,
  serializeSections,
  toggleSection,
} from "@/lib/ui/pocket/homeSections";
import { isHeroFigure, POCKET_KEYS, usePocketPref } from "@/lib/ui/pocket/prefs";
import { useDashboardLayout } from "@/lib/ui/useDashboardLayout";
import { useDashboardData } from "@/lib/useDashboardData";
import { Icon } from "./icons";
import { Money, SegmentRadios, SwitchTrack } from "./kit";

/**
 * What Pocket's Home shows, edited where you see it: the "Customise Home"
 * sheet over Home, and the same editor in Settings → Dashboard on a Pocket
 * phone.
 *
 * - Sections, their order and which show, and what Home leads with and how
 *   far Coming up looks: this phone only (device prefs, lib/ui/pocket/
 *   prefs.ts), as they always were.
 * - Accounts: "hide empty" and the accounts left off are the dashboards'
 *   synced choices (dashboardLayout.accounts), so they say "on every
 *   device". Only that part of the layout is ever written from here.
 */

/** A section's name, as its heading on Home says it. */
export const SECTION_LABEL: Record<SectionId, string> = {
  comingUp: "pocket.home.comingUp",
  accounts: "dashboard.accounts",
  budgets: "budgets.title",
  recent: "pocket.home.recent",
  flow: "dashboard.monthlyFlow",
  goals: "goals.title",
  gold: "gold.title",
  thisMonth: "dashboard.card_this-month",
  statements: "dashboard.card_card-statements",
  trend: "dashboard.card_trend",
  debt: "dashboard.card_debt",
  commitments: "dashboard.card_commitments",
  victvsOutlook: "dashboard.card_victvs-outlook",
};

const rowClass = "flex min-h-[var(--pocket-row,56px)] items-center gap-2 px-4";
const cardClass = "divide-y divide-[var(--edge-soft)] overflow-hidden rounded-[var(--ui-card-radius)] border border-[var(--edge)] bg-[var(--surface)]";
const headClass = "px-1 pb-1.5 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400";

export function HomeSectionsEditor() {
  const { t } = useI18n();
  const [stored, setStored] = usePocketPref(HOME_SECTIONS_KEY, "");
  const [hero, setHero] = usePocketPref(POCKET_KEYS.hero, "net", isHeroFigure);
  const [range, setRange] = usePocketPref(POCKET_KEYS.upcomingRange, "7", (v) => v === "7" || v === "30");
  const entries = parseSections(stored);
  const save = (next: ReturnType<typeof parseSections>) => setStored(serializeSections(next));

  return (
    <div className="space-y-5 pb-2" data-home-editor>
      <div>
        <h3 className={headClass}>{t("pocket.home.sections")}</h3>
        <ul className={cardClass}>
          {entries.map((entry) => {
            const label = t(SECTION_LABEL[entry.id]);
            return (
              <li key={entry.id} data-section-row={entry.id} className="flex items-center">
                <button
                  type="button"
                  role="switch"
                  aria-checked={!entry.hidden}
                  onClick={() => save(toggleSection(entries, entry.id))}
                  className={`${rowClass} min-w-0 flex-1 justify-between pr-2 text-left active:bg-[var(--edge-soft)]`}
                >
                  <span className={`min-w-0 truncate text-[15px] ${entry.hidden ? "text-zinc-500 dark:text-zinc-400" : ""}`}>{label}</span>
                  <SwitchTrack on={!entry.hidden} />
                </button>
                <button
                  type="button"
                  disabled={!canMove(entries, entry.id, -1)}
                  onClick={() => save(moveSection(entries, entry.id, -1))}
                  aria-label={t("pocket.home.moveUp", { section: label })}
                  className="flex h-11 w-11 shrink-0 items-center justify-center text-zinc-500 active:bg-[var(--edge-soft)] disabled:opacity-30"
                >
                  <span aria-hidden>↑</span>
                </button>
                <button
                  type="button"
                  disabled={!canMove(entries, entry.id, 1)}
                  onClick={() => save(moveSection(entries, entry.id, 1))}
                  aria-label={t("pocket.home.moveDown", { section: label })}
                  className="mr-1 flex h-11 w-11 shrink-0 items-center justify-center text-zinc-500 active:bg-[var(--edge-soft)] disabled:opacity-30"
                >
                  <span aria-hidden>↓</span>
                </button>
              </li>
            );
          })}
        </ul>
        <button
          type="button"
          onClick={() => save(resetSections())}
          className="mt-1 flex min-h-[44px] items-center px-1 text-sm font-medium text-teal-700 active:bg-[var(--edge-soft)] dark:text-teal-300"
        >
          {t("pocket.home.resetSections")}
        </button>
      </div>

      <div className="space-y-3">
        <SegmentRadios
          label={t("pocket.homeLeads")}
          value={hero === "safe" ? "safe" : "net"}
          options={[
            { value: "net", label: t("pocket.leadNet") },
            { value: "safe", label: t("pocket.leadSafe") },
          ]}
          onChange={setHero}
        />
        <SegmentRadios
          label={t("pocket.upcomingRange")}
          value={range === "30" ? "30" : "7"}
          options={[
            { value: "7", label: t("pocket.days7") },
            { value: "30", label: t("pocket.days30") },
          ]}
          onChange={setRange}
        />
        <p className="px-1 text-xs text-zinc-500 dark:text-zinc-400">{t("pocket.home.thisPhone")}</p>
      </div>

      <HomeAccountsEditor />
    </div>
  );
}

/** The dashboards' account choices, synced: hide empty, and the accounts left off. */
function HomeAccountsEditor() {
  const { t } = useI18n();
  const { displayCurrency } = useApp();
  const rates = useRates();
  const derived = useDashboardData(displayCurrency);
  const { layout, update } = useDashboardLayout();
  const [choosing, setChoosing] = useState(false);
  const listId = useId();
  if (!layout || !derived) return null;
  const lines = dashboardAccountLines({ ...derived, usdPer: rates.data?.usdPer, display: displayCurrency });
  const empty = lines.filter((l) => l.empty).length;
  const { hidden, hideEmpty } = layout.accounts;

  return (
    <div>
      <h3 className={headClass}>{t("dashboard.accounts")}</h3>
      <div className={cardClass}>
        <button
          type="button"
          role="switch"
          aria-checked={hideEmpty}
          onClick={() => update((l) => setHideEmpty(l, !hideEmpty))}
          className={`${rowClass} w-full justify-between text-left active:bg-[var(--edge-soft)]`}
        >
          <span className="min-w-0 text-[15px]">{t("pocket.home.hideEmptyN", { count: empty })}</span>
          <SwitchTrack on={hideEmpty} />
        </button>
        <button
          type="button"
          aria-expanded={choosing}
          aria-controls={listId}
          onClick={() => setChoosing(!choosing)}
          className={`${rowClass} w-full justify-between text-left active:bg-[var(--edge-soft)]`}
        >
          <span className="min-w-0 text-[15px]">{t("pocket.home.chooseAccounts")}</span>
          <span className="flex items-center gap-1 text-sm text-zinc-500 dark:text-zinc-400">
            {hidden.length > 0 ? t("dashboard.accountsHidden", { count: hidden.length }) : null}
            <Icon name="chevron" size={18} className={`transition-transform ${choosing ? "rotate-90" : ""}`} />
          </span>
        </button>
        {choosing ? (
          <ul id={listId} className="divide-y divide-[var(--edge-soft)]">
            {lines.map((line) => {
              const shown = !hidden.includes(line.account.id);
              return (
                <li key={line.account.id}>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={shown}
                    aria-label={line.account.name}
                    onClick={() => update((l) => setAccountHidden(l, line.account.id, shown))}
                    className={`${rowClass} w-full gap-3 pl-6 text-left active:bg-[var(--edge-soft)]`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-[15px] ${shown ? "" : "text-zinc-500 dark:text-zinc-400"}`}>{line.account.name}</span>
                      <Money amount={line.shown.amount} currency={line.shown.currency} className="block text-xs text-zinc-500 dark:text-zinc-400" />
                    </span>
                    <SwitchTrack on={shown} />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
      <p className="px-1 pt-1.5 text-xs text-zinc-500 dark:text-zinc-400">{t("pocket.home.everyDevice")}</p>
    </div>
  );
}
