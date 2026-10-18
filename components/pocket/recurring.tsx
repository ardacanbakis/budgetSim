"use client";

import { useRouter } from "next/navigation";
import { ReactNode, useId, useMemo, useState } from "react";
import { TemplateModal } from "@/components/recurringTab";
import { EmptyState } from "@/components/ui";
import { useApp, useRepo } from "@/lib/data/provider";
import { KEYS, useAccounts, useAppMutation, useCategories, useRates, useTemplates, useTransactions } from "@/lib/data/queries";
import { NewTemplate } from "@/lib/data/repo";
import { Account, Category, RecurringTemplate, Transaction } from "@/lib/data/types";
import { Currency } from "@/lib/domain/currencies";
import { snapshotFromTable, UsdPerMap } from "@/lib/domain/fx";
import { BackfillMode, MATERIALIZE_MONTHS_AHEAD } from "@/lib/domain/materialize";
import { todayISO } from "@/lib/domain/recurrence";
import { TemplateProgress, templateProgress } from "@/lib/domain/templateStatus";
import { useI18n } from "@/lib/i18n";
import { RECURRING_DIRECTION_FILTER_KEY, RECURRING_STATUS_FILTER_KEY, useLocalChoice } from "@/lib/prefs";
import { isStaleTable } from "@/lib/rates/fallback";
import { LabelColor, LabeledStatus, useLabelColor } from "@/lib/ui/labelColors";
import {
  CommitmentPeriod,
  DIRECTION_FILTERS,
  DirectionFilter,
  dueOccurrences,
  monthlyCommitments,
  recurringList,
  scaleCommitments,
  STATUS_FILTERS,
  StatusFilter,
} from "@/lib/ui/pocket/commitments";
import { relativeDue } from "@/lib/ui/pocket/dates";
import { dayDate } from "@/lib/ui/pocket/dayGroups";
import { showSnack } from "@/lib/ui/pocket/snackbar";
import { pushQuery } from "@/lib/ui/shallowUrl";
import { RowsSkeleton } from "./activityFilters";
import { CompleteCheck, useDueLabel } from "./dayList";
import { Icon } from "./icons";
import { Approx, Avatar, Chip, ChipRow, Money, Section, Segmented } from "./kit";
import { PocketPaidAmountSheet } from "./paidAmountSheet";
import { ActionItem, PocketActionSheet } from "./sheet";
import { useTxActions } from "./txActions";

/**
 * Pocket's Recurring (/transactions?tab=recurring): the templates that write
 * the ledger's planned rows.
 *
 * 1. Commitments: what they take and bring a month (or a year: × 12) in the
 *    display currency, and which comes next (lib/ui/pocket/commitments.ts).
 * 2. Chips: All, To confirm (when there are any), Income, Expense — the
 *    Classic tab's own device-kept filters, so both layouts open on the same
 *    choice.
 * 3. The list: templates with items to confirm first, then by next date;
 *    finished ones folded away. Each row keeps the Classic labels (Not
 *    started, n to confirm, Completed) in the label colours chosen in
 *    Settings, and a Loan or Auto tag.
 *
 * A row opens a sheet: its due items, each with a ✓ (useTxActions: Undo in
 *    the snackbar) and "Paid a different amount…"; Edit (TemplateModal from
 *    the Classic tab, a sheet here), or for a loan's template a link to Debt;
 *    and "See its items" (Activity, searched by name). Writes are the Classic
 *    tab's: createTemplate then materializeTemplates, updateTemplate,
 *    deleteTemplate, all invalidating [templates, transactions]. There's no
 *    Skip: materializing would write a deleted date back.
 */

/** Badge tones by label colour (components/ui Badge), spelled out for Tailwind. */
const TAG: Record<LabelColor, string> = {
  zinc: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  green: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  amber: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  red: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  sky: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
  teal: "bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300",
  violet: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  yellow: "bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-300",
};

function Tag({ color, children }: { color: LabelColor; children: ReactNode }) {
  return (
    <span className={`inline-block shrink-0 whitespace-nowrap rounded-full px-1.5 text-[10px] font-medium leading-4 ${TAG[color]}`}>
      {children}
    </span>
  );
}

