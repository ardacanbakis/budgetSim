"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ReactNode, useDeferredValue, useEffect, useId, useMemo, useRef, useState } from "react";
import { EmptyState } from "@/components/ui";
import { useRepo } from "@/lib/data/provider";
import { KEYS, useRates, useTransactions } from "@/lib/data/queries";
import { Transaction } from "@/lib/data/types";
import { Currency } from "@/lib/domain/currencies";
import { snapshotFromTable } from "@/lib/domain/fx";
import { useI18n } from "@/lib/i18n";
import {
  ActivityFilters,
  applyFilters,
  DeepLink,
  filtersFromParams,
  hasActiveFilters,
  MONTHS_PER_PAGE,
  monthsAhead,
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
import { bulkPlan, runInTurn, toggleSelected } from "@/lib/ui/pocket/selection";
import { showSnack } from "@/lib/ui/pocket/snackbar";
import { AccountSheet, ActivityChips, ActivitySearch, RowsSkeleton } from "./activityFilters";
import { PocketDayList, PocketTxRow, RowSelection, TxLookup, useTxLookup } from "./dayList";
import { Icon } from "./icons";
import { Money } from "./kit";
import { PocketActionSheet } from "./sheet";
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
 *    rows, oldest first; with a search, everything that matches, opening at
 *    this month (the months of planned rows after it wait behind "Show
 *    later months" at the top). Month separators with the month's net,
 *    sticky day headers, three months at a time.
 *
 * Same numbers as Classic: the rows the Classic ledger lists (listedRows),
 * grouped and summed by lib/ui/pocket/dayGroups.ts (the Classic month
 * header's rule), written through the list kit's useTxActions. With one
 * account chosen, nets are in its currency (the Portfolio history rule).
 *
 * Deep links: ?show=due scrolls to the "needs attention" card;
 * ?filter=overdue|planned, ?account={id} and ?q= set the filters.
 *
 * Selection mode (the header's Select, owned by components/pocket/transactions.tsx):
 * a tap chooses a row (in the card and the history alike) instead of opening
 * its sheet, and a bar floats above the tab bar: how many are chosen, Delete
 * and Mark as paid. Mark as paid offers it plain or as legacy, legacy first
 * when every row is long overdue; Delete asks for a second tap. The writes run
 * one after another (lib/ui/pocket/selection.ts runInTurn) with their progress
 * in the bar, and stop at the first error: the rows already written leave the
 * selection, the rest stay chosen to try again.
 */

export interface ActivityLink extends DeepLink {
  show?: string | null;
}

export function PocketActivity({
  link,
  selecting = false,
  onEndSelection,
}: {
  link: ActivityLink;
  /** selection mode is on: a tap chooses a row */
  selecting?: boolean;
  onEndSelection?: () => void;
}) {
  const { t, locale } = useI18n();
  const lookup = useTxLookup();
  const transactions = useTransactions();
  const sheet = usePocketTxSheet();
  const [filters, setFiltersState] = useState<ActivityFilters>(() => filtersFromParams(link));
  const [pages, setPages] = useState(1);
  const [aheadOpen, setAheadOpen] = useState(false);
  const historyRef = useRef<HTMLDivElement>(null);
  const [accountsOpen, setAccountsOpen] = useState(false);
  const [range, setRange] = usePocketPref(POCKET_KEYS.upcomingRange, "7", (v) => v === "7" || v === "30");
  const days = Number(range);
  // typing stays quick on a long ledger: the list follows a beat behind
  const search = useDeferredValue(filters.search);

  const setFilters = (next: ActivityFilters) => {
    setFiltersState(next);
    setPages(1);
    setAheadOpen(false);
  };

  const { accountsById, categoriesById, book, today, usdPer, display } = lookup;

  // selection mode: the chosen ids; leaving the mode forgets them
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [wasSelecting, setWasSelecting] = useState(selecting);
  if (wasSelecting !== selecting) {
    setWasSelecting(selecting);
    if (!selecting) setSelected(new Set());
  }
  const selection: RowSelection | undefined = useMemo(
    () => (selecting ? { has: (id) => selected.has(id), toggle: (tx) => setSelected((s) => toggleSelected(s, tx.id)) } : undefined),
    [selecting, selected]
  );
  const unselect = (ids: readonly string[]) =>
    setSelected((s) => {
      const next = new Set(s);
      for (const id of ids) next.delete(id);
      return next;
    });
  const endSelection = () => onEndSelection?.();
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
  // a search opens at this month; the months after it wait behind a button
  const ahead = monthsAhead(months, active, today);
  const fromNow = months.slice(ahead);
  const shownMonths = [...(aheadOpen ? months.slice(0, ahead) : []), ...fromNow.slice(0, pages * MONTHS_PER_PAGE)];
  const currency: Currency = account?.currency ?? display;

  // "Show later months" goes once used: focus moves to the first month it
  // brought, rather than falling back to the page
  useEffect(() => {
    if (!aheadOpen) return;
    const head = historyRef.current?.querySelector<HTMLElement>("h2");
    if (!head) return;
    head.tabIndex = -1;
    head.focus({ preventScroll: true });
  }, [aheadOpen]);

  // ?show=due: once the list is there, bring the card under the header
  const scrolled = useRef(false);
  useEffect(() => {
    if (link.show !== "due" || scrolled.current || lookup.loading) return;
    scrolled.current = true;
    requestAnimationFrame(() => document.getElementById("needs-action")?.scrollIntoView({ block: "start" }));
  }, [link.show, lookup.loading]);

  // what can be chosen: the rows on screen, in the card or the history
  // in the order they're listed; one chosen and then filtered away isn't acted on
  const onScreen = [...(showCard ? [...due.overdue, ...due.coming] : []), ...shownMonths.flatMap((m) => m.days.flatMap((d) => d.rows))];
  const chosen = selected.size > 0 ? [...new Map(onScreen.filter((tx) => selected.has(tx.id)).map((tx) => [tx.id, tx])).values()] : [];

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
              selection={selection}
              onRange={() => setRange(days === 7 ? "30" : "7")}
              onLater={() => setFilters(toggleChip(filters, "planned"))}
            />
          ) : null}
          {ahead > 0 && !aheadOpen ? (
            <MoreMonths onClick={() => setAheadOpen(true)}>{t("pocket.activity.showLater")}</MoreMonths>
          ) : null}
          {shownMonths.length > 0 ? (
            <div ref={historyRef}>
              <PocketDayList
                months={shownMonths}
                onRowTap={sheet.open}
                onComplete={sheet.complete}
                accountCurrency={account?.currency}
                selection={selection}
              />
            </div>
          ) : null}
          {fromNow.length > pages * MONTHS_PER_PAGE ? (
            <MoreMonths onClick={() => setPages((p) => p + 1)}>
              {active.sort === "newest" ? t("pocket.activity.showEarlier") : t("pocket.activity.showLater")}
            </MoreMonths>
          ) : null}
        </>
      )}

      {selecting ? <SelectionBar rows={chosen} lookup={lookup} onRowsDone={unselect} onEnd={endSelection} /> : null}

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

/** More months: under the list, the next page; over it, a search's later months. */
function MoreMonths({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[44px] w-full items-center justify-center rounded-[var(--ui-card-radius)] border border-[var(--edge)] bg-[var(--surface)] text-sm font-medium text-teal-700 active:bg-[var(--edge-soft)] dark:text-teal-300"
    >
      {children}
    </button>
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
  selection,
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
  selection?: RowSelection;
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
      <PocketTxRow
        key={tx.id}
        tx={tx}
        lookup={lookup}
        onTap={sheet.open}
        onComplete={sheet.complete}
        accountScoped={accountScoped}
        due
        selection={selection}
      />
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

/** how far the selection bar lifts the snackbar (its height and gap) */
const FLOAT_PX = 72;

type BulkKind = "paid" | "legacy" | "delete";

/**
 * Selection mode's bar, above the tab bar: end selection, how many are
 * chosen (or how far the writes have got), Delete and Mark as paid, each
 * through a sheet. Writes go one at a time and stop at the first error.
 */
function SelectionBar({
  rows,
  lookup,
  onRowsDone,
  onEnd,
}: {
  rows: Transaction[];
  lookup: TxLookup;
  /** these rows were written: they leave the selection */
  onRowsDone: (ids: string[]) => void;
  onEnd: () => void;
}) {
  const { t } = useI18n();
  const repo = useRepo();
  const rates = useRates();
  const queryClient = useQueryClient();
  const [sheet, setSheet] = useState<"paid" | "delete" | null>(null);
  const [progress, setProgress] = useState<{ kind: BulkKind; done: number; total: number } | null>(null);
  const plan = bulkPlan(rows, lookup.book, lookup.today);
  const ready = rates.data != null;
  const waiting = t("pocket.lists.waitingRates");

  // the bar floats above the tab bar: lift the snackbar over it
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--pocket-float", `${FLOAT_PX}px`);
    return () => {
      root.style.removeProperty("--pocket-float");
    };
  }, []);

  const bulk = useMutation({
    mutationFn: async ({ kind, targets }: { kind: BulkKind; targets: Transaction[] }) => {
      const table = rates.data;
      if (kind !== "delete" && !table) return;
      const snapshot = table ? snapshotFromTable(table) : null;
      const result = await runInTurn(
        targets,
        (tx) =>
          kind === "delete"
            ? repo.deleteTransaction(tx.id)
            : repo.completeTransaction(tx.id, snapshot!, undefined, kind === "legacy" ? true : undefined),
        (done, total) => setProgress({ kind, done, total })
      );
      // what was written is written: it leaves the selection either way
      onRowsDone(result.done.map((tx) => tx.id));
      if (result.failed) {
        showSnack(t("pocket.activity.stoppedAfter", { done: result.done.length, total: targets.length }));
        // the error toast (the QueryClient's MutationCache) says why
        throw result.failed.error;
      }
      showSnack(t(kind === "delete" ? "pocket.activity.deletedN" : "pocket.activity.markedPaidN", { count: result.done.length }));
      onEnd();
    },
    onSettled: async () => {
      setProgress(null);
      await Promise.all([KEYS.transactions, KEYS.accounts].map((key) => queryClient.invalidateQueries({ queryKey: key })));
    },
  });
  const run = (kind: BulkKind, targets: Transaction[]) => {
    setSheet(null);
    if (targets.length > 0) bulk.mutate({ kind, targets });
  };
  const busy = bulk.isPending;

  const count = rows.length;
  const summary = progress
    ? t(progress.kind === "delete" ? "pocket.activity.progressDelete" : "pocket.activity.progressPaid", {
        done: Math.min(progress.done + 1, progress.total),
        total: progress.total,
      })
    : count > 0
      ? t("pocket.activity.selectedN", { count })
      : t("pocket.activity.tapToSelect");

  const paidCount = plan.completable.length;
  const paidItem = { label: t("pocket.lists.markPaid"), icon: "check" as const, onSelect: () => run("paid", plan.completable) };
  const legacyItem = {
    label: t("pocket.activity.bulkPaidLegacy"),
    icon: "eyeOff" as const,
    hint: t("pocket.activity.bulkPaidLegacyHint"),
    onSelect: () => run("legacy", plan.completable),
  };
  // the usual choice first: as legacy when every row is long overdue
  const paidItems = plan.legacyFirst ? [{ ...legacyItem, tone: "primary" as const }, paidItem] : [{ ...paidItem, tone: "primary" as const }, legacyItem];
  const removeCount = plan.removable.length;

  return (
    <>
      <div
        role="region"
        aria-label={t("pocket.activity.selectedN", { count })}
        data-selection-bar
        className="no-print fixed inset-x-3 z-[41] flex min-h-[60px] items-center gap-1 rounded-2xl border border-[var(--edge)] bg-[var(--surface)] py-1.5 pl-1 pr-1.5 shadow-lg"
        style={{ bottom: "calc(var(--pocket-bottom, 56px) + 8px)" }}
      >
        <button
          type="button"
          onClick={onEnd}
          disabled={busy}
          aria-label={t("pocket.activity.endSelection")}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-zinc-500 active:bg-[var(--edge-soft)] disabled:opacity-50 dark:text-zinc-400"
        >
          <Icon name="close" size={20} />
        </button>
        <div className="min-w-0 flex-1">
          <p aria-live="polite" className="text-[14px] font-semibold leading-tight" data-selection-summary>
            {summary}
          </p>
          {ready || paidCount === 0 ? null : <p className="truncate text-[11px] text-amber-600 dark:text-amber-400">{waiting}</p>}
        </div>
        <button
          type="button"
          onClick={() => setSheet("delete")}
          disabled={busy || removeCount === 0}
          aria-label={t("pocket.activity.bulkDelete")}
          aria-haspopup="dialog"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-red-600 active:bg-[var(--edge-soft)] disabled:text-zinc-300 dark:text-red-400 dark:disabled:text-zinc-600"
        >
          <Icon name="trash" size={20} />
        </button>
        <button
          type="button"
          onClick={() => setSheet("paid")}
          disabled={busy || !ready || paidCount === 0}
          aria-haspopup="dialog"
          title={ready ? undefined : waiting}
          className="flex min-h-[44px] shrink-0 items-center justify-center rounded-xl bg-teal-600 px-3.5 py-2 text-[15px] font-semibold leading-tight text-white active:bg-teal-700 disabled:opacity-50 dark:bg-teal-500 dark:text-zinc-950 dark:active:bg-teal-400"
        >
          {t("pocket.lists.markPaid")}
        </button>
      </div>

      <PocketActionSheet
        open={sheet === "paid"}
        onClose={() => setSheet(null)}
        title={paidCount === 1 ? t("pocket.activity.bulkPaidOne") : t("pocket.activity.bulkPaidMany", { count: paidCount })}
        summary={<BulkSummary rows={plan.completable} lookup={lookup} skipped={plan.skipped} />}
        items={paidItems}
      />
      <PocketActionSheet
        open={sheet === "delete"}
        onClose={() => setSheet(null)}
        title={removeCount === 1 ? t("pocket.activity.bulkDeleteOne") : t("pocket.activity.bulkDeleteMany", { count: removeCount })}
        summary={<p className="text-sm text-zinc-600 dark:text-zinc-300">{t("pocket.activity.bulkDeleteHint")}</p>}
        items={[
          {
            label: removeCount === 1 ? t("pocket.activity.bulkDeleteOne") : t("pocket.activity.bulkDeleteMany", { count: removeCount }),
            icon: "trash",
            tone: "danger",
            onSelect: () => run("delete", plan.removable),
          },
        ]}
      />
    </>
  );
}

/** The rows a sheet will mark paid, summed where they share a currency, and what's left out. */
function BulkSummary({ rows, lookup, skipped }: { rows: Transaction[]; lookup: TxLookup; skipped: number }) {
  const { t } = useI18n();
  const byCurrency = new Map<Currency, number>();
  for (const tx of rows) {
    const currency = lookup.accountsById.get(tx.accountId)?.currency;
    if (!currency) continue;
    byCurrency.set(currency, (byCurrency.get(currency) ?? 0) + (tx.direction === "income" ? tx.amount : -tx.amount));
  }
  return (
    <div className="space-y-1 rounded-[var(--ui-card-radius)] bg-[var(--edge-soft)] px-4 py-3 text-sm">
      <p className="flex flex-wrap gap-x-3">
        {[...byCurrency].map(([currency, amount]) => (
          <Money key={currency} amount={amount} currency={currency} sign={amount > 0 ? "in" : "auto"} tone="auto" className="font-semibold" />
        ))}
      </p>
      {skipped > 0 ? <p className="text-xs text-zinc-500 dark:text-zinc-400">{t("pocket.activity.bulkSkipped", { count: skipped })}</p> : null}
    </div>
  );
}
