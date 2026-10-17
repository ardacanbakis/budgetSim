"use client";

import { ReactNode, useDeferredValue, useEffect, useId, useMemo, useRef, useState } from "react";
import { EmptyState } from "@/components/ui";
import { useTransactions } from "@/lib/data/queries";
import { Transaction } from "@/lib/data/types";
import { Currency } from "@/lib/domain/currencies";
import { useI18n } from "@/lib/i18n";
import {
  ActivityFilters,
  applyFilters,
  DeepLink,
  filtersFromParams,
  hasActiveFilters,
  MONTHS_PER_PAGE,
  NeedsAction,
  needsAction,
  netOf,
  NO_FILTERS,
  scopeRows,
  toggleChip,
} from "@/lib/ui/pocket/activityFilter";
import { GroupOptions, groupMonthsDays, listedRows } from "@/lib/ui/pocket/dayGroups";
import { formatSigned } from "@/lib/ui/pocket/format";
import { POCKET_KEYS, usePocketPref } from "@/lib/ui/pocket/prefs";
import { AccountSheet, ActivityChips, ActivitySearch, RowsSkeleton } from "./activityFilters";
import { PocketDayList, PocketTxRow, TxLookup, useTxLookup } from "./dayList";
import { Icon } from "./icons";
import { PocketTxSheet, usePocketTxSheet } from "./txActions";

/**
 * Pocket's Activity (/transactions, the ledger tab): the ledger as a phone
 * list, with what needs doing on top.
 *
 * 1. Search and the chip row (components/pocket/activityFilters.tsx).
 * 2. "Needs attention", unless Planned or Overdue is on or a search is
 *    typed: planned rows overdue (red), then those coming within 7 or 30
 *    days (the choice is kept on the device, shared with Home), each with
 *    its ✓; "Later: n planned ›" turns the Planned chip on.
 * 3. The history: completed rows by default; with Planned or Overdue, those
 *    rows, oldest first; with a search, everything that matches. Month
 *    separators with the month's net, sticky day headers, three months at
 *    a time.
 *
 * Same numbers as Classic: the rows the Classic ledger lists (listedRows),
 * grouped and summed by lib/ui/pocket/dayGroups.ts (the Classic month
 * header's rule), written through the list kit's useTxActions. With one
 * account chosen, nets are in its currency (the Portfolio history rule).
 *
 * Deep links: ?show=due scrolls to the "needs attention" card;
 * ?filter=overdue|planned, ?account={id} and ?q= set the filters.
 * Selection mode (bulk actions) is deferred.
 */

export interface ActivityLink extends DeepLink {
  show?: string | null;
}

