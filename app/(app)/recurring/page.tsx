"use client";

import { useMemo, useState } from "react";
import { LabelColorSettings } from "@/components/labelColorPicker";
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Select, Spinner } from "@/components/ui";
import { useRepo } from "@/lib/data/provider";
import { KEYS, useAccounts, useAppMutation, useCategories, useTemplates, useTransactions } from "@/lib/data/queries";
import { NewTemplate } from "@/lib/data/repo";
import { Frequency, RecurringTemplate, TxDirection } from "@/lib/data/types";
import { formatAmount } from "@/lib/domain/currencies";
import { todayISO } from "@/lib/domain/recurrence";
import { TemplateProgress, TemplateStatus, templateProgress } from "@/lib/domain/templateStatus";
import { useI18n } from "@/lib/i18n";
import { RECURRING_DIRECTION_FILTER_KEY, RECURRING_STATUS_FILTER_KEY, useLocalChoice } from "@/lib/prefs";
import { LABELED_STATUSES, LabelColor, LabeledStatus, SWATCH_CLASS, useLabelColor } from "@/lib/ui/labelColors";
import { useFormatDate } from "@/lib/useFormatDate";

type StatusFilter = "all" | TemplateStatus;
const STATUS_FILTERS: readonly StatusFilter[] = ["all", "active", "notStarted", "toConfirm", "completed"];
type DirectionFilter = "all" | TxDirection;
const DIRECTION_FILTERS: readonly DirectionFilter[] = ["all", "income", "expense"];

/** Under "All": what needs a tap first, finished items last. */
const STATUS_RANK: Record<TemplateStatus, number> = { toConfirm: 0, active: 1, notStarted: 2, completed: 3 };

const segmentClass = (on: boolean) =>
  `whitespace-nowrap rounded-md px-2.5 py-1 text-sm transition-colors ${
    on ? "bg-teal-600 text-white dark:bg-teal-500 dark:text-zinc-950" : "text-zinc-500 hover:bg-[var(--edge-soft)]"
  }`;

export default function RecurringPage() {
  const { t, locale } = useI18n();
  const repo = useRepo();
  const templates = useTemplates();
  const accounts = useAccounts();
  const transactions = useTransactions();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<RecurringTemplate | null>(null);
  const [colorsOpen, setColorsOpen] = useState(false);
  const statusFilter = useLocalChoice<StatusFilter>(RECURRING_STATUS_FILTER_KEY, STATUS_FILTERS, "all");
  const directionFilter = useLocalChoice<DirectionFilter>(RECURRING_DIRECTION_FILTER_KEY, DIRECTION_FILTERS, "all");
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
    async (input: NewTemplate) => {
      await repo.createTemplate(input);
      await repo.materializeTemplates(12);
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

  const list = templates.data ?? [];
  const accountById = new Map((accounts.data ?? []).map((a) => [a.id, a]));
  const statusOf = (tpl: RecurringTemplate) => progressById.get(tpl.id)?.status ?? "active";

  // Counts follow the direction filter, so each number matches what its chip shows.
  const byDirection = list.filter((tpl) => directionFilter.value === "all" || tpl.direction === directionFilter.value);
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">{t("recurring.title")}</h1>
          <p className="text-sm text-zinc-500">{t("recurring.materialized")}</p>
        </div>
        <Button variant="primary" onClick={() => setModalOpen(true)}>
          + {t("recurring.newTemplate")}
        </Button>
      </div>

      {list.length === 0 ? (
        <EmptyState>{t("recurring.empty")}</EmptyState>
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
            <div role="group" aria-label={t("recurring.filterDirection")} className="flex rounded-lg border border-[var(--edge)] p-0.5">
              {DIRECTION_FILTERS.map((d) => (
                <button key={d} type="button" aria-pressed={directionFilter.value === d} onClick={() => directionFilter.setValue(d)} className={segmentClass(directionFilter.value === d)}>
                  {d === "all" ? t("recurring.status_all") : t(`tx.${d}`)}
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
                  onClick={() => {
                    statusFilter.setValue("all");
                    directionFilter.setValue("all");
                  }}
                >
                  {t("recurring.showAll")}
                </Button>
              }
            >
              {t("recurring.noneMatch")}
            </EmptyState>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 3xl:grid-cols-4">
              {shown.map((tpl) => {
                const account = accountById.get(tpl.accountId);
                return (
                  <TemplateCard
                    key={tpl.id}
                    tpl={tpl}
                    progress={progressById.get(tpl.id)}
                    amount={account ? formatAmount(tpl.amount, account.currency, locale) : String(tpl.amount)}
                    accountName={account?.name}
                    colors={labelColors}
                    onEdit={() => setEditing(tpl)}
                  />
                );
              })}
            </div>
          )}
        </>
      )}

      <Modal open={colorsOpen} onClose={() => setColorsOpen(false)} title={t("recurring.labelColors")}>
        <p className="mb-3 text-sm text-zinc-500">{t("recurring.labelColorsHint")}</p>
        <LabelColorSettings />
      </Modal>

      <TemplateModal
        open={modalOpen || editing != null}
        initial={editing}
        onClose={() => {
          setModalOpen(false);
          setEditing(null);
        }}
        onSave={async (input) => {
          if (editing) await updateTemplate.mutateAsync({ id: editing.id, patch: input });
          else await createTemplate.mutateAsync(input);
          setModalOpen(false);
          setEditing(null);
        }}
        onDelete={
          editing
            ? async () => {
                const deletePlanned = window.confirm(t("recurring.deletePlannedToo"));
                await deleteTemplate.mutateAsync({ id: editing.id, deletePlanned });
                setEditing(null);
              }
            : undefined
        }
      />
    </div>
  );
}

