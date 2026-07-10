"use client";

import { useMemo, useState } from "react";
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Select, Spinner } from "@/components/ui";
import { TransactionModal } from "@/components/transactionModal";
import { TransferModal } from "@/components/transferModal";
import { useRepo } from "@/lib/data/provider";
import { KEYS, useAccounts, useAppMutation, useCategories, useRates, useTransactions } from "@/lib/data/queries";
import { Transaction, TxDirection, TxStatus } from "@/lib/data/types";
import { formatAmount } from "@/lib/domain/currencies";
import { snapshotFromTable } from "@/lib/domain/fx";
import { addMonthsClamped, todayISO } from "@/lib/domain/recurrence";
import { useFormatDate } from "@/lib/useFormatDate";
import { useI18n } from "@/lib/i18n";

export default function TransactionsPage() {
  const { t, locale } = useI18n();
  const fmtDate = useFormatDate();
  const repo = useRepo();
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

  const invalidate = [KEYS.transactions, KEYS.accounts];
  const deleteTx = useAppMutation((id: string) => repo.deleteTransaction(id), invalidate);
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
        <Card>
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {filtered.map((tx) => {
              const account = accountById.get(tx.accountId);
              const category = tx.categoryId ? categoryById.get(tx.categoryId) : null;
              if (!account) return null;
              const isTransfer = tx.transferGroupId != null;
              return (
                <li key={tx.id} className={`flex items-center gap-3 px-4 py-3 ${tx.status === "planned" ? "opacity-70" : ""}`}>
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
                      <Button variant="primary" disabled={!rates.data} onClick={() => setCompleting(tx)}>
                        {t("tx.complete")}
                      </Button>
                    ) : !isTransfer ? (
                      <>
                        <Button
                          variant="ghost"
                          title={tx.legacy ? t("legacy.unmark") : t("legacy.mark")}
                          onClick={() => toggleLegacy.mutate({ id: tx.id, legacy: !tx.legacy })}
                        >
                          {tx.legacy ? "↩" : "🗄"}
                        </Button>
                        <Button variant="ghost" onClick={() => reopenTx.mutate(tx.id)}>
                          {t("tx.reopen")}
                        </Button>
                      </>
                    ) : null}
                    <Button
                      variant="ghost"
                      aria-label={t("common.delete")}
                      onClick={() => window.confirm(t("common.confirmDelete")) && deleteTx.mutate(tx.id)}
                    >
                      ✕
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
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
    </div>
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