export function PocketActivity({ link }: { link: ActivityLink }) {
  const { t, locale } = useI18n();
  const lookup = useTxLookup();
  const transactions = useTransactions();
  const sheet = usePocketTxSheet();
  const [filters, setFiltersState] = useState<ActivityFilters>(() => filtersFromParams(link));
  const [pages, setPages] = useState(1);
  const [accountsOpen, setAccountsOpen] = useState(false);
  const [range, setRange] = usePocketPref(POCKET_KEYS.upcomingRange, "7", (v) => v === "7" || v === "30");
  const days = Number(range);
  // typing stays quick on a long ledger: the list follows a beat behind
  const search = useDeferredValue(filters.search);

  const setFilters = (next: ActivityFilters) => {
    setFiltersState(next);
    setPages(1);
  };

  const { accountsById, categoriesById, book, today, usdPer, display } = lookup;
  // a link to an account that isn't there shows every account
  const account = filters.accountId ? accountsById.get(filters.accountId) : undefined;
  const active: ActivityFilters = useMemo(
    () => ({ ...filters, search, accountId: account?.id ?? null }),
    [filters, search, account]
  );

  const listed = useMemo(() => listedRows(transactions.data ?? [], book), [transactions.data, book]);
  const groupOptions: GroupOptions = useMemo(
    () => ({ accountsById, usdPer, display, book, accountId: account?.id }),
    [accountsById, usdPer, display, book, account]
  );

  const { scoped, months, due } = useMemo(() => {
    const options = { ...active, today, categoriesById, accountsById, locale };
    const scopedRows = scopeRows(listed, options);
    return {
      scoped: scopedRows,
      months: groupMonthsDays(applyFilters(listed, options), { ...groupOptions, order: active.sort }),
      due: needsAction(scopedRows, { today, days, accountId: account?.id }),
    };
  }, [listed, active, today, categoriesById, accountsById, locale, groupOptions, days, account]);

  const showCard = !active.planned && !active.overdue && !active.search.trim() && scoped.some((tx) => tx.status === "planned");
  const shownMonths = months.slice(0, pages * MONTHS_PER_PAGE);
  const currency: Currency = account?.currency ?? display;

  // ?show=due: once the list is there, bring the card under the header
  const scrolled = useRef(false);
  useEffect(() => {
    if (link.show !== "due" || scrolled.current || lookup.loading) return;
    scrolled.current = true;
    requestAnimationFrame(() => document.getElementById("needs-action")?.scrollIntoView({ block: "start" }));
  }, [link.show, lookup.loading]);

  const filtered = hasActiveFilters(active);
  const empty = months.length === 0 && !(showCard && (due.overdue.length > 0 || due.coming.length > 0 || due.later > 0));

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <ActivitySearch value={filters.search} onChange={(value) => setFilters({ ...filters, search: value })} />
        <ActivityChips
          filters={active}
          accountName={account?.name ?? null}
          overdueCount={due.overdue.length}
          onChip={(chip) => setFilters(toggleChip(filters, chip))}
          onAccounts={() => setAccountsOpen(true)}
          onSort={() => setFilters({ ...filters, sort: filters.sort === "newest" ? "oldest" : "newest" })}
        />
      </div>

      {lookup.loading ? (
        <RowsSkeleton />
      ) : empty ? (
        <EmptyState
          action={
            filtered ? (
              <button
                type="button"
                onClick={() => setFilters(NO_FILTERS)}
                className="flex min-h-[44px] items-center rounded-xl border border-[var(--edge)] bg-[var(--surface)] px-4 text-sm font-medium text-teal-700 active:bg-[var(--edge-soft)] dark:text-teal-300"
              >
                {t("pocket.activity.clearFilters")}
              </button>
            ) : undefined
          }
        >
          {t("tx.empty")}
        </EmptyState>
      ) : (
        <>
          {showCard ? (
            <NeedsActionCard
              due={due}
              days={days}
              lookup={lookup}
              sheet={sheet}
              accountScoped={account != null}
              total={(rows) => (usdPer || account ? netOf(rows, groupOptions) : null)}
              currency={currency}
              onRange={() => setRange(days === 7 ? "30" : "7")}
              onLater={() => setFilters(toggleChip(filters, "planned"))}
            />
          ) : null}
          {shownMonths.length > 0 ? (
            <PocketDayList
              months={shownMonths}
              onRowTap={sheet.open}
              onComplete={sheet.complete}
              accountCurrency={account?.currency}
            />
          ) : null}
          {months.length > shownMonths.length ? (
            <button
              type="button"
              onClick={() => setPages((p) => p + 1)}
              className="flex min-h-[44px] w-full items-center justify-center rounded-[var(--ui-card-radius)] border border-[var(--edge)] bg-[var(--surface)] text-sm font-medium text-teal-700 active:bg-[var(--edge-soft)] dark:text-teal-300"
            >
              {active.sort === "newest" ? t("pocket.activity.showEarlier") : t("pocket.activity.showLater")}
            </button>
          ) : null}
        </>
      )}

      {sheet.element}
      <AccountSheet
        open={accountsOpen}
        onClose={() => setAccountsOpen(false)}
        accounts={[...accountsById.values()]}
        value={account?.id ?? null}
        onChange={(accountId) => setFilters({ ...filters, accountId })}
      />
    </div>
  );
}

