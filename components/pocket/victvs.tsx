"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useId, useMemo, useRef, useState } from "react";
import { AddModal, MarkPaidModal, PasteModal, typeBadgeTone } from "@/app/(app)/victvs/page";
import { EmptyState, Skeleton } from "@/components/ui";
import { useVictvsForecast, VictvsForecastView } from "@/components/victvsForecast";
import { useRepo } from "@/lib/data/provider";
import {
  KEYS,
  useAccounts,
  useAppMutation,
  useRates,
  useUserSettings,
  useVictvsPayouts,
  useVictvsSessions,
} from "@/lib/data/queries";
import { MarkPaidInput, NewVictvsSession } from "@/lib/data/repo";
import { DEFAULT_VICTVS_AMOUNTS, VictvsPayout, VictvsSession } from "@/lib/data/types";
import { snapshotFromTable } from "@/lib/domain/fx";
import { sumAmounts } from "@/lib/domain/money";
import { todayISO } from "@/lib/domain/recurrence";
import { useI18n } from "@/lib/i18n";
import { dayDate } from "@/lib/ui/pocket/dayGroups";
import { formatSigned } from "@/lib/ui/pocket/format";
import { POCKET_KEYS, usePocketFlag } from "@/lib/ui/pocket/prefs";
import { showSnack } from "@/lib/ui/pocket/snackbar";
import { replaceQuery } from "@/lib/ui/shallowUrl";
import {
  halfMonthRanges,
  lastDayOfMonth,
  toggleRange,
  unpaidSummary,
  VictvsFilter,
  VictvsMonth,
  victvsYears,
} from "@/lib/ui/pocket/victvsRanges";
import { Icon } from "./icons";
import { FitFigure, Money, PocketPage, Segmented } from "./kit";
import { PocketActionSheet } from "./sheet";

/**
 * Pocket's VICTVS (/victvs): what the sessions owe you, and marking them paid.
 *
 * - The summary: the unpaid total in USD (the Classic page's figure), how
 *   many sessions that is, "Select all unpaid" and "Add session". The header
 *   carries Paste (PasteModal); ?add=session (the Add menu) opens AddModal.
 * - Unpaid | Paid | All, then months, latest first. This year's months are
 *   open; earlier years fold under a row with their total. A month's head
 *   says how many, what they come to and how many are unpaid, with a
 *   "Select ▾" menu: 1–15, 16–end and all unpaid of the month — the Classic
 *   page's 1st half / 2nd half day bounds (lib/ui/pocket/victvsRanges.ts).
 * - A row is one button. An unpaid row toggles its selection (aria-pressed;
 *   the check circle is decorative); a paid row opens a sheet with Mark
 *   unpaid. Long-pressing an unpaid row (or its context menu) is a shortcut
 *   to Select / Delete session; the selection bar's ⋯ reaches Delete too.
 * - While something is selected, a bar floats above the tab bar:
 *   "3 selected · $157.50", Mark paid (MarkPaidModal with the default deposit
 *   account from Settings; disabled until live rates arrive) and ⋯ with
 *   Delete, armed by a second tap. Saving clears the selection.
 * - Payouts fold away at the bottom, each with Undo payout, armed.
 *
 * Paid sessions can't be deleted here, as on the Classic page: mark one
 * unpaid first. Writes are the Classic page's, with the same KEYS.
 */

const VICTVS_KEYS = [KEYS.victvsSessions, KEYS.victvsPayouts, KEYS.transactions, KEYS.accounts];
const MASK = "•••••";
/** how far the selection bar lifts the snackbar (its height and gap) */
const FLOAT_PX = 72;

const cardClass =
  "overflow-hidden rounded-[var(--ui-card-radius)] border border-[length:var(--ui-card-border)] border-[var(--edge)] bg-[var(--surface)] shadow-sm";
const primaryButton =
  "flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-teal-600 px-4 py-2 text-center text-[15px] font-semibold leading-tight text-white active:bg-teal-700 disabled:opacity-50 dark:bg-teal-500 dark:text-zinc-950 dark:active:bg-teal-400";