const PRIMARY_BUTTON =
  "flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-teal-600 px-4 text-sm font-semibold text-white active:bg-teal-700 dark:bg-teal-500 dark:text-zinc-950";

export function PocketRecurring({
  creating,
  onCreatingChange,
}: {
  /** the header's + asked for a new template */
  creating: boolean;
  onCreatingChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const { displayCurrency } = useApp();
  const repo = useRepo();
  const router = useRouter();
  const templates = useTemplates();
  const accounts = useAccounts();
  const categories = useCategories();
  const transactions = useTransactions();
  const rates = useRates();
  const actions = useTxActions();
  const statusFilter = useLocalChoice<StatusFilter>(RECURRING_STATUS_FILTER_KEY, STATUS_FILTERS, "all");
  const directionFilter = useLocalChoice<DirectionFilter>(RECURRING_DIRECTION_FILTER_KEY, DIRECTION_FILTERS, "all");
  const colors: Record<LabeledStatus, LabelColor> = {
    completed: useLabelColor("completed")[0],
    notStarted: useLabelColor("notStarted")[0],
    toConfirm: useLabelColor("toConfirm")[0],
  };
  const [period, setPeriod] = useState<CommitmentPeriod>("monthly");
  const [editing, setEditing] = useState<RecurringTemplate | null>(null);
  const [opened, setOpened] = useState<RecurringTemplate | null>(null);
  const [paying, setPaying] = useState<Transaction | null>(null);
  const [deleting, setDeleting] = useState<RecurringTemplate | null>(null);
  const [finishedOpen, setFinishedOpen] = useState(false);
  const finishedId = useId();
  const today = todayISO();
  const usdPer = rates.data?.usdPer;
  const stale = rates.data != null && isStaleTable(rates.data);

  const progressById = useMemo(() => {
    const map = new Map<string, TemplateProgress>();
    for (const tpl of templates.data ?? []) map.set(tpl.id, templateProgress(tpl, transactions.data ?? [], today));
    return map;
  }, [templates.data, transactions.data, today]);
  const accountsById = useMemo(() => new Map((accounts.data ?? []).map((a) => [a.id, a])), [accounts.data]);
  const categoriesById = useMemo(() => new Map((categories.data ?? []).map((c) => [c.id, c])), [categories.data]);

  // the Classic tab's writes, unchanged
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

  const all = templates.data ?? [];
  const commitments = scaleCommitments(
    monthlyCommitments({ templates: all, progressById, accountsById, usdPer, display: displayCurrency }),
    period
  );
  const list = recurringList(all, progressById, { status: statusFilter.value, direction: directionFilter.value });

  const closeForm = () => {
    onCreatingChange(false);
    setEditing(null);
  };

  const form = (
    <TemplateModal
      open={creating || editing != null}
      initial={editing}
      onClose={closeForm}
      onSave={async (input, backfill) => {
        if (editing) await updateTemplate.mutateAsync({ id: editing.id, patch: input });
        else await createTemplate.mutateAsync({ input, backfill });
        closeForm();
        showSnack(t("pocket.saved"));
      }}
      onDelete={
        editing
          ? async () => {
              // one sheet at a time: the form gives way to the question
              const tpl = editing;
              closeForm();
              setDeleting(tpl);
            }
          : undefined
      }
    />
  );

  if (templates.isLoading || accounts.isLoading || transactions.isLoading) {
    return (
      <>
        <RowsSkeleton rows={5} />
        {form}
      </>
    );
  }

  const row = (tpl: RecurringTemplate) => (
    <TemplateRow
      key={tpl.id}
      tpl={tpl}
      progress={progressById.get(tpl.id)}
      account={accountsById.get(tpl.accountId)}
      category={tpl.categoryId ? categoriesById.get(tpl.categoryId) : undefined}
      colors={colors}
      today={today}
      display={displayCurrency}
      usdPer={usdPer}
      waiting={stale}
      onOpen={() => setOpened(tpl)}
    />
  );

  const otherStatus = statusFilter.value !== "all" && statusFilter.value !== "toConfirm" ? statusFilter.value : null;

  return (
    <div className="space-y-4">
      {all.length === 0 ? (
        <EmptyState
          action={
            <button type="button" onClick={() => onCreatingChange(true)} aria-haspopup="dialog" className={PRIMARY_BUTTON}>
              <Icon name="plus" size={18} />
              {t("recurring.newTemplate")}
            </button>
          }
        >
          {t("recurring.empty")}
        </EmptyState>
      ) : (
        <>
          <CommitmentsCard
            out={commitments.out}
            income={commitments.in}
            next={commitments.next}
            currency={displayCurrency}
            period={period}
            onPeriod={setPeriod}
            today={today}
            waiting={commitments.missing > 0 && !usdPer}
          />

          <ChipRow label={t("recurring.filterStatus")}>
            <Chip active={statusFilter.value === "all"} onClick={() => statusFilter.setValue("all")} count={list.counts.all}>
              {t("recurring.status_all")}
            </Chip>
            {list.counts.toConfirm > 0 || statusFilter.value === "toConfirm" ? (
              <Chip
                active={statusFilter.value === "toConfirm"}
                onClick={() => statusFilter.setValue(statusFilter.value === "toConfirm" ? "all" : "toConfirm")}
                count={list.counts.toConfirm}
              >
                {t("recurring.status_toConfirm")}
              </Chip>
            ) : null}
            {/* a status chosen on the Classic tab stays visible, so it can be cleared here */}
            {otherStatus ? (
              <Chip active onClick={() => statusFilter.setValue("all")} count={list.counts[otherStatus]}>
                {t(`recurring.status_${otherStatus}`)}
                <Icon name="close" size={14} className="-mr-1" />
              </Chip>
            ) : null}
            {(["income", "expense"] as const).map((d) => (
              <Chip
                key={d}
                active={directionFilter.value === d}
                onClick={() => directionFilter.setValue(directionFilter.value === d ? "all" : d)}
              >
                {t(`tx.${d}`)}
                {directionFilter.value === d ? <Icon name="close" size={14} className="-mr-1" /> : null}
              </Chip>
            ))}
          </ChipRow>

          {list.live.length === 0 && list.finished.length === 0 ? (
            <EmptyState
              action={
                <button
                  type="button"
                  onClick={() => {
                    statusFilter.setValue("all");
                    directionFilter.setValue("all");
                  }}
                  className="flex min-h-[44px] items-center rounded-xl border border-[var(--edge)] bg-[var(--surface)] px-4 text-sm font-medium text-teal-700 active:bg-[var(--edge-soft)] dark:text-teal-300"
                >
                  {t("recurring.showAll")}
                </button>
              }
            >
              {t("recurring.noneMatch")}
            </EmptyState>
          ) : null}

          {list.live.length > 0 ? (
            <ul
              data-recurring-list
              className="divide-y divide-[var(--edge-soft)] overflow-hidden rounded-[var(--ui-card-radius)] border border-[var(--edge)] bg-[var(--surface)]"
            >
              {list.live.map(row)}
            </ul>
          ) : null}

          {list.finished.length > 0 ? (
            <section className="overflow-hidden rounded-[var(--ui-card-radius)] border border-[var(--edge)] bg-[var(--surface)]">
              <h2>
                <button
                  type="button"
                  aria-expanded={finishedOpen || statusFilter.value === "completed"}
                  aria-controls={finishedId}
                  onClick={() => setFinishedOpen((o) => !o)}
                  className="flex min-h-[44px] w-full items-center gap-1.5 px-3 text-left text-sm font-semibold text-zinc-600 active:bg-[var(--edge-soft)] dark:text-zinc-300"
                >
                  <Icon
                    name="chevron"
                    size={16}
                    className={`shrink-0 transition-transform ${finishedOpen || statusFilter.value === "completed" ? "rotate-90" : ""}`}
                  />
                  {t("pocket.activity.finishedN", { count: list.finished.length })}
                </button>
              </h2>
              {finishedOpen || statusFilter.value === "completed" ? (
                <ul id={finishedId} className="divide-y divide-[var(--edge-soft)] border-t border-[var(--edge-soft)]">
                  {list.finished.map(row)}
                </ul>
              ) : null}
            </section>
          ) : null}
        </>
      )}

      <TemplateSheet
        tpl={opened}
        progress={opened ? progressById.get(opened.id) : undefined}
        account={opened ? accountsById.get(opened.accountId) : undefined}
        due={opened ? dueOccurrences(opened, transactions.data ?? [], today) : []}
        today={today}
        ready={actions.ready}
        onClose={() => setOpened(null)}
        onComplete={(tx) => {
          setOpened(null);
          actions.complete(tx);
        }}
        onPaidDifferent={(tx) => {
          setOpened(null);
          setPaying(tx);
        }}
        onEdit={(tpl) => {
          setOpened(null);
          setEditing(tpl);
        }}
        onLoans={() => {
          setOpened(null);
          router.push("/loans");
        }}
        onItems={(tpl) => {
          setOpened(null);
          // the same page, so the URL changes in place (lib/ui/shallowUrl.ts),
          // scroll and all: the search starts at its top
          pushQuery(`/transactions?q=${encodeURIComponent(tpl.name)}`);
          window.scrollTo(0, 0);
        }}
      />

      <PocketPaidAmountSheet
        tx={paying}
        onClose={() => setPaying(null)}
        onConfirm={(paid) => {
          if (paying) actions.complete(paying, paid);
        }}
      />

      {form}

      <PocketActionSheet
        key={deleting?.id ?? "none"}
        open={deleting != null}
        onClose={() => setDeleting(null)}
        title={deleting ? t("pocket.activity.deleteTemplate", { name: deleting.name }) : ""}
        items={[
          {
            label: t("pocket.activity.deleteWithPlanned"),
            icon: "trash",
            tone: "danger",
            onSelect: () => {
              const tpl = deleting;
              setDeleting(null);
              if (tpl) deleteTemplate.mutateAsync({ id: tpl.id, deletePlanned: true }).then(() => showSnack(t("pocket.lists.deleted")), () => {});
            },
          },
          {
            label: t("pocket.activity.deleteKeepPlanned"),
            icon: "trash",
            tone: "danger",
            onSelect: () => {
              const tpl = deleting;
              setDeleting(null);
              if (tpl) deleteTemplate.mutateAsync({ id: tpl.id, deletePlanned: false }).then(() => showSnack(t("pocket.lists.deleted")), () => {});
            },
          },
        ]}
      />
    </div>
  );
}

function CommitmentsCard({
  out,
  income,
  next,
  currency,
  period,
  onPeriod,
  today,
  waiting,
}: {
  out: number;
  income: number;
  next: { name: string; due: string } | null;
  currency: Currency;
  period: CommitmentPeriod;
  onPeriod: (period: CommitmentPeriod) => void;
  today: string;
  /** some templates are in another currency and no rates have arrived */
  waiting: boolean;
}) {
  const { t } = useI18n();
  const when = (due: string) => {
    const { key, count } = relativeDue(due, today);
    if (key === "today") return t("pocket.activity.whenToday");
    if (key === "tomorrow") return t("pocket.activity.whenTomorrow");
    return t("pocket.lists.inDays", { count });
  };
  return (
    <Section
      title={t("pocket.activity.commitments")}
      action={
        <div className="w-[11rem] shrink-0">
          <Segmented
            label={t("pocket.activity.period")}
            value={period}
            options={[
              { value: "monthly", label: t("recurring.monthly") },
              { value: "yearly", label: t("recurring.yearly") },
            ]}
            onChange={onPeriod}
          />
        </div>
      }
    >
      <dl data-commitments className="space-y-1">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-sm text-zinc-500 dark:text-zinc-400">{t("pocket.activity.outLabel")}</dt>
          <dd data-commitment="out">
            <Money amount={out} currency={currency} sign="out" tone="auto" className="text-lg font-semibold" />
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-sm text-zinc-500 dark:text-zinc-400">{t("pocket.activity.inLabel")}</dt>
          <dd data-commitment="in">
            <Money amount={income} currency={currency} sign="in" tone="auto" className="text-lg font-semibold" />
          </dd>
        </div>
      </dl>
      {waiting ? (
        <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">{t("pocket.lists.waitingRates")}</p>
      ) : null}
      {next ? (
        <p className="mt-2 truncate text-xs text-zinc-500 dark:text-zinc-400">
          {t("pocket.activity.nextUp", { name: next.name, when: when(next.due) })}
        </p>
      ) : null}
    </Section>
  );
}

function TemplateRow({
  tpl,
  progress,
  account,
  category,
  colors,
  today,
  display,
  usdPer,
  waiting,
  onOpen,
}: {
  tpl: RecurringTemplate;
  progress: TemplateProgress | undefined;
  account: Account | undefined;
  category: Category | undefined;
  colors: Record<LabeledStatus, LabelColor>;
  today: string;
  display: Currency;
  usdPer: UsdPerMap | undefined;
  /** live rates haven't arrived: auto-complete is holding back */
  waiting: boolean;
  onOpen: () => void;
}) {
  const { t } = useI18n();
  const dueLabel = useDueLabel();
  const status = progress?.status ?? "active";
  const finished = status === "completed";
  const open = progress?.open ?? 0;
  const income = tpl.direction === "income";
  const autoWaiting = tpl.autoComplete && !finished && waiting && open > 0;

  // the part that says where it stands comes first: it's never the one cut short
  let standing: ReactNode = null;
  if (open > 0) standing = <Tag color={colors.toConfirm}>{t("recurring.openCount", { count: open })}</Tag>;
  else if (finished) standing = <Tag color={colors.completed}>✓ {t("recurring.status_completed")}</Tag>;
  else if (status === "notStarted") standing = <Tag color={colors.notStarted}>{t("recurring.status_notStarted")}</Tag>;
  const when =
    !finished && progress?.next
      ? progress.next === today
        ? t("pocket.activity.dueToday")
        : dueLabel(progress.next, today).text
      : null;

  const parts: Array<{ key: string; node: ReactNode; shrink?: boolean }> = [];
  if (standing) parts.push({ key: "standing", node: standing });
  if (when && open === 0) parts.push({ key: "when", node: when });
  parts.push({ key: "freq", node: t(`recurring.${tpl.frequency}`) });
  if (progress?.total != null) parts.push({ key: "progress", node: `${progress.done}/${progress.total}` });
  if (account) parts.push({ key: "account", node: account.name, shrink: true });

  const tag = tpl.loanId ? (
    <Tag color="sky">{t("pocket.activity.loanTag")}</Tag>
  ) : tpl.autoComplete && !finished ? (
    <Tag color={autoWaiting ? "amber" : "green"}>{t("pocket.activity.autoTag")}</Tag>
  ) : null;

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        aria-haspopup="dialog"
        className="flex min-h-[64px] w-full items-center gap-3 px-4 py-2 text-left active:bg-[var(--edge-soft)]"
      >
        <span className="shrink-0">
          <Avatar color={category?.color} label={tpl.name} icon={<Icon name={income ? "arrowDown" : "arrowUp"} size={18} />} />
        </span>
        <span className={`min-w-0 flex-1 ${finished ? "opacity-70" : ""}`}>
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 truncate text-[15px] font-medium">{tpl.name}</span>
            {tag}
          </span>
          <span className="mt-0.5 flex min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap text-xs text-zinc-500 dark:text-zinc-400">
            {parts.map((part, i) => (
              <span key={part.key} className={`flex items-center gap-1 ${part.shrink ? "min-w-0" : "shrink-0"}`}>
                {i > 0 ? <span aria-hidden className="shrink-0">·</span> : null}
                <span className={part.shrink ? "min-w-0 truncate" : undefined}>{part.node}</span>
              </span>
            ))}
          </span>
          {autoWaiting ? (
            <span className="mt-0.5 block truncate text-[11px] text-amber-600 dark:text-amber-400">{t("pocket.activity.autoWaiting")}</span>
          ) : null}
        </span>
        {account ? (
          <span className="shrink-0 text-right">
            <Money
              amount={tpl.amount}
              currency={account.currency}
              sign={income ? "in" : "out"}
              tone="auto"
              className="block text-[15px] font-semibold"
            />
            <Approx amount={tpl.amount} from={account.currency} to={display} usdPer={usdPer} />
          </span>
        ) : null}
      </button>
    </li>
  );
}

