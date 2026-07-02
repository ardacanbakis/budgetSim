"use client";

import { useMemo, useState } from "react";
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Select, Spinner } from "@/components/ui";
import { TransferModal } from "@/components/transferModal";
import { useRepo } from "@/lib/data/provider";
import { KEYS, useAccounts, useAppMutation, useCategories, useRates, useTransactions } from "@/lib/data/queries";
import { NewTransaction } from "@/lib/data/repo";
import { Transaction, TxDirection, TxStatus } from "@/lib/data/types";
import { formatAmount } from "@/lib/domain/currencies";
import { snapshotFromTable } from "@/lib/domain/fx";
import { todayISO } from "@/lib/domain/recurrence";
import { useI18n } from "@/lib/i18n";

export default function TransactionsPage() {
  const { t, locale } = useI18n();
  const repo = useRepo();
  const accounts = useAccounts();
  const categories = useCategories();
  const transactions = useTransactions();
  const rates = useRates();

  const [filterAccount, setFilterAccount] = useState("all");
  const [filterStatus, setFilterStatus] = useState<"all" | TxStatus>("all");
  const [filterDirection, setFilterDirection] = useState<"all" | TxDirection>("all");
  const [txModal, setTxModal] = useState(false);
  const [transferModal, setTransferModal] = useState(false);
  const [completing, setCompleting] = useState<Transaction | null>(null);

  const invalidate = [KEYS.transactions, KEYS.accounts];
  const createTx = useAppMutation((input: NewTransaction) => repo.createTransaction(input), invalidate);
  const deleteTx = useAppMutation((id: string) => repo.deleteTransaction(id), invalidate);
  const reopenTx = useAppMutation((id: string) => repo.reopenTransaction(id), invalidate);
  const completeTx = useAppMutation(
    (v: { id: string; amount?: number }) => repo.completeTransaction(v.id, snapshotFromTable(rates.data!), v.amount),
    invalidate
  );

  const accountById = useMemo(() => new Map((accounts.data ?? []).map((a) => [a.id, a])), [accounts.data]);
  const categoryById = useMemo(() => new Map((categories.data ?? []).map((c) => [c.id, c])), [categories.data]);

  const filtered = useMemo(() => {
    let list = transactions.data ?? [];
    if (filterAccount !== "all") list = list.filter((tx) => tx.accountId === filterAccount);
    if (filterStatus !== "all") list = list.filter((tx) => tx.status === filterStatus);
    if (filterDirection !== "all") list = list.filter((tx) => tx.direction === filterDirection);
    return [...list].sort((a, b) => (a.dueDate < b.dueDate ? 1 : a.dueDate > b.dueDate ? -1 : 0));
  }, [transactions.data, filterAccount, filterStatus, filterDirection]);

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
      </div>

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
                    </div>
                    <div className="mt-0.5 text-xs text-zinc-500">
                      {account.name} · {tx.dueDate}
                    </div>
                  </div>
                  <div
                    className={`text-right text-sm font-semibold tabular-nums ${
                      tx.direction === "income" ? "text-emerald-600" : "text-zinc-800 dark:text-zinc-200"
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
                      <Button variant="ghost" onClick={() => reopenTx.mutate(tx.id)}>
                        {t("tx.reopen")}
                      </Button>
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

      <TransactionModal
        open={txModal}
        onClose={() => setTxModal(false)}
        onSave={async (input) => {
          await createTx.mutateAsync(input);
          setTxModal(false);
        }}
        hasRates={Boolean(rates.data)}
      />

      <TransferModal open={transferModal} onClose={() => setTransferModal(false)} />

      <CompleteModal
        tx={completing}
        accountCurrency={completing ? accountById.get(completing.accountId)?.currency : undefined}
        onClose={() => setCompleting(null)}
        onConfirm={async (amount) => {
          if (completing) await completeTx.mutateAsync({ id: completing.id, amount });
          setCompleting(null);
        }}
      />
    </div>
  );
}

function TransactionModal({
  open,
  onClose,
  onSave,
  hasRates,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (input: NewTransaction) => Promise<void>;
  hasRates: boolean;
}) {
  const { t } = useI18n();
  const accounts = useAccounts();
  const categories = useCategories();
  const rates = useRates();
  const [direction, setDirection] = useState<TxDirection>("expense");
  const [accountId, setAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<TxStatus>("completed");
  const [dueDate, setDueDate] = useState(todayISO());
  const [description, setDescription] = useState("");

  const activeAccounts = (accounts.data ?? []).filter((a) => !a.archived);
  const effectiveAccount = accountId || activeAccounts[0]?.id || "";
  const dirCategories = (categories.data ?? []).filter((c) => c.direction === direction);

  return (
    <Modal open={open} onClose={onClose} title={t("tx.newTransaction")}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          await onSave({
            accountId: effectiveAccount,
            direction,
            categoryId: categoryId || null,
            amount: Number(amount),
            status,
            dueDate,
            description,
            fxSnapshot: status === "completed" && rates.data ? snapshotFromTable(rates.data) : null,
          });
          setAmount("");
          setDescription("");
        }}
      >
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant={direction === "expense" ? "primary" : "secondary"}
            onClick={() => setDirection("expense")}
          >
            {t("tx.expense")}
          </Button>
          <Button
            type="button"
            variant={direction === "income" ? "primary" : "secondary"}
            onClick={() => setDirection("income")}
          >
            {t("tx.income")}
          </Button>
        </div>
        <Field label={t("common.account")}>
          <Select required value={effectiveAccount} onChange={(e) => setAccountId(e.target.value)}>
            {activeAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.currency})
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("common.amount")}>
          <Input type="number" step="any" min="0" inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)} />
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
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("tx.dueDate")}>
            <Input type="date" required value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
          <Field label={t("common.status")}>
            <Select value={status} onChange={(e) => setStatus(e.target.value as TxStatus)}>
              <option value="completed">{t("tx.completed")}</option>
              <option value="planned">{t("tx.planned")}</option>
            </Select>
          </Field>
        </div>
        <Field label={`${t("common.description")} (${t("common.optional")})`}>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" disabled={status === "completed" && !hasRates}>
            {t("common.save")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function CompleteModal({
  tx,
  accountCurrency,
  onClose,
  onConfirm,
}: {
  tx: Transaction | null;
  accountCurrency?: string;
  onClose: () => void;
  onConfirm: (amount?: number) => Promise<void>;
}) {
  const { t } = useI18n();
  const [amount, setAmount] = useState("");
  const [key, setKey] = useState<string | null>(null);
  if (tx && key !== tx.id) {
    setKey(tx.id);
    setAmount(String(tx.amount));
  }
  return (
    <Modal open={tx != null} onClose={onClose} title={t("tx.completeTitle")}>
      <div className="space-y-3">
        <p className="text-sm text-zinc-500">{t("tx.completeHint")}</p>
        <Field label={`${t("tx.finalAmount")} (${accountCurrency ?? ""})`}>
          <Input type="number" step="any" min="0" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={() => onConfirm(Number(amount) || undefined)}>
            {t("common.confirm")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
