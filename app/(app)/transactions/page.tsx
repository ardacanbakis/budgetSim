"use client";

import { useMemo, useState } from "react";
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Select, Spinner } from "@/components/ui";
import { TransactionModal } from "@/components/transactionModal";
import { TransferModal } from "@/components/transferModal";
import { useRepo } from "@/lib/data/provider";
import { KEYS, useAccounts, useAppMutation, useCategories, useRates, useTransactions } from "@/lib/data/queries";
import { Account, Category, Transaction, TxDirection, TxStatus } from "@/lib/data/types";
import { formatAmount } from "@/lib/domain/currencies";
import { convert, snapshotFromTable } from "@/lib/domain/fx";
import { addMonthsClamped, todayISO } from "@/lib/domain/recurrence";
import { useApp } from "@/lib/data/provider";
import { useFormatDate } from "@/lib/useFormatDate";
import { useI18n } from "@/lib/i18n";

export default function TransactionsPage() {
  const { t, locale } = useI18n();
  const fmtDate = useFormatDate();
  const repo = useRepo();
  const { displayCurrency } = useApp();
  const accounts = useAccounts();
  const categories = useCategories();
  const transactions = useTransactions();
  const rates = useRates();

  const [filterAccount, setFilterAccount] = useState("all");
  const [filterStatus, setFilterStatus] = useState<"all" | TxStatus>("all");
  const [filterDirection, setFilterDirection] = useState<"all" | TxDirection>("all");
  const [latestFirst, setLatestFirst] = useState(true);
  const [txModal, setTxModal] = useState(false);
  const [transferModal, setTransferModal] = useState(false);
  const [completing, setCompleting] = useState<Transaction | null>(null);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const invalidate = [KEYS.transactions, KEYS.accounts];
  const deleteTx = useAppMutation((id: string) => repo.deleteTransaction(id), invalidate);
  const updateTx = useAppMutation(
    (v: { id: string; patch: Partial<Pick<Transaction, "amount" | "dueDate" | "description" | "categoryId" | "accountId">> }) =>
      repo.updateTransaction(v.id, v.patch),
    invalidate
  );
  const reopenTx = useAppMutation((id: string) => repo.reopenTransaction(id), invalidate);
  const completeTx = useAppMutation(
    (v: { id: string; amount?: number; legacy?: boolean }) =>
      repo.completeTransaction(v.id, snapshotFromTable(rates.data!), v.amount, v.legacy),
    invalidate
  );
  const toggleLegacy = useAppMutation(
    (v: { id: string; legacy: boolean }) => repo.setTransactionLegacy(v.id, v.legacy),
    invalidate
  );
  const bulkLegacy = useAppMutation(
    (ids: string[]) => repo.bulkCompleteAsLegacy(ids, snapshotFromTable(rates.data!)),
    invalidate
  );

  const overduePlanned = (transactions.data ?? []).filter((tx) => tx.status === "planned" && tx.dueDate < todayISO());

  const accountById = useMemo(() => new Map((accounts.data ?? []).map((a) => [a.id, a])), [accounts.data]);
  const categoryById = useMemo(() => new Map((categories.data ?? []).map((c) => [c.id, c])), [categories.data]);

  const filtered = useMemo(() => {
    let list = transactions.data ?? [];
    if (filterAccount !== "all") list = list.filter((tx) => tx.accountId === filterAccount);
    if (filterStatus !== "all") list = list.filter((tx) => tx.status === filterStatus);
    if (filterDirection !== "all") list = list.filter((tx) => tx.direction === filterDirection);
    return [...list].sort((a, b) =>
      latestFirst ? (a.dueDate < b.dueDate ? 1 : a.dueDate > b.dueDate ? -1 : 0) : a.dueDate > b.dueDate ? 1 : a.dueDate < b.dueDate ? -1 : 0
    );
  }, [transactions.data, filterAccount, filterStatus, filterDirection, latestFirst]);

  // year → month grouping (like VICTVS) with a per-month outcome in the
  // display currency: income − expense = net over the visible items,
  // transfers and legacy records excluded, converted via each tx's snapshot
  const groups = useMemo(() => {
    const currencyOf = new Map((accounts.data ?? []).map((a) => [a.id, a.currency] as const));
    const byMonth = new Map<string, { items: Transaction[]; income: number; expense: number }>();
    for (const tx of filtered) {
      const month = tx.dueDate.slice(0, 7);
      const bucket = byMonth.get(month) ?? { items: [], income: 0, expense: 0 };
      bucket.items.push(tx);
      if (!tx.transferGroupId && !tx.legacy) {
        const currency = currencyOf.get(tx.accountId);
        const usdPer = tx.fxSnapshot?.usdPer ?? rates.data?.usdPer;
        const converted = currency && usdPer ? convert(tx.amount, currency, displayCurrency, usdPer) : null;
        if (converted != null) {
          if (tx.direction === "income") bucket.income += converted;
          else bucket.expense += converted;
        }
      }
      byMonth.set(month, bucket);
    }
    const months = [...byMonth.entries()].map(([month, b]) => ({ month, ...b, net: b.income - b.expense }));
    const byYear = new Map<string, typeof months>();
    for (const m of months) {
      const year = m.month.slice(0, 4);
      byYear.set(year, [...(byYear.get(year) ?? []), m]);
    }
    return [...byYear.entries()].sort((a, b) => (latestFirst ? (a[0] < b[0] ? 1 : -1) : a[0] > b[0] ? 1 : -1));
  }, [filtered, accounts.data, rates.data, displayCurrency, latestFirst]);

  const toggleCollapsed = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const monthLabel = (month: string) =>
    new Date(`${month}-01T00:00:00`).toLocaleDateString(locale === "tr" ? "tr-TR" : "en-US", { month: "long" });

  if (accounts.isLoading || transactions.isLoading || categories.isLoading) return <Spinner />;

  return (
    <div className="mx-auto max-w-5xl space-y-4 3xl:max-w-7xl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">{t("tx.title")}</h1>
        <div className="flex gap-2">
          <Button onClick={() => setTransferModal(true)}>⇄ {t("tx.newTransfer")}</Button>
          <Button variant="primary" onClick={() => setTxModal(true)}>
            + {t("tx.newTransaction")}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Select className="!w-auto" value={filterAccount} onChange={(e) => setFilterAccount(e.target.value)}>
          <option value="all">
            {t("tx.filterAccount")}: {t("common.all")}
          </option>
          {(accounts.data ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
        <Select className="!w-auto" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as never)}>
          <option value="all">
            {t("tx.filterStatus")}: {t("common.all")}
          </option>
          <option value="planned">{t("tx.planned")}</option>
          <option value="completed">{t("tx.completed")}</option>
        </Select>
        <Select className="!w-auto" value={filterDirection} onChange={(e) => setFilterDirection(e.target.value as never)}>
          <option value="all">
            {t("tx.filterDirection")}: {t("common.all")}
          </option>
          <option value="income">{t("tx.income")}</option>
          <option value="expense">{t("tx.expense")}</option>
        </Select>
        <button onClick={() => setLatestFirst(!latestFirst)} className="text-xs text-teal-600 hover:underline">
          {latestFirst ? t("portfolio.sortLatest") : t("portfolio.sortOldest")} ⇅
        </button>
      </div>

      {filterStatus === "planned" && overduePlanned.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--edge)] bg-[var(--edge-soft)] px-4 py-2.5 text-sm">
          <span className="text-zinc-600 dark:text-zinc-300">{t("legacy.overdueCount", { count: overduePlanned.length })}</span>
          <Button
            disabled={!rates.data || bulkLegacy.isPending}
            onClick={() => {
              if (window.confirm(t("legacy.bulkConfirm", { count: overduePlanned.length }))) {
                bulkLegacy.mutate(overduePlanned.map((tx) => tx.id));
              }
            }}
          >
            {t("legacy.bulkComplete")}
          </Button>
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <EmptyState>{t("tx.empty")}</EmptyState>
      ) : (
        groups.map(([year, months]) => {
          const yearCollapsed = collapsed.has(year);
          const yearNet = months.reduce((s, m) => s + m.net, 0);
          return (
            <div key={year} className="space-y-3">
              <button onClick={() => toggleCollapsed(year)} className="flex w-full flex-wrap items-center gap-2 text-left">
                <span className="text-lg font-bold">{yearCollapsed ? "▸" : "▾"} {year}</span>
                <span className={`text-sm font-semibold tabular-nums ${yearNet >= 0 ? "text-green-600" : "text-red-600"}`}>
                  {yearNet >= 0 ? "+" : "−"}{formatAmount(Math.abs(yearNet), displayCurrency, locale)}
                </span>
              </button>
              {yearCollapsed
                ? null
                : months.map(({ month, items, income, expense, net }) => {
                    const monthCollapsed = collapsed.has(month);
                    return (
                      <Card key={month}>
                        <button
                          onClick={() => toggleCollapsed(month)}
                          className="flex w-full flex-wrap items-center justify-between gap-2 border-b border-[var(--edge-soft)] px-4 py-2.5 text-left"
                        >
                          <span className="flex items-center gap-2 text-sm font-semibold">
                            <span>{monthCollapsed ? "▸" : "▾"}</span>
                            {monthLabel(month)}
                            <span className="font-normal text-zinc-400">{items.length}</span>
                          </span>
                          <span className="text-xs tabular-nums text-zinc-500">
                            <span className="text-green-600">+{formatAmount(income, displayCurrency, locale)}</span>
                            {" − "}
                            <span className="text-red-600">{formatAmount(expense, displayCurrency, locale)}</span>
                            {" = "}
                            <span className={`font-semibold ${net >= 0 ? "text-green-600" : "text-red-600"}`}>
                              {net >= 0 ? "+" : "−"}{formatAmount(Math.abs(net), displayCurrency, locale)}
                            </span>
                          </span>
                        </button>
                        {monthCollapsed ? null : (
                          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                            {items.map((tx) => (
                              <TxRow
                                key={tx.id}
                                tx={tx}
                                account={accountById.get(tx.accountId)}
                                category={tx.categoryId ? categoryById.get(tx.categoryId) : null}
                                fmtDate={fmtDate}
                                hasRates={Boolean(rates.data)}
                                onComplete={() => setCompleting(tx)}
                                onEdit={() => setEditing(tx)}
                                onToggleLegacy={() => toggleLegacy.mutate({ id: tx.id, legacy: !tx.legacy })}
                                onReopen={() => reopenTx.mutate(tx.id)}
                                onDelete={() => window.confirm(t("common.confirmDelete")) && deleteTx.mutate(tx.id)}
                              />
                            ))}
                          </ul>
                        )}
                      </Card>
                    );
                  })}
            </div>
          );
        })
      )}

      <TransactionModal open={txModal} onClose={() => setTxModal(false)} />

      <TransferModal open={transferModal} onClose={() => setTransferModal(false)} />

      <CompleteModal
        tx={completing}
        accountCurrency={completing ? accountById.get(completing.accountId)?.currency : undefined}
        onClose={() => setCompleting(null)}
        onConfirm={async (amount, legacy) => {
          if (completing) await completeTx.mutateAsync({ id: completing.id, amount, legacy });
          setCompleting(null);
        }}
      />

      <EditModal
        tx={editing}
        accounts={(accounts.data ?? []).filter((a) => !a.archived)}
        categories={categories.data ?? []}
        onClose={() => setEditing(null)}
        onSave={async (patch) => {
          if (editing) await updateTx.mutateAsync({ id: editing.id, patch });
          setEditing(null);
        }}
      />
    </div>
  );
}