function TemplateCard({
  tpl,
  progress,
  amount,
  accountName,
  colors,
  onEdit,
}: {
  tpl: RecurringTemplate;
  progress: TemplateProgress | undefined;
  amount: string;
  accountName: string | undefined;
  colors: Record<LabeledStatus, LabelColor>;
  onEdit: () => void;
}) {
  const { t } = useI18n();
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
            {tpl.loanId ? <Badge tone="sky">{t("recurring.linkedLoan")}</Badge> : null}
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
          </div>
        </div>
        {!tpl.loanId ? (
          <Button variant="ghost" onClick={onEdit}>
            {t("common.edit")}
          </Button>
        ) : null}
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

function TemplateModal({
  open,
  initial,
  onClose,
  onSave,
  onDelete,
}: {
  open: boolean;
  initial: RecurringTemplate | null;
  onClose: () => void;
  onSave: (input: NewTemplate) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const { t } = useI18n();
  const accounts = useAccounts();
  const categories = useCategories();
  const [name, setName] = useState("");
  const [accountId, setAccountId] = useState("");
  const [direction, setDirection] = useState<TxDirection>("expense");
  const [categoryId, setCategoryId] = useState("");
  const [amount, setAmount] = useState("");
  const [frequency, setFrequency] = useState<Frequency>("monthly");
  const [startDate, setStartDate] = useState(todayISO());
  const [endDate, setEndDate] = useState("");
  const [autoComplete, setAutoComplete] = useState(false);
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
    setDirection(initial?.direction ?? "expense");
    setCategoryId(initial?.categoryId ?? "");
    setAmount(initial ? String(initial.amount) : "");
    setFrequency(initial?.frequency ?? "monthly");
    setStartDate(initial?.startDate ?? todayISO());
    setEndDate(initial?.endDate ?? "");
    setAutoComplete(initial?.autoComplete ?? false);
  }

  const active = (accounts.data ?? []).filter((a) => !a.archived);
  const effectiveAccount = accountId || active[0]?.id || "";
  const dirCategories = (categories.data ?? []).filter((c) => c.direction === direction);

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
            });
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
        <div className="grid grid-cols-3 gap-3">
          <Field label={t("recurring.frequency")}>
            <Select value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)}>
              <option value="weekly">{t("recurring.weekly")}</option>
              <option value="monthly">{t("recurring.monthly")}</option>
              <option value="yearly">{t("recurring.yearly")}</option>
            </Select>
          </Field>
          <Field label={t("recurring.startDate")}>
            <Input type="date" required value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
          <Field label={`${t("recurring.endDate")} (${t("common.optional")})`}>
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </Field>
        </div>
        <label className="flex items-start gap-2 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800/60">
          <input type="checkbox" checked={autoComplete} onChange={(e) => setAutoComplete(e.target.checked)} className="mt-0.5 h-4 w-4 accent-teal-600" />
          <span>
            <span className="block text-sm font-medium">{t("recurring.autoComplete")}</span>
            <span className="block text-xs text-zinc-500">{t("recurring.autoCompleteHint")}</span>
          </span>
        </label>
        <div className="flex justify-between gap-2 pt-1">
          {onDelete ? (
            <Button type="button" variant="danger" onClick={onDelete}>
              {t("common.delete")}
            </Button>
          ) : (
            <span />
          )}
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