const secondaryButton =
  "flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-[var(--edge)] px-4 py-2 text-center text-[15px] font-medium leading-tight active:bg-[var(--edge-soft)] disabled:opacity-50";

const TYPE_TONE = {
  sky: "text-sky-700 dark:text-sky-300",
  green: "text-emerald-700 dark:text-emerald-400",
  amber: "text-amber-700 dark:text-amber-400",
  zinc: "text-zinc-600 dark:text-zinc-300",
} as const;

function monthName(month: string, locale: string, style: "long" | "short"): string {
  const [y, m] = month.split("-").map(Number);
  return new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-US", { month: style, timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, 1))
  );
}

/** "Oct 17" / "17 Eki", with the year only outside this one: short enough for a row's meta line. */
function shortDay(iso: string, locale: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-US", {
    month: "short",
    day: "numeric",
    year: iso.slice(0, 4) === todayISO().slice(0, 4) ? undefined : "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** The paste glyph for the header: a clipboard with lines. */
function PasteIcon() {
  return (
    <svg
      aria-hidden
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 3h6v3H9zM9 4.5H6a1 1 0 0 0-1 1V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V5.5a1 1 0 0 0-1-1h-3M9 11h6M9 15h4" />
    </svg>
  );
}

export function PocketVictvs() {
  // useSearchParams needs a Suspense boundary on a prerendered page
  return (
    <Suspense fallback={<VictvsSkeleton />}>
      <VictvsScreen />
    </Suspense>
  );
}

function VictvsSkeleton() {
  const { t } = useI18n();
  return (
    <PocketPage title={t("nav.victvs")}>
      <ListSkeleton />
    </PocketPage>
  );
}

function ListSkeleton() {
  return (
    <>
      <div aria-hidden className={`${cardClass} space-y-3 p-4`}>
        <Skeleton rows={1} className="w-24" />
        <div className="h-10 w-40 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800" />
        <div className="grid grid-cols-2 gap-2">
          <div className="h-11 animate-pulse rounded-xl bg-[var(--edge-soft)]" />
          <div className="h-11 animate-pulse rounded-xl bg-[var(--edge-soft)]" />
        </div>
      </div>
      <div aria-hidden className={`${cardClass} space-y-4 p-4`}>
        <Skeleton rows={1} className="w-28" />
        {[0, 1, 2].map((r) => (
          <div key={r} className="flex items-center gap-3">
            <div className="h-6 w-6 shrink-0 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800" />
            <Skeleton rows={2} className="flex-1" />
          </div>
        ))}
      </div>
    </>
  );
}

function VictvsScreen() {
  const { t, locale } = useI18n();
  const forecast = useVictvsForecast(12);
  const params = useSearchParams();
  const repo = useRepo();
  const sessions = useVictvsSessions();
  const payouts = useVictvsPayouts();
  const accounts = useAccounts();
  const rates = useRates();
  const settings = useUserSettings();
  const [hideAmounts] = usePocketFlag(POCKET_KEYS.hideAmounts);

  const [filter, setFilter] = useState<VictvsFilter>("all");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [openYears, setOpenYears] = useState<Set<string>>(() => new Set());
  const [pasteOpen, setPasteOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [rangeMonth, setRangeMonth] = useState<string | null>(null);
  const [sheetFor, setSheetFor] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [payoutsOpen, setPayoutsOpen] = useState(false);

  // ?add=session: open the form once, then take the parameter off the URL
  const addParam = params.get("add") === "session";
  const [seenAdd, setSeenAdd] = useState(false);
  if (addParam && !seenAdd) {
    setSeenAdd(true);
    setAddOpen(true);
  } else if (!addParam && seenAdd) {
    setSeenAdd(false);
  }
  useEffect(() => {
    // the same page: the URL changes in place (lib/ui/shallowUrl.ts)
    if (addParam) replaceQuery("/victvs");
  }, [addParam]);

  const createSessions = useAppMutation((inputs: NewVictvsSession[]) => repo.createVictvsSessions(inputs), [KEYS.victvsSessions]);
  const deleteSession = useAppMutation((id: string) => repo.deleteVictvsSession(id), [KEYS.victvsSessions]);
  const deleteSessions = useAppMutation(
    (ids: string[]) => Promise.all(ids.map((id) => repo.deleteVictvsSession(id))).then(() => undefined),
    [KEYS.victvsSessions]
  );
  const markPaid = useAppMutation((input: MarkPaidInput) => repo.markVictvsPaid(input), VICTVS_KEYS);
  const markUnpaid = useAppMutation((ids: string[]) => repo.markVictvsUnpaid(ids), [KEYS.victvsSessions]);
  const undoPayout = useAppMutation((id: string) => repo.unmarkVictvsPayout(id), VICTVS_KEYS);

  const defaults: Record<string, number> = { ...DEFAULT_VICTVS_AMOUNTS, ...(settings.data?.victvsDefaults ?? {}) };

  const all = useMemo(() => sessions.data ?? [], [sessions.data]);
  const years = useMemo(() => victvsYears(all, filter), [all, filter]);
  const summary = useMemo(() => unpaidSummary(all), [all]);
  // only unpaid sessions are ever selected; one paid or deleted elsewhere drops out
  const selectedUnpaid = all.filter((s) => s.status === "unpaid" && selected.has(s.id));
  const selectedTotal = sumAmounts("USD", selectedUnpaid.map((s) => s.amount));
  const selecting = selectedUnpaid.length > 0;
  const currentYear = todayISO().slice(0, 4);
  const usd = (amount: number) => formatSigned(amount, "USD", locale, "none");

  // the selection bar floats above the tab bar: lift the snackbar over it
  useEffect(() => {
    if (!selecting) return;
    const root = document.documentElement;
    root.style.setProperty("--pocket-float", `${FLOAT_PX}px`);
    return () => {
      root.style.removeProperty("--pocket-float");
    };
  }, [selecting]);

  const action = useMemo(
    () => (
      <button
        type="button"
        onClick={() => setPasteOpen(true)}
        aria-label={t("victvs.pasteButton")}
        aria-haspopup="dialog"
        className="flex h-11 w-11 items-center justify-center rounded-full text-teal-600 active:bg-[var(--edge-soft)] dark:text-teal-400"
      >
        <PasteIcon />
      </button>
    ),
    [t]
  );

  const loading = sessions.isLoading || accounts.isLoading || settings.isLoading;
  const condensed = loading ? undefined : t("pocket.cards.unpaidTotal", { amount: hideAmounts ? MASK : usd(summary.total) });
  const sessionsText = (count: number) =>
    count === 1 ? t("pocket.cards.sessionsOne") : t("pocket.cards.sessionsMany", { count });

  const toggle = (id: string) => setSelected((prev) => toggleRange(prev, [id]));
  const clearSelection = () => setSelected(new Set());
  const sheetSession = sheetFor ? all.find((s) => s.id === sheetFor) : undefined;
  const range = rangeMonth ? halfMonthRanges(all, rangeMonth) : null;
  const payoutList = [...(payouts.data ?? [])].sort((a, b) =>
    a.paymentDate !== b.paymentDate ? (a.paymentDate < b.paymentDate ? 1 : -1) : a.createdAt < b.createdAt ? 1 : -1
  );

  const monthCard = (m: VictvsMonth) => (
    <MonthCard
      key={m.month}
      month={m}
      selected={selected}
      onSelectMenu={() => setRangeMonth(m.month)}
      onToggle={toggle}
      onOpen={(s) => setSheetFor(s.id)}
      sessionsText={sessionsText}
    />
  );

  return (
    <PocketPage title={t("nav.victvs")} condensed={condensed} action={action}>
      {loading ? (
        <ListSkeleton />
      ) : all.length === 0 ? (
        <EmptyState
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <button type="button" onClick={() => setAddOpen(true)} className={primaryButton}>
                <Icon name="plus" size={18} />
                {t("victvs.addSession")}
              </button>
              <button type="button" onClick={() => setPasteOpen(true)} className={secondaryButton}>
                <PasteIcon />
                {t("victvs.pasteButton")}
              </button>
            </div>
          }
        >
          {t("victvs.empty")}
        </EmptyState>
      ) : (
        <>
          <section className={`${cardClass} p-4`} aria-label={t("pocket.cards.unpaidTotal", { amount: usd(summary.total) })} data-victvs-summary>
            <p className="text-[13px] text-zinc-500 dark:text-zinc-400">{t("victvs.unpaid")} · USD</p>
            <FitFigure>{usd(summary.total)}</FitFigure>
            <p className="text-[13px] text-zinc-500 dark:text-zinc-400">{sessionsText(summary.count)}</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={summary.count === 0}
                onClick={() => setSelected((prev) => toggleRange(prev, summary.ids))}
                className={secondaryButton}
              >
                {t("pocket.cards.selectAllUnpaid")}
              </button>
              <button type="button" onClick={() => setAddOpen(true)} aria-haspopup="dialog" className={primaryButton}>
                <Icon name="plus" size={18} />
                {t("victvs.addSession")}
              </button>
            </div>
          </section>

          {forecast ? (
            <section className={`${cardClass} p-4`} aria-labelledby="victvs-forecast-title">
              <h2 id="victvs-forecast-title" className="mb-2 text-[15px] font-semibold">
                {t("victvs.forecastTitle")}
              </h2>
              <VictvsForecastView forecast={forecast} initialRows={3} />
            </section>
          ) : null}

          <Segmented<VictvsFilter>
            label={t("common.status")}
            value={filter}
            options={[
              { value: "unpaid", label: t("victvs.unpaid") },
              { value: "paid", label: t("victvs.paid") },
              { value: "all", label: t("common.all") },
            ]}
            onChange={setFilter}
          />

          {years.length === 0 ? (
            <p className="px-1 py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">{t("pocket.cards.noneHere")}</p>
          ) : (
            years.map((y) => {
              if (y.year === currentYear) return <div key={y.year} className="space-y-4">{y.months.map(monthCard)}</div>;
              const open = openYears.has(y.year);
              return (
                <div key={y.year} className="space-y-4">
                  <YearRow
                    year={y.year}
                    meta={
                      <>
                        {sessionsText(y.count)} · <Money amount={y.total} currency="USD" sign="none" />
                      </>
                    }
                    open={open}
                    onToggle={() =>
                      setOpenYears((prev) => {
                        const next = new Set(prev);
                        if (next.has(y.year)) next.delete(y.year);
                        else next.add(y.year);
                        return next;
                      })
                    }
                  />
                  {open ? y.months.map(monthCard) : null}
                </div>
              );
            })
          )}

          {payoutList.length > 0 ? (
            <Payouts
              payouts={payoutList}
              open={payoutsOpen}
              onToggle={() => setPayoutsOpen((v) => !v)}
              accountName={(id) => accounts.data?.find((a) => a.id === id)?.name ?? "?"}
              sessionsText={sessionsText}
              busy={undoPayout.isPending}
              onUndo={(id) => undoPayout.mutate(id)}
            />
          ) : null}
        </>
      )}

      {selecting ? (
        <SelectionBar
          count={selectedUnpaid.length}
          total={selectedTotal}
          ratesReady={rates.data != null}
          onMarkPaid={() => setPayOpen(true)}
          onMore={() => setMoreOpen(true)}
          onExit={clearSelection}
        />
      ) : null}

      {/* a month's Select ▾ */}
      <PocketActionSheet
        open={range != null}
        onClose={() => setRangeMonth(null)}
        title={rangeMonth ? t("pocket.cards.selectIn", { month: monthName(rangeMonth, locale, "long") }) : ""}
        items={
          range && rangeMonth
            ? [
                {
                  label: t("pocket.cards.firstHalf", { month: monthName(rangeMonth, locale, "short"), count: range.first.length }),
                  disabled: range.first.length === 0,
                  onSelect: () => {
                    setSelected((prev) => toggleRange(prev, range.first));
                    setRangeMonth(null);
                  },
                },
                {
                  label: t("pocket.cards.secondHalf", {
                    last: lastDayOfMonth(rangeMonth),
                    month: monthName(rangeMonth, locale, "short"),
                    count: range.second.length,
                  }),
                  disabled: range.second.length === 0,
                  onSelect: () => {
                    setSelected((prev) => toggleRange(prev, range.second));
                    setRangeMonth(null);
                  },
                },
                {
                  label: t("pocket.cards.allUnpaidIn", { month: monthName(rangeMonth, locale, "long"), count: range.all.length }),
                  disabled: range.all.length === 0,
                  onSelect: () => {
                    setSelected((prev) => toggleRange(prev, range.all));
                    setRangeMonth(null);
                  },
                },
              ]
            : []
        }
      />

      {/* a paid row, or an unpaid row's long-press */}
      <PocketActionSheet
        open={sheetSession != null}
        onClose={() => setSheetFor(null)}
        title={sheetSession ? `${sheetSession.sessionType}${sheetSession.sessionNo ? ` · #${sheetSession.sessionNo}` : ""}` : ""}
        summary={
          sheetSession ? (
            <p className="text-[13px] text-zinc-500 dark:text-zinc-400">
              <Money amount={sheetSession.amount} currency="USD" sign="none" className="font-semibold text-zinc-900 dark:text-zinc-100" /> ·{" "}
              {dayDate(sheetSession.date, locale, true)} · {t(`victvs.${sheetSession.status}`)}
            </p>
          ) : null
        }
        items={
          !sheetSession
            ? []
            : sheetSession.status === "paid"
              ? [
                  {
                    label: t("victvs.markUnpaid"),
                    icon: "undo",
                    tone: "primary",
                    disabled: markUnpaid.isPending,
                    onSelect: () => {
                      markUnpaid.mutate([sheetSession.id]);
                      setSheetFor(null);
                    },
                  },
                ]
              : [
                  {
                    label: selected.has(sheetSession.id) ? t("pocket.cards.deselectSession") : t("pocket.cards.selectSession"),
                    icon: "checkCircle",
                    tone: "primary",
                    onSelect: () => {
                      toggle(sheetSession.id);
                      setSheetFor(null);
                    },
                  },
                  {
                    label: t("pocket.cards.deleteSession"),
                    icon: "trash",
                    tone: "danger",
                    onSelect: () => {
                      const id = sheetSession.id;
                      setSheetFor(null);
                      setSelected((prev) => {
                        const next = new Set(prev);
                        next.delete(id);
                        return next;
                      });
                      deleteSession.mutate(id, { onSuccess: () => showSnack(t("pocket.lists.deleted")) });
                    },
                  },
                ]
        }
      />

      {/* the selection bar's ⋯ */}
      <PocketActionSheet
        open={moreOpen && selecting}
        onClose={() => setMoreOpen(false)}
        title={t("victvs.selected", { count: selectedUnpaid.length })}
        items={[
          {
            label: t("pocket.cards.clearSelection"),
            icon: "close",
            onSelect: () => {
              setMoreOpen(false);
              clearSelection();
            },
          },
          {
            label:
              selectedUnpaid.length === 1
                ? t("pocket.cards.deleteSessionsOne")
                : t("pocket.cards.deleteSessionsMany", { count: selectedUnpaid.length }),
            icon: "trash",
            tone: "danger",
            disabled: deleteSessions.isPending,
            onSelect: () => {
              const ids = selectedUnpaid.map((s) => s.id);
              setMoreOpen(false);
              clearSelection();
              deleteSessions.mutate(ids, { onSuccess: () => showSnack(t("pocket.lists.deleted")) });
            },
          },
        ]}
      />

      <PasteModal
        open={pasteOpen}
        defaults={defaults}
        onClose={() => setPasteOpen(false)}
        onSave={async (rows) => {
          await createSessions.mutateAsync(
            rows.map((r) => ({
              date: r.date,
              sessionType: r.sessionType,
              sessionNo: r.sessionNo,
              amount: r.amount ?? defaults[r.sessionType] ?? 0,
              source: "paste" as const,
            }))
          );
          setPasteOpen(false);
        }}
      />

      <AddModal
        open={addOpen}
        defaults={defaults}
        onClose={() => setAddOpen(false)}
        onSave={async (input) => {
          await createSessions.mutateAsync([input]);
          setAddOpen(false);
        }}
      />

      <MarkPaidModal
        open={payOpen}
        onClose={() => setPayOpen(false)}
        sessions={selectedUnpaid}
        defaultAccountId={settings.data?.victvsAccountId ?? null}
        onConfirm={async (accountId, paymentDate, receivedAmount, categoryId, legacy) => {
          const total = selectedTotal;
          await markPaid.mutateAsync({
            sessionIds: selectedUnpaid.map((s) => s.id),
            accountId,
            paymentDate,
            receivedAmount,
            totalUsd: total,
            categoryId,
            fxSnapshot: rates.data ? snapshotFromTable(rates.data) : null,
            legacy,
          });
          clearSelection();
          setPayOpen(false);
          showSnack(t("pocket.lists.markedPaid", { amount: usd(total) }));
        }}
      />
    </PocketPage>
  );
}

/* ---------------------------------------------------------------- months */

function YearRow({ year, meta, open, onToggle }: { year: string; meta: React.ReactNode; open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      data-victvs-year={year}
      className="flex min-h-[48px] w-full items-center gap-2 rounded-[var(--ui-card-radius)] px-1 text-left active:bg-[var(--edge-soft)]"
    >
      <Icon name="chevron" size={18} className={`shrink-0 text-zinc-400 transition-transform ${open ? "rotate-90" : ""}`} />
      <span className="text-[17px] font-bold">{year}</span>
      <span className="min-w-0 flex-1 truncate text-right text-[13px] text-zinc-500 dark:text-zinc-400">{meta}</span>
    </button>
  );
}

function MonthCard({
  month,
  selected,
  onSelectMenu,
  onToggle,
  onOpen,
  sessionsText,
}: {
  month: VictvsMonth;
  selected: ReadonlySet<string>;
  onSelectMenu: () => void;
  onToggle: (id: string) => void;
  onOpen: (s: VictvsSession) => void;
  sessionsText: (count: number) => string;
}) {
  const { t, locale } = useI18n();
  const headId = useId();
  const name = monthName(month.month, locale, "long");
  return (
    <section className={cardClass} aria-labelledby={headId} data-victvs-month={month.month}>
      <div className="flex min-h-[48px] items-center gap-2 py-1.5 pl-4 pr-1">
        <div className="min-w-0 flex-1">
          <h2 id={headId} className="truncate text-[15px] font-semibold capitalize">
            {name}
          </h2>
          <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
            {sessionsText(month.items.length)} · <Money amount={month.total} currency="USD" sign="none" />
            {month.unpaidCount > 0 ? (
              <>
                {" · "}
                <span className="font-medium text-amber-600 dark:text-amber-400">{t("pocket.cards.unpaidN", { count: month.unpaidCount })}</span>
              </>
            ) : null}
          </p>
        </div>
        {month.unpaidCount > 0 ? (
          <button
            type="button"
            onClick={onSelectMenu}
            aria-haspopup="dialog"
            aria-label={t("pocket.cards.selectIn", { month: name })}
            className="flex h-11 shrink-0 items-center gap-0.5 rounded-full px-3 text-[13px] font-medium text-teal-600 active:bg-[var(--edge-soft)] dark:text-teal-400"
          >
            {t("pocket.cards.select")}
            <Icon name="chevron" size={16} className="rotate-90" />
          </button>
        ) : null}
      </div>
      <ul className="divide-y divide-[var(--edge-soft)] border-t border-[var(--edge-soft)]">
        {month.items.map((s) => (
          <li key={s.id}>
            <SessionRow
              session={s}
              selected={selected.has(s.id)}
              onToggle={() => onToggle(s.id)}
              onOpen={() => onOpen(s)}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Press-and-hold as a shortcut (450ms, cancelled by 10px of movement), and
 * the context menu (right click, the ContextMenu key) for the same thing.
 * `fired` swallows the click that may follow the hold.
 */
function useLongPress(onLong: () => void) {
  const state = useRef<{ timer: ReturnType<typeof setTimeout> | null; fired: boolean; x: number; y: number }>({
    timer: null,
    fired: false,
    x: 0,
    y: 0,
  });
  useEffect(() => {
    const s = state.current;
    return () => {
      if (s.timer) clearTimeout(s.timer);
    };
  }, []);
  const cancel = () => {
    if (state.current.timer) clearTimeout(state.current.timer);
    state.current.timer = null;
  };
  return {
    handlers: {
      onPointerDown: (e: React.PointerEvent) => {
        state.current.fired = false;
        if (e.button !== 0) return;
        state.current.x = e.clientX;
        state.current.y = e.clientY;
        cancel();
        state.current.timer = setTimeout(() => {
          state.current.timer = null;
          state.current.fired = true;
          navigator.vibrate?.(10);
          onLong();
        }, 450);
      },
      onPointerMove: (e: React.PointerEvent) => {
        if (state.current.timer && Math.hypot(e.clientX - state.current.x, e.clientY - state.current.y) > 10) cancel();
      },
      onPointerUp: cancel,
      onPointerCancel: cancel,
      onPointerLeave: cancel,
      onContextMenu: (e: React.MouseEvent) => {
        e.preventDefault();
        cancel();
        state.current.fired = true;
        onLong();
      },
    },
    /** true once after a hold: the click that follows it is not a tap */
    consumeFired: () => {
      const fired = state.current.fired;
      state.current.fired = false;
      return fired;
    },
  };
}

function SessionRow({
  session,
  selected,
  onToggle,
  onOpen,
}: {
  session: VictvsSession;
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const { t, locale } = useI18n();
  const unpaid = session.status === "unpaid";
  const press = useLongPress(onOpen);
  const date = dayDate(session.date, locale, session.date.slice(0, 4) !== todayISO().slice(0, 4));
  const amount = formatSigned(session.amount, "USD", locale, "none");
  const label = [
    `${session.sessionType}${session.sessionNo ? ` #${session.sessionNo}` : ""}`,
    date,
    amount,
    t(`victvs.${session.status}`),
  ].join(", ");

  return (
    <button
      type="button"
      aria-pressed={unpaid ? selected : undefined}
      aria-haspopup={unpaid ? undefined : "dialog"}
      aria-label={label}
      data-session-row={session.sessionNo || session.id}
      onClick={() => {
        if (press.consumeFired()) return;
        if (unpaid) onToggle();
        else onOpen();
      }}
      {...(unpaid ? press.handlers : {})}
      className={`flex min-h-[var(--pocket-row,56px)] w-full select-none items-center gap-3 px-4 py-2 text-left [-webkit-touch-callout:none] ${
        selected
          ? "bg-teal-50 shadow-[inset_4px_0_0_var(--color-teal-600)] dark:bg-teal-950"
          : "active:bg-[var(--edge-soft)]"
      }`}
    >
      {unpaid ? (
        <span
          aria-hidden
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${
            selected
              ? "border-teal-600 bg-teal-600 text-white dark:border-teal-500 dark:bg-teal-500 dark:text-zinc-950"
              : "border-zinc-300 dark:border-zinc-600"
          }`}
        >
          {selected ? <Icon name="check" size={14} /> : null}
        </span>
      ) : (
        <span aria-hidden className="flex h-6 w-6 shrink-0 items-center justify-center text-emerald-600 dark:text-emerald-400">
          <Icon name="check" size={20} />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium">
          <span className={TYPE_TONE[typeBadgeTone(session.sessionType)]}>{session.sessionType || "—"}</span>
          {session.sessionNo ? <span className="font-normal text-zinc-400"> · #{session.sessionNo}</span> : null}
        </span>
        <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">{date}</span>
      </span>
      <Money
        amount={session.amount}
        currency="USD"
        sign="none"
        className={`shrink-0 text-[15px] font-semibold ${unpaid ? "" : "text-zinc-500 dark:text-zinc-400"}`}
      />
    </button>
  );
}

/* ------------------------------------------------------- selection bar */

function SelectionBar({
  count,
  total,
  ratesReady,
  onMarkPaid,
  onMore,
  onExit,
}: {
  count: number;
  total: number;
  ratesReady: boolean;
  onMarkPaid: () => void;
  onMore: () => void;
  onExit: () => void;
}) {
  const { t } = useI18n();
  const waiting = t("pocket.lists.waitingRates");
  return (
    <div
      role="region"
      aria-label={t("victvs.selected", { count })}
      data-selection-bar
      className="no-print fixed inset-x-3 z-[41] flex min-h-[60px] items-center gap-1 rounded-2xl border border-[var(--edge)] bg-[var(--surface)] py-1.5 pl-1 pr-1.5 shadow-lg"
      style={{ bottom: "calc(var(--pocket-bottom, 56px) + 8px)" }}
    >
      <button
        type="button"
        onClick={onExit}
        aria-label={t("pocket.cards.clearSelection")}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-zinc-500 active:bg-[var(--edge-soft)] dark:text-zinc-400"
      >
        <Icon name="close" size={20} />
      </button>
      <div className="min-w-0 flex-1">
        {/* wraps before the figure rather than cutting it off when the button's label is long */}
        <p className="text-[14px] leading-tight" data-selection-summary>
          <span className="font-semibold">{t("victvs.selected", { count })}</span>
          {" · "}
          <Money amount={total} currency="USD" sign="none" className="font-semibold" />
        </p>
        {ratesReady ? null : <p className="truncate text-[11px] text-amber-600 dark:text-amber-400">{waiting}</p>}
      </div>
      <button
        type="button"
        onClick={onMore}
        aria-label={t("pocket.cards.moreActions")}
        aria-haspopup="dialog"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-zinc-600 active:bg-[var(--edge-soft)] dark:text-zinc-300"
      >
        <Icon name="more" size={22} />
      </button>
      <button
        type="button"
        onClick={onMarkPaid}
        disabled={!ratesReady}
        aria-haspopup="dialog"
        title={ratesReady ? undefined : waiting}
        className={`${primaryButton} shrink-0 px-3.5`}
      >
        {t("victvs.markPaid")}
      </button>
    </div>
  );
}

/* --------------------------------------------------------------- payouts */

function Payouts({
  payouts,
  open,
  onToggle,
  accountName,
  sessionsText,
  busy,
  onUndo,
}: {
  payouts: VictvsPayout[];
  open: boolean;
  onToggle: () => void;
  accountName: (id: string) => string;
  sessionsText: (count: number) => string;
  busy: boolean;
  onUndo: (id: string) => void;
}) {
  const { t, locale } = useI18n();
  const listId = useId();
  const [armed, setArmed] = useState<string | null>(null);

  useEffect(() => {
    if (armed == null) return;
    const timer = setTimeout(() => setArmed(null), 4000);
    return () => clearTimeout(timer);
  }, [armed]);

  return (
    <section className={cardClass} data-victvs-payouts>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={listId}
        className="flex min-h-[48px] w-full items-center gap-2 px-4 text-left active:bg-[var(--edge-soft)]"
      >
        <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{t("pocket.cards.payoutsN", { count: payouts.length })}</span>
        <Icon name="chevron" size={18} className={`shrink-0 text-zinc-400 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open ? (
        <ul id={listId} className="divide-y divide-[var(--edge-soft)] border-t border-[var(--edge-soft)]">
          {payouts.map((p) => {
            const isArmed = armed === p.id;
            return (
              <li key={p.id} className="flex min-h-[var(--pocket-row,56px)] items-center gap-2 py-2 pl-4 pr-1.5">
                <div className="min-w-0 flex-1">
                  <Money amount={p.total} currency="USD" sign="in" tone="pos" className="text-[15px] font-semibold" />
                  <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                    {t("pocket.cards.payoutLine", {
                      sessions: sessionsText(p.sessionCount),
                      account: accountName(p.accountId),
                      date: shortDay(p.paymentDate, locale),
                    })}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (!isArmed) {
                      setArmed(p.id);
                      return;
                    }
                    setArmed(null);
                    onUndo(p.id);
                  }}
                  className={`flex min-h-[44px] max-w-[11rem] shrink-0 items-center rounded-xl px-3 text-right text-[13px] font-medium leading-tight active:bg-[var(--edge-soft)] disabled:opacity-50 ${
                    isArmed ? "text-red-600 dark:text-red-400" : "text-teal-600 dark:text-teal-400"
                  }`}
                >
                  {isArmed ? t("pocket.tapAgain") : t("victvs.undoPayout")}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