function TxRow({
  tx,
  account,
  category,
  fmtDate,
  hasRates,
  onComplete,
  onEdit,
  onToggleLegacy,
  onReopen,
  onDelete,
}: {
  tx: Transaction;
  account: Account | undefined;
  category: Category | null | undefined;
  fmtDate: (iso: string) => string;
  hasRates: boolean;
  onComplete: () => void;
  onEdit: () => void;
  onToggleLegacy: () => void;
  onReopen: () => void;
  onDelete: () => void;
}) {
  const { t, locale } = useI18n();
  if (!account) return null;
  const isTransfer = tx.transferGroupId != null;
  return (
    <li className={`flex items-center gap-3 px-4 py-3 ${tx.status === "planned" ? "opacity-70" : ""}`}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">
            {tx.description || category?.name || (isTransfer ? t("tx.transfer") : "—")}
          </span>
          {isTransfer ? <Badge tone="sky">{t("tx.transfer")}</Badge> : null}
          {category && !isTransfer ? (
            <span
              className="inline-block rounded-full px-2 py-0.5 text-[10px] font-medium text-white"
              style={{ backgroundColor: category.color }}
            >
              {category.name}
            </span>
          ) : null}
          {tx.status === "planned" ? <Badge tone="amber">{t("tx.planned")}</Badge> : null}
          {tx.legacy ? <Badge tone="zinc">{t("legacy.badge")}</Badge> : null}
        </div>
        <div className="mt-0.5 text-xs text-zinc-500">
          {account.name} · {fmtDate(tx.dueDate)}
        </div>
      </div>
      <div
        className={`text-right text-sm font-semibold tabular-nums ${
          tx.direction === "income" ? "text-green-600" : "text-red-600"
        }`}
      >
        {tx.direction === "income" ? "+" : "−"}
        {formatAmount(tx.amount, account.currency, locale)}
      </div>
      <div className="flex shrink-0 gap-1">
        {tx.status === "planned" ? (
          <Button variant="primary" disabled={!hasRates} onClick={onComplete}>
            {t("tx.complete")}
          </Button>
        ) : !isTransfer ? (
          <>
            <Button
              variant="ghost"
              title={tx.legacy ? t("legacy.unmark") : t("legacy.mark")}
              onClick={onToggleLegacy}
            >
              {tx.legacy ? "↩" : "🗄"}
            </Button>
            <Button variant="ghost" onClick={onReopen}>
              {t("tx.reopen")}
            </Button>
          </>
        ) : null}
        {!isTransfer ? (
          <Button variant="ghost" aria-label={t("tx.editTitle")} title={t("tx.editTitle")} onClick={onEdit}>
            ✎
          </Button>
        ) : null}
        <Button variant="ghost" aria-label={t("common.delete")} onClick={onDelete}>
          ✕
        </Button>
      </div>
    </li>
  );
}