/** A template's sheet: its due items to confirm first, then Edit (or Debt, for a loan's) and its items. */
function TemplateSheet({
  tpl,
  progress,
  account,
  due,
  today,
  ready,
  onClose,
  onComplete,
  onPaidDifferent,
  onEdit,
  onLoans,
  onItems,
}: {
  tpl: RecurringTemplate | null;
  progress: TemplateProgress | undefined;
  account: Account | undefined;
  due: Transaction[];
  today: string;
  ready: boolean;
  onClose: () => void;
  onComplete: (tx: Transaction) => void;
  onPaidDifferent: (tx: Transaction) => void;
  onEdit: (tpl: RecurringTemplate) => void;
  onLoans: () => void;
  onItems: (tpl: RecurringTemplate) => void;
}) {
  const { t, locale } = useI18n();
  const dueLabel = useDueLabel();
  if (!tpl) return null;
  const income = tpl.direction === "income";
  const withYear = (date: string) => date.slice(0, 4) !== today.slice(0, 4);

  const items: ActionItem[] = [
    tpl.loanId
      ? {
          label: <span className="text-zinc-500 dark:text-zinc-400">{t("pocket.activity.managedByLoan")}</span>,
          icon: "bank",
          onSelect: onLoans,
        }
      : { label: t("common.edit"), icon: "edit", tone: due.length ? undefined : "primary", onSelect: () => onEdit(tpl) },
    { label: t("pocket.activity.seeItems"), icon: "activity", onSelect: () => onItems(tpl) },
  ];

  const next = progress?.next && progress.status !== "completed" ? progress.next : null;
  const summary = (
    <div className="space-y-3">
      <div className="flex items-center gap-3 rounded-[var(--ui-card-radius)] bg-[var(--edge-soft)] px-4 py-3">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm">
            {t(`recurring.${tpl.frequency}`)}
            {account ? ` · ${account.name}` : ""}
          </span>
          {next ? (
            <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
              {t("recurring.next", { date: dayDate(next, locale, withYear(next)) })}
            </span>
          ) : null}
        </span>
        {account ? (
          <Money
            amount={tpl.amount}
            currency={account.currency}
            sign={income ? "in" : "out"}
            tone="auto"
            className="shrink-0 text-[15px] font-semibold"
          />
        ) : null}
      </div>
      {due.length > 0 ? (
        <section aria-label={t("pocket.activity.dueItems")}>
          <h3 className="pb-1 text-xs font-semibold text-zinc-500 dark:text-zinc-400">{t("pocket.activity.dueItems")}</h3>
          <ul className="divide-y divide-[var(--edge-soft)] overflow-hidden rounded-[var(--ui-card-radius)] border border-[var(--edge)]">
            {due.map((tx) => {
              const date = dayDate(tx.dueDate, locale, withYear(tx.dueDate));
              const late = dueLabel(tx.dueDate, today);
              return (
                <li key={tx.id} data-due-item className="flex items-center gap-2 py-1 pl-4 pr-1">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {date}
                      <span className={late.late ? "font-normal text-red-600 dark:text-red-400" : "font-normal text-zinc-500 dark:text-zinc-400"}>
                        {" "}
                        · {late.text}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => onPaidDifferent(tx)}
                      className="-ml-1 flex min-h-[44px] items-center rounded-lg px-1 text-xs font-medium text-teal-700 active:bg-[var(--edge-soft)] dark:text-teal-300"
                    >
                      {t("pocket.lists.paidDifferent")}
                    </button>
                  </span>
                  {account ? (
                    <Money
                      amount={tx.amount}
                      currency={account.currency}
                      sign={income ? "in" : "out"}
                      tone="auto"
                      className="shrink-0 text-sm font-semibold"
                    />
                  ) : null}
                  <CompleteCheck name={`${tpl.name}, ${date}`} ready={ready} onClick={() => onComplete(tx)} />
                </li>
              );
            })}
          </ul>
          {ready ? null : (
            <p role="status" className="pt-1 text-xs text-amber-600 dark:text-amber-400">
              {t("pocket.lists.waitingRates")}
            </p>
          )}
        </section>
      ) : null}
    </div>
  );

  return <PocketActionSheet key={tpl.id} open onClose={onClose} title={tpl.name} summary={summary} items={items} />;
}
