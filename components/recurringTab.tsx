"use client";

import Link from "next/link";
import { ReactNode, useMemo, useState } from "react";
import { DebtModal } from "@/components/debtModal";
import { LabelColorSettings } from "@/components/labelColorPicker";
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Select, Spinner } from "@/components/ui";
import { useRepo } from "@/lib/data/provider";
import { KEYS, useAccounts, useAppMutation, useCategories, useRates, useTemplates, useTransactions } from "@/lib/data/queries";
import { NewTemplate } from "@/lib/data/repo";
import { Frequency, RecurringTemplate, TxDirection } from "@/lib/data/types";
import { formatAmount } from "@/lib/domain/currencies";
import { snapshotFromTable } from "@/lib/domain/fx";
import {
  BackfillMode,
  firstOccurrenceFrom,
  MATERIALIZE_MONTHS_AHEAD,
  pastOccurrences,
  rowsReplacedByEdit,
} from "@/lib/domain/materialize";
import { CombineSuggestion, combineSuggestions, incomeSeries, raise } from "@/lib/domain/incomeSeries";
import { addDays, todayISO } from "@/lib/domain/recurrence";
import { TemplateProgress, TemplateStatus, templateProgress } from "@/lib/domain/templateStatus";
import { useI18n } from "@/lib/i18n";
import { RECURRING_STATUS_FILTER_KEY, useLocalChoice } from "@/lib/prefs";
import { LABELED_STATUSES, LabelColor, LabeledStatus, SWATCH_CLASS, useLabelColor } from "@/lib/ui/labelColors";
import { useFormatDate } from "@/lib/useFormatDate";
import { loanHref } from "@/lib/ui/portfolioUrl";

type StatusFilter = "all" | TemplateStatus;
const STATUS_FILTERS: readonly StatusFilter[] = ["all", "active", "notStarted", "toConfirm", "completed"];
/** Transactions' two tabs of recurring items: what comes in, and what goes out. */
export type RecurringKind = "income" | "bills";

const BACKFILL_MODES: readonly BackfillMode[] = ["paid", "confirm", "fromToday"];

/** Under "All": what needs a tap first, finished items last. */
const STATUS_RANK: Record<TemplateStatus, number> = { toConfirm: 0, active: 1, notStarted: 2, completed: 3 };

const segmentClass = (on: boolean) =>
  `whitespace-nowrap rounded-md px-2.5 py-1 text-sm transition-colors ${
    on ? "bg-teal-600 text-white dark:bg-teal-500 dark:text-zinc-950" : "text-zinc-500 hover:bg-[var(--edge-soft)]"
  }`;

/**
 * The recurring items that write the ledger's planned rows, as two of the
 * Transactions page's tabs: Income (income items; an income's periods, a
 * salary with raises, show as one card with its earlier amounts, and "Give
 * a raise" starts the next; items that look like one income entered year by
 * year are offered as one) and Bills (everything that goes out, a debt's
 * repayments included, linked to the debt). `tabs` is the page's tab strip,
 * shown under the header like on the Cards page.
 */