function EditModal({
  tx,
  accounts,
  categories,
  onClose,
  onSave,
}: {
  tx: Transaction | null;
  accounts: Account[];
  categories: Category[];
  onClose: () => void;
  onSave: (patch: Partial<Pick<Transaction, "amount" | "dueDate" | "description" | "categoryId" | "accountId">>) => Promise<void>;
}) {
  const { t } = useI18n();
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [saving, setSaving] = useState(false);
  const [key, setKey] = useState<string | null>(null);

  if (tx && key !== tx.id) {
    setKey(tx.id);
    setDescription(tx.description);
    setAmount(String(tx.amount));
    setDueDate(tx.dueDate);
    setCategoryId(tx.categoryId ?? "");
    setAccountId(tx.accountId);
  }

  const dirCategories = categories.filter((c) => !tx || c.direction === tx.direction);
  const account = accounts.find((a) => a.id === accountId);

  return (
    <Modal open={tx != null} onClose={onClose} title={t("tx.editTitle")}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (saving) return;
          setSaving(true);
          try {
            await onSave({
              description,
              amount: Number(amount),
              dueDate,
              categoryId: categoryId || null,
              accountId,
            });
          } finally {
            setSaving(false);
          }
        }}
      >
        <Field label={t("common.description")}>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={`${t("common.amount")} ${account ? `(${account.currency})` : ""}`}>
            <Input type="number" step="any" min="0" required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label={t("common.date")}>
            <Input type="date" required value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("common.account")}>
            <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.currency})
                </option>
              ))}
            </Select>
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
        {tx?.status === "completed" ? <p className="text-xs text-zinc-400">{t("tx.editCompletedHint")}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" disabled={saving || !(Number(amount) > 0)}>
            {t("common.save")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** older than this (months) → the legacy checkbox is pre-checked */
const LEGACY_AGE_MONTHS = 3;

function CompleteModal({
  tx,
  accountCurrency,
  onClose,
  onConfirm,
}: {
  tx: Transaction | null;
  accountCurrency?: string;
  onClose: () => void;
  onConfirm: (amount?: number, legacy?: boolean) => Promise<void>;
}) {
  const { t } = useI18n();
  const [amount, setAmount] = useState("");
  const [legacy, setLegacy] = useState(false);
  const [key, setKey] = useState<string | null>(null);
  if (tx && key !== tx.id) {
    setKey(tx.id);
    setAmount(String(tx.amount));
    // pre-check for items due well in the past — assume they've long since settled
    setLegacy(tx.dueDate < addMonthsClamped(todayISO(), -LEGACY_AGE_MONTHS));
  }
  return (
    <Modal open={tx != null} onClose={onClose} title={t("tx.completeTitle")}>
      <div className="space-y-3">
        <p className="text-sm text-zinc-500">{t("tx.completeHint")}</p>
        <Field label={`${t("tx.finalAmount")} (${accountCurrency ?? ""})`}>
          <Input type="number" step="any" min="0" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <label className="flex items-start gap-2 rounded-lg bg-[var(--edge-soft)] p-3">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-teal-600" checked={legacy} onChange={(e) => setLegacy(e.target.checked)} />
          <span>
            <span className="block text-sm font-medium">{t("legacy.completeAs")}</span>
            <span className="block text-xs text-zinc-500">{t("legacy.completeHint")}</span>
          </span>
        </label>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={() => onConfirm(Number(amount) || undefined, legacy)}>
            {t("common.confirm")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