/** Overdue and coming-up planned rows, each block folding away; "Later: n planned ›" under them. */
function NeedsActionCard({
  due,
  days,
  lookup,
  sheet,
  accountScoped,
  total,
  currency,
  onRange,
  onLater,
}: {
  due: NeedsAction;
  days: number;
  lookup: TxLookup;
  sheet: PocketTxSheet;
  accountScoped: boolean;
  /** what rows add up to, or null until rates arrive */
  total: (rows: Transaction[]) => number | null;
  currency: Currency;
  onRange: () => void;
  onLater: () => void;
}) {
  const { t, locale } = useI18n();
  // "Overdue · 3 · −$1,240.00": the figure apart, so hiding amounts blurs only it
  const heading = (rows: Transaction[], key: string): ReactNode => {
    const sum = rows.length > 0 ? total(rows) : null;
    return (
      <>
        {t(key, { count: rows.length })}
        {sum != null ? (
          <>
            {" · "}
            <span data-amount>{formatSigned(sum, currency, locale, sum > 0 ? "in" : "auto")}</span>
          </>
        ) : null}
      </>
    );
  };
  const rows = (list: Transaction[]) =>
    list.map((tx) => (
      <PocketTxRow key={tx.id} tx={tx} lookup={lookup} onTap={sheet.open} onComplete={sheet.complete} accountScoped={accountScoped} due />
    ));

  return (
    <section
      id="needs-action"
      aria-label={t("pocket.activity.needsAction")}
      className="scroll-mt-[calc(var(--pocket-top,44px)+0.5rem)] overflow-hidden rounded-[var(--ui-card-radius)] border border-[var(--edge)] bg-[var(--surface)]"
    >
      {due.overdue.length > 0 ? (
        <Block
          id="overdue"
          tone="red"
          title={heading(due.overdue, "pocket.activity.overdueBlock")}
        >
          {rows(due.overdue)}
        </Block>
      ) : null}
      <Block
        title={heading(due.coming, "pocket.activity.comingBlock")}
        divided={due.overdue.length > 0}
        action={
          <button
            type="button"
            onClick={onRange}
            className="flex min-h-[44px] shrink-0 items-center rounded-full px-3 text-xs font-medium text-teal-700 active:bg-[var(--edge-soft)] dark:text-teal-300"
          >
            {days === 7 ? t("pocket.activity.show30") : t("pocket.activity.show7")}
          </button>
        }
      >
        {due.coming.length > 0 ? (
          rows(due.coming)
        ) : (
          <li className="px-4 py-3 text-sm text-zinc-500 dark:text-zinc-400">{t("pocket.activity.nothingSoon", { days })}</li>
        )}
      </Block>
      {due.later > 0 ? (
        <button
          type="button"
          onClick={onLater}
          className="flex min-h-[44px] w-full items-center justify-between gap-2 border-t border-[var(--edge-soft)] px-4 text-sm font-medium text-teal-700 active:bg-[var(--edge-soft)] dark:text-teal-300"
        >
          {t("pocket.activity.laterPlanned", { count: due.later })}
          <Icon name="chevron" size={18} />
        </button>
      ) : null}
    </section>
  );
}

/** One folding group of the card: its heading is a 44px button (aria-expanded), open to start with. */
function Block({
  id,
  title,
  tone,
  action,
  divided,
  children,
}: {
  id?: string;
  title: ReactNode;
  tone?: "red";
  action?: ReactNode;
  divided?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const bodyId = useId();
  return (
    <div className={divided ? "border-t border-[var(--edge)]" : undefined}>
      <div className="flex min-h-[44px] items-center gap-1 pr-1">
        <h2 id={id} className="min-w-0 flex-1 scroll-mt-[calc(var(--pocket-top,44px)+0.5rem)]">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => setOpen((o) => !o)}
            className={`flex min-h-[44px] w-full items-center gap-1.5 pl-3 text-left text-sm font-semibold ${
              tone === "red" ? "text-red-600 dark:text-red-400" : ""
            }`}
          >
            <Icon name="chevron" size={16} className={`shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
            <span className="min-w-0 truncate tabular-nums">{title}</span>
          </button>
        </h2>
        {action}
      </div>
      {open ? (
        <ul id={bodyId} className="divide-y divide-[var(--edge-soft)] border-t border-[var(--edge-soft)]">
          {children}
        </ul>
      ) : null}
    </div>
  );
}