export function RecurringTab({ tabs, kind }: { tabs: ReactNode; kind: RecurringKind }) {
  const { t, locale } = useI18n();
  const repo = useRepo();
  const templates = useTemplates();
  const accounts = useAccounts();
  const transactions = useTransactions();
  const rates = useRates();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<RecurringTemplate | null>(null);
  const [moving, setMoving] = useState<RecurringTemplate | null>(null);
  const [deleting, setDeleting] = useState<RecurringTemplate | null>(null);
  const [colorsOpen, setColorsOpen] = useState(false);
  const [raising, setRaising] = useState<RecurringTemplate | null>(null);
  const statusFilter = useLocalChoice<StatusFilter>(RECURRING_STATUS_FILTER_KEY, STATUS_FILTERS, "all");
  const combine = useCombineSuggestions();
  const direction: TxDirection = kind === "income" ? "income" : "expense";
  const labelColors: Record<LabeledStatus, LabelColor> = {
    completed: useLabelColor("completed")[0],
    notStarted: useLabelColor("notStarted")[0],
    toConfirm: useLabelColor("toConfirm")[0],
  };

  const progressById = useMemo(() => {
    const today = todayISO();
    const map = new Map<string, TemplateProgress>();
    for (const tpl of templates.data ?? []) map.set(tpl.id, templateProgress(tpl, transactions.data ?? [], today));
    return map;
  }, [templates.data, transactions.data]);

  const keys = [KEYS.templates, KEYS.transactions];
  const createTemplate = useAppMutation(
    async (v: { input: NewTemplate; backfill: BackfillMode | null }) => {
      const fxSnapshot = rates.data ? snapshotFromTable(rates.data) : null;
      await repo.createTemplate(v.input, v.backfill ? { mode: v.backfill, fxSnapshot } : undefined);
      await repo.materializeTemplates(MATERIALIZE_MONTHS_AHEAD);
    },
    keys
  );
  const updateTemplate = useAppMutation(
    async (v: { id: string; patch: Partial<NewTemplate> }) => {
      await repo.updateTemplate(v.id, v.patch);
    },
    keys
  );
  const deleteTemplate = useAppMutation(
    (v: { id: string; deletePlanned: boolean }) => repo.deleteTemplate(v.id, v.deletePlanned),
    keys
  );

  if (templates.isLoading || accounts.isLoading || transactions.isLoading) return <Spinner />;

  const list = (templates.data ?? []).filter((tpl) => tpl.direction === direction);
  const accountById = new Map((accounts.data ?? []).map((a) => [a.id, a]));
  const statusOf = (tpl: RecurringTemplate) => progressById.get(tpl.id)?.status ?? "active";
  const money = (tpl: RecurringTemplate, amount = tpl.amount) => {
    const account = accountById.get(tpl.accountId);
    return account ? formatAmount(amount, account.currency, locale) : String(amount);
  };

  // an income is one card however many raises it had: its current period, the earlier ones under it
  const series = kind === "income" ? incomeSeries(list, todayISO()) : null;
  const byDirection = series ? series.map((s) => s.current) : list;
  const seriesOf = new Map(series?.map((s) => [s.current.id, s]) ?? []);
  const period = (p: RecurringTemplate) => ({ id: p.id, amount: money(p), from: p.startDate, to: p.endDate });
  const counts: Record<StatusFilter, number> = { all: byDirection.length, active: 0, notStarted: 0, toConfirm: 0, completed: 0 };
  for (const tpl of byDirection) counts[statusOf(tpl)]++;
  const shown = byDirection
    .filter((tpl) => statusFilter.value === "all" || statusOf(tpl) === statusFilter.value)
    .map((tpl, i) => ({ tpl, i }))
    .sort((a, b) => STATUS_RANK[statusOf(a.tpl)] - STATUS_RANK[statusOf(b.tpl)] || a.i - b.i)
    .map(({ tpl }) => tpl);
  // Rare statuses only get a chip when there is something under them (or it's the one selected).
  const statusChips = STATUS_FILTERS.filter(
    (s) => s === "all" || s === "active" || s === "completed" || counts[s] > 0 || statusFilter.value === s
  );

  return (
    <div className="mx-auto max-w-5xl space-y-4 3xl:max-w-7xl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">{t("tx.title")}</h1>
        <Button variant="primary" onClick={() => setModalOpen(true)}>
          + {kind === "income" ? t("income.newIncome") : t("income.newBill")}
        </Button>
      </div>

      {tabs}
      <p className="text-xs text-zinc-500">
        {t("recurring.materialized")}
        {kind === "bills" && list.some((tpl) => tpl.loanId) ? ` ${t("income.debtsHint")}` : ""}
      </p>

      {kind === "income" ? <CombineCard templates={list} combine={combine} /> : null}

      {list.length === 0 ? (
        <EmptyState>{kind === "income" ? t("income.emptyIncome") : t("income.emptyBills")}</EmptyState>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div role="group" aria-label={t("recurring.filterStatus")} className="flex flex-wrap rounded-lg border border-[var(--edge)] p-0.5">
              {statusChips.map((s) => (
                <button key={s} type="button" aria-pressed={statusFilter.value === s} onClick={() => statusFilter.setValue(s)} className={segmentClass(statusFilter.value === s)}>
                  {t(`recurring.status_${s}`)} <span className="tabular-nums opacity-70">{counts[s]}</span>
                </button>
              ))}
            </div>
            <Button variant="ghost" className="ml-auto" onClick={() => setColorsOpen(true)}>
              <span aria-hidden className="inline-flex -space-x-1">
                {LABELED_STATUSES.map((s) => (
                  <span key={s} className={`h-3 w-3 rounded-full ring-2 ring-[var(--surface)] ${SWATCH_CLASS[labelColors[s]]}`} />
                ))}
              </span>
              {t("recurring.labelColors")}
            </Button>
          </div>

          {shown.length === 0 ? (
            <EmptyState
              action={
                <Button
                  onClick={() => statusFilter.setValue("all")}
                >
                  {t("recurring.showAll")}
                </Button>
              }
            >
              {t("recurring.noneMatch")}
            </EmptyState>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 3xl:grid-cols-4">
              {shown.map((tpl) => (
                <TemplateCard
                  key={tpl.id}
                  tpl={tpl}
                  progress={progressById.get(tpl.id)}
                  amount={money(tpl)}
                  accountName={accountById.get(tpl.accountId)?.name}
                  colors={labelColors}
                  earlier={mergeSameAmount((seriesOf.get(tpl.id)?.earlier ?? []).map(period))}
                  later={(seriesOf.get(tpl.id)?.later ?? []).map(period)}
                  onEdit={() => setEditing(tpl)}
                  onRaise={(() => {
                    // the next raise follows the last one, even one that hasn't started yet
                    const latest = seriesOf.get(tpl.id)?.latest ?? tpl;
                    return kind === "income" && progressById.get(latest.id)?.status !== "completed" ? () => setRaising(latest) : undefined;
                  })()}
                />
              ))}
            </div>
          )}
        </>
      )}

      <Modal open={colorsOpen} onClose={() => setColorsOpen(false)} title={t("recurring.labelColors")}>
        <p className="mb-3 text-sm text-zinc-500">{t("recurring.labelColorsHint")}</p>
        <LabelColorSettings />
      </Modal>

      <RaiseModal tpl={raising} onClose={() => setRaising(null)} />

      <TemplateModal
        open={modalOpen || editing != null}
        initial={editing}
        defaultDirection={direction}
        onClose={() => {
          setModalOpen(false);
          setEditing(null);
        }}
        onSave={async (input, backfill) => {
          if (editing) await updateTemplate.mutateAsync({ id: editing.id, patch: input });
          else await createTemplate.mutateAsync({ input, backfill });
          setModalOpen(false);
          setEditing(null);
        }}
        onDelete={
          editing
            ? async () => {
                setDeleting(editing);
                setEditing(null);
              }
            : undefined
        }
        onMoveToDebts={() => {
          setMoving(editing);
          setEditing(null);
        }}
      />
      <DebtModal open={moving != null} onClose={() => setMoving(null)} from={moving ? { kind: "template", template: moving } : null} />

      {/* Three explicit answers. A yes/no "also delete its planned items?"
          read as "cancel the delete" on No, and quietly left every future
          payment in the plan. */}
      <Modal
        open={deleting != null}
        onClose={() => setDeleting(null)}
        title={deleting ? t("recurring.deleteTitle", { name: deleting.name }) : ""}
      >
        {deleting ? (
          <div className="space-y-4">
            <p className="text-sm text-zinc-500">
              {t("recurring.deleteHint", {
                count: (transactions.data ?? []).filter((tx) => tx.recurringTemplateId === deleting.id && tx.status === "planned").length,
              })}
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button type="button" onClick={() => setDeleting(null)}>
                {t("common.cancel")}
              </Button>
              <Button
                type="button"
                variant="danger"
                disabled={deleteTemplate.isPending}
                onClick={async () => {
                  await deleteTemplate.mutateAsync({ id: deleting.id, deletePlanned: false });
                  setDeleting(null);
                }}
              >
                {t("recurring.deleteKeepPlanned")}
              </Button>
              <Button
                type="button"
                variant="danger"
                disabled={deleteTemplate.isPending}
                onClick={async () => {
                  await deleteTemplate.mutateAsync({ id: deleting.id, deletePlanned: true });
                  setDeleting(null);
                }}
              >
                {t("recurring.deleteWithPlanned")}
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function TemplateCard({
  tpl,
  progress,
  amount,
  accountName,
  colors,
  earlier = [],
  later = [],
  onEdit,
  onRaise,
}: {
  tpl: RecurringTemplate;
  progress: TemplateProgress | undefined;
  amount: string;
  accountName: string | undefined;
  colors: Record<LabeledStatus, LabelColor>;
  /** an income's earlier periods, latest first, its amounts formatted */
  earlier?: Array<{ id: string; amount: string; from: string; to: string | null }>;
  /** its periods still to start (a raise ahead), earliest first */
  later?: Array<{ id: string; amount: string; from: string; to: string | null }>;
  onEdit: () => void;
  onRaise?: () => void;
}) {
  const { t } = useI18n();
  const formatDate = useFormatDate();
  const status = progress?.status ?? "active";
  const finished = status === "completed";

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{tpl.name}</span>
            {finished ? <Badge tone={colors.completed}>✓ {t("recurring.status_completed")}</Badge> : null}
            {status === "notStarted" ? <Badge tone={colors.notStarted}>{t("recurring.status_notStarted")}</Badge> : null}
            {progress && progress.open > 0 ? (
              <Badge tone={colors.toConfirm}>{t("recurring.openCount", { count: progress.open })}</Badge>
            ) : null}
            {/* the loan writes this item; it's changed from the loan, in the Portfolio's Debts view */}
            {tpl.loanId ? (
              <Link href={loanHref(tpl.loanId)} className="hover:opacity-80">
                <Badge tone="sky">{t("recurring.linkedLoan")} →</Badge>
              </Link>
            ) : null}
            {/* nothing left to auto-complete once it's finished */}
            {tpl.autoComplete && !finished ? <Badge tone="green">{t("recurring.autoComplete")}</Badge> : null}
          </div>
          <div className={finished ? "opacity-60" : undefined}>
            <div className={`mt-1 text-lg font-bold tabular-nums ${tpl.direction === "income" ? "text-emerald-600" : ""}`}>
              {tpl.direction === "income" ? "+" : "−"}
              {amount}
            </div>
            <div className="mt-0.5 text-xs text-zinc-500">
              {t(`recurring.${tpl.frequency}`)} · {accountName} · {tpl.startDate}
              {tpl.endDate ? ` → ${tpl.endDate}` : ""}
            </div>
            {progress ? (
              <ProgressLine progress={progress} barClass={finished ? SWATCH_CLASS[colors.completed] : "bg-teal-600 dark:bg-teal-500"} />
            ) : null}
            {later.length > 0 ? (
              <div className="mt-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400" data-income-later>
                {later.map((p) => t("income.then", { amount: p.amount, date: formatDate(p.from) })).join(" · ")}
              </div>
            ) : null}
            {earlier.length > 0 ? (
              <div className="mt-1.5 text-xs text-zinc-500" data-income-earlier>
                {t("income.earlier", {
                  list: earlier
                    .map((p) => t("income.earlierItem", { amount: p.amount, from: formatDate(p.from), to: p.to ? formatDate(p.to) : "—" }))
                    .join(" · "),
                })}
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {!tpl.loanId ? (
            <Button variant="ghost" onClick={onEdit}>
              {t("common.edit")}
            </Button>
          ) : null}
          {onRaise ? (
            <Button variant="ghost" onClick={onRaise}>
              {t("income.giveRaise")}
            </Button>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

/** "3 of 7 done · Next 26 Oct" with a thin bar when the schedule has an end. */
function ProgressLine({ progress, barClass }: { progress: TemplateProgress; barClass: string }) {
  const { t } = useI18n();
  const formatDate = useFormatDate();
  const { done, total, next, last } = progress;
  const parts: string[] = [];
  if (total != null) parts.push(t("recurring.progress", { done, total }));
  if (next) parts.push(t("recurring.next", { date: formatDate(next) }));
  else if (last) parts.push(t("recurring.lastOn", { date: formatDate(last) }));
  if (!parts.length) return null;

  return (
    <div className="mt-2 space-y-1">
      {total ? (
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={Math.min(done, total)}
          aria-label={t("recurring.progress", { done, total })}
          className="h-1 overflow-hidden rounded-full bg-[var(--edge-soft)]"
        >
          <div className={`h-full rounded-full ${barClass}`} style={{ width: `${Math.min(100, (done / total) * 100)}%` }} />
        </div>
      ) : null}
      <div className="text-xs tabular-nums text-zinc-500">{parts.join(" · ")}</div>
    </div>
  );
}

export function TemplateModal({
  open,
  initial,
  onClose,
  onSave,
  onDelete,
  onMoveToDebts,
  defaultDirection = "expense",
}: {
  open: boolean;
  initial: RecurringTemplate | null;
  /** a new item's direction: the tab it's made from */
  defaultDirection?: TxDirection;
  onClose: () => void;
  /** backfill: what to do with the dates already passed; null when there are none to ask about */
  onSave: (input: NewTemplate, backfill: BackfillMode | null) => Promise<void>;
  onDelete?: () => Promise<void>;
  /** offered on a monthly item that isn't a debt yet: its payments become a debt's (components/debtModal.tsx) */
  onMoveToDebts?: () => void;
}) {
  const { t } = useI18n();
  const formatDate = useFormatDate();
  const accounts = useAccounts();
  const categories = useCategories();
  const transactions = useTransactions();
  const [name, setName] = useState("");
  const [accountId, setAccountId] = useState("");
  const [direction, setDirection] = useState<TxDirection>("expense");
  const [categoryId, setCategoryId] = useState("");
  const [amount, setAmount] = useState("");
  const [frequency, setFrequency] = useState<Frequency>("monthly");
  const [startDate, setStartDate] = useState(todayISO());
  const [endDate, setEndDate] = useState("");
  const [autoComplete, setAutoComplete] = useState(false);
  const [backfill, setBackfill] = useState<BackfillMode>("confirm");
  const [saving, setSaving] = useState(false);
  const [initialized, setInitialized] = useState<string | null>(null);

  const targetKey = initial?.id ?? (open ? "new" : "closed");
  // Forget the last form once closed, so the next open starts from `initial`
  // again instead of the previous entry's leftovers.
  if (!open && initialized !== null) setInitialized(null);
  if (open && initialized !== targetKey) {
    setInitialized(targetKey);
    setName(initial?.name ?? "");
    setAccountId(initial?.accountId ?? "");
    setDirection(initial?.direction ?? defaultDirection);
    setCategoryId(initial?.categoryId ?? "");
    setAmount(initial ? String(initial.amount) : "");
    setFrequency(initial?.frequency ?? "monthly");
    setStartDate(initial?.startDate ?? todayISO());
    setEndDate(initial?.endDate ?? "");
    setAutoComplete(initial?.autoComplete ?? false);
    setBackfill("confirm");
  }

  const active = (accounts.data ?? []).filter((a) => !a.archived);
  const effectiveAccount = accountId || active[0]?.id || "";
  const dirCategories = (categories.data ?? []).filter((c) => c.direction === direction);

  // Only a new item asks about the dates its schedule has already passed: an
  // existing one has its past in the ledger already.
  const today = todayISO();
  const spec = { frequency, startDate, endDate: endDate || null };
  const past = !initial && startDate ? pastOccurrences(spec, today) : [];
  const nextDate = past.length ? firstOccurrenceFrom(spec, today) : null;
  // "start from today" means nothing once the schedule has ended
  const modes = BACKFILL_MODES.filter((m) => m !== "fromToday" || nextDate != null);
  const backfillMode = modes.includes(backfill) ? backfill : "confirm";
  // an edit redoes what's scheduled from today on (see updateTemplate)
  const replacing = initial ? rowsReplacedByEdit(initial.id, endDate || null, transactions.data ?? [], today).length : 0;
  const pastLabel =
    past.length === 1
      ? t("recurring.pastItemsOne", { date: formatDate(past[0]) })
      : t("recurring.pastItems", { count: past.length, date: formatDate(past[0]) });

  return (
    <Modal open={open} onClose={onClose} title={initial ? t("common.edit") : t("recurring.newTemplate")}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (saving) return; // double-Enter guard: one template, not two
          setSaving(true);
          try {
            await onSave({
              name,
              accountId: effectiveAccount,
              direction,
              categoryId: categoryId || null,
              amount: Number(amount),
              frequency,
              startDate,
              endDate: endDate || null,
              autoComplete,
            }, past.length ? backfillMode : null);
          } finally {
            setSaving(false);
          }
        }}
      >
        <Field label={t("common.name")}>
          <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Rent" />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant={direction === "expense" ? "primary" : "secondary"} onClick={() => setDirection("expense")}>
            {t("tx.expense")}
          </Button>
          <Button type="button" variant={direction === "income" ? "primary" : "secondary"} onClick={() => setDirection("income")}>
            {t("tx.income")}
          </Button>
        </div>
        <Field label={t("common.account")}>
          <Select required value={effectiveAccount} onChange={(e) => setAccountId(e.target.value)}>
            {active.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.currency})
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("common.amount")}>
            <Input type="number" step="any" min="0" required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label={t("common.category")}>
            <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">{t("common.none")}</option>
              {dirCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label={t("recurring.frequency")}>
          <Select value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)}>
            <option value="weekly">{t("recurring.weekly")}</option>
            <option value="monthly">{t("recurring.monthly")}</option>
            <option value="yearly">{t("recurring.yearly")}</option>
          </Select>
        </Field>
        {/* two to a row: three left each date too narrow to show its year */}
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("recurring.startDate")}>
            <Input type="date" required value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
          <Field label={`${t("recurring.endDate")} (${t("common.optional")})`}>
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </Field>
        </div>
        {past.length ? (
          <div role="radiogroup" aria-label={pastLabel} className="space-y-2 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800/60">
            <p className="text-sm font-medium">{pastLabel}</p>
            {modes.map((m) => (
              <label key={m} className="flex items-start gap-2">
                <input
                  type="radio"
                  name="backfill"
                  checked={backfillMode === m}
                  onChange={() => setBackfill(m)}
                  className="mt-0.5 h-4 w-4 accent-teal-600"
                />
                <span>
                  <span className="block text-sm">{t(`recurring.backfill_${m}`)}</span>
                  <span className="block text-xs text-zinc-500">
                    {t(`recurring.backfill_${m}Hint`, { date: nextDate ? formatDate(nextDate) : "" })}
                  </span>
                </span>
              </label>
            ))}
          </div>
        ) : null}
        <label className="flex items-start gap-2 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800/60">
          <input type="checkbox" checked={autoComplete} onChange={(e) => setAutoComplete(e.target.checked)} className="mt-0.5 h-4 w-4 accent-teal-600" />
          <span>
            <span className="block text-sm font-medium">{t("recurring.autoComplete")}</span>
            <span className="block text-xs text-zinc-500">{t("recurring.autoCompleteHint")}</span>
          </span>
        </label>
        {replacing ? (
          <p className="text-xs text-zinc-500">
            {replacing === 1 ? t("recurring.updatesUpcomingOne") : t("recurring.updatesUpcoming", { count: replacing })}
          </p>
        ) : null}
        <div className="flex flex-wrap justify-between gap-2 pt-1">
          <div className="flex flex-wrap gap-2">
            {onDelete ? (
              <Button type="button" variant="danger" onClick={onDelete}>
                {t("common.delete")}
              </Button>
            ) : null}
            {onMoveToDebts && initial && initial.frequency === "monthly" && !initial.loanId ? (
              <Button type="button" onClick={onMoveToDebts} title={t("debts.moveHint")}>
                {t("debts.moveToDebts")}
              </Button>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button type="button" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="primary" disabled={saving}>
              {t("common.save")}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

/** Earlier periods, latest first, with the same amount back to back read as one stretch: "WBL 2024" and "WBL 2025" at $1,679. */
function mergeSameAmount<T extends { amount: string; from: string; to: string | null }>(periods: T[]): T[] {
  const out: T[] = [];
  for (const p of periods) {
    const last = out[out.length - 1];
    if (last && last.amount === p.amount) out[out.length - 1] = { ...last, from: p.from };
    else out.push(p);
  }
  return out;
}

const COMBINE_DISMISSED_KEY = "renovator-income-combine-dismissed";

/** "Not the same" answers, kept on this device: a suggestion said no to doesn't come back. */
function useCombineSuggestions() {
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(window.localStorage.getItem(COMBINE_DISMISSED_KEY) ?? "[]") as string[]);
    } catch {
      return new Set();
    }
  });
  const dismiss = (key: string) =>
    setDismissed((prev) => {
      const next = new Set(prev).add(key);
      try {
        window.localStorage.setItem(COMBINE_DISMISSED_KEY, JSON.stringify([...next]));
      } catch {
        // no storage: it's back next time
      }
      return next;
    });
  return { dismissed, dismiss };
}

/** Items that look like one income entered year by year, offered as one series. */
function CombineCard({ templates, combine }: { templates: RecurringTemplate[]; combine: ReturnType<typeof useCombineSuggestions> }) {
  const { t } = useI18n();
  const repo = useRepo();
  const join = useAppMutation(async (s: CombineSuggestion) => {
    // the series is the earliest one's id, as a raise would have made it
    for (const tpl of s.templates) await repo.updateTemplate(tpl.id, { series: s.key });
  }, [KEYS.templates]);
  const suggestions = combineSuggestions(templates).filter((s) => !combine.dismissed.has(s.templates.map((x) => x.id).join(",")));
  if (suggestions.length === 0) return null;
  return (
    <div className="space-y-2" data-combine>
      {suggestions.map((s) => {
        const id = s.templates.map((x) => x.id).join(",");
        return (
          <Card key={id} className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{t("income.combineTitle")}</p>
              <p className="text-sm text-zinc-500">{t("income.combineHint", { names: s.templates.map((x) => x.name).join(", ") })}</p>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => combine.dismiss(id)}>
                {t("income.notSame")}
              </Button>
              <Button variant="primary" disabled={join.isPending} onClick={() => join.mutate(s)}>
                {t("income.combine")}
              </Button>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

/**
 * Give a raise (lib/domain/incomeSeries.ts raise): the current amount ends
 * the day before, the new one starts on the chosen date, in the same series.
 * From its next date on by default, never earlier than today: months already
 * recorded keep what they were.
 */
export function RaiseModal({ tpl, onClose }: { tpl: RecurringTemplate | null; onClose: () => void }) {
  const { t, locale } = useI18n();
  const formatDate = useFormatDate();
  const repo = useRepo();
  const accounts = useAccounts();
  const transactions = useTransactions();
  const [amount, setAmount] = useState("");
  const [from, setFrom] = useState("");
  const [opened, setOpened] = useState<string | null>(null);

  const today = todayISO();
  if (!tpl && opened !== null) setOpened(null);
  if (tpl && opened !== tpl.id) {
    setOpened(tpl.id);
    setAmount("");
    const next = templateProgress(tpl, transactions.data ?? [], today).next;
    setFrom(next && next > tpl.startDate ? next : addDays(today, 1));
  }

  const plan = tpl ? raise(tpl, Number(amount), from) : null;
  const save = useAppMutation(async () => {
    if (!plan) return;
    await repo.updateTemplate(plan.end.id, { endDate: plan.end.endDate, series: plan.end.series });
    await repo.createTemplate(plan.next);
    await repo.materializeTemplates(MATERIALIZE_MONTHS_AHEAD);
  }, [KEYS.templates, KEYS.transactions]);

  const currency = accounts.data?.find((a) => a.id === tpl?.accountId)?.currency ?? "TRY";
  return (
    <Modal
      open={tpl != null}
      onClose={onClose}
      title={tpl ? t("income.raiseTitle", { name: tpl.name }) : ""}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!plan || save.isPending) return;
        await save.mutateAsync(undefined as never);
        onClose();
      }}
    >
      {tpl ? (
        <div className="space-y-3" data-raise>
          <div className="grid grid-cols-2 gap-3">
            <Field label={`${t("income.raiseAmount")} (${currency})`}>
              <Input type="number" step="any" min="0" required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <Field label={t("income.raiseFrom")}>
              <Input type="date" required min={today > tpl.startDate ? today : addDays(tpl.startDate, 1)} value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
          </div>
          <p className="text-xs text-zinc-500">
            {plan
              ? t("income.raiseHint", { amount: formatAmount(tpl.amount, currency, locale), date: formatDate(plan.end.endDate) })
              : amount
                ? t("income.raiseInvalid")
                : null}
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="primary" disabled={!plan || save.isPending}>
              {t("common.save")}
            </Button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
