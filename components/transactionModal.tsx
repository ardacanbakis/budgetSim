"use client";

import { useState } from "react";
import { Button, Field, Input, Modal, Select } from "@/components/ui";
import { useRepo } from "@/lib/data/provider";
import {
  KEYS,
  useAccounts,
  useAppMutation,
  useBudgets,
  useCategories,
  useRates,
  useTransactions,
} from "@/lib/data/queries";
import { NewTransaction } from "@/lib/data/repo";
import { TxDirection, TxStatus } from "@/lib/data/types";
import { budgetStatuses, budgetWarningFor } from "@/lib/domain/budgets";
import { formatAmount } from "@/lib/domain/currencies";
import { snapshotFromTable } from "@/lib/domain/fx";
import { todayISO } from "@/lib/domain/recurrence";
import { useI18n } from "@/lib/i18n";

/**
 * Shared new-transaction form (transactions page + global quick-add).
 * Saves through the repo itself and shows the live budget warning.
 */
export function TransactionModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, locale } = useI18n();
  const repo = useRepo();
  const accounts = useAccounts();
  const categories = useCategories();
  const budgets = useBudgets();
  const transactions = useTransactions();
  const rates = useRates();
  const [direction, setDirection] = useState<TxDirection>("expense");
  const [accountId, setAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<TxStatus>("completed");
  const [dueDate, setDueDate] = useState(todayISO());
  const [description, setDescription] = useState("");

  const createTx = useAppMutation((input: NewTransaction) => repo.createTransaction(input), [
    KEYS.transactions,
    KEYS.accounts,
  ]);

  const activeAccounts = (accounts.data ?? []).filter((a) => !a.archived);
  const effectiveAccount = accountId || activeAccounts[0]?.id || "";
  const dirCategories = (categories.data ?? []).filter((c) => c.direction === direction);
  const hasRates = Boolean(rates.data);

  // live budget check while entering an expense
  const account = activeAccounts.find((a) => a.id === effectiveAccount);
  const budgetWarning =
    direction === "expense" && account && budgets.data && transactions.data && accounts.data && rates.data
      ? budgetWarningFor({
          budgets: budgets.data,
          statuses: budgetStatuses({
            budgets: budgets.data,
            transactions: transactions.data,
            accounts: accounts.data,
            usdPer: rates.data.usdPer,
            month: todayISO().slice(0, 7),
          }),
          categoryId: categoryId || null,
          amount: Number(amount),
          currency: account.currency,
          usdPer: rates.data.usdPer,
        })
      : null;
  const warnCategory = (categories.data ?? []).find((c) => c.id === categoryId);

  return (
    <Modal open={open} onClose={onClose} title={t("tx.newTransaction")}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          await createTx.mutateAsync({
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
          onClose();
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
          <Input type="number" step="any" min="0" inputMode="decimal" required autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} />
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
        {budgetWarning ? (
          <p className={`rounded-lg px-3 py-2 text-xs ${budgetWarning.level === "over" ? "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300" : "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300"}`}>
            {budgetWarning.level === "over"
              ? t("budgets.entryOver", {
                  category: warnCategory?.name ?? "",
                  limit: formatAmount(budgetWarning.limit, budgetWarning.currency, locale),
                })
              : t("budgets.entryWarn", {
                  category: warnCategory?.name ?? "",
                  spent: formatAmount(budgetWarning.spent, budgetWarning.currency, locale),
                  limit: formatAmount(budgetWarning.limit, budgetWarning.currency, locale),
                })}
          </p>
        ) : null}
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
          <Button type="submit" variant="primary" disabled={createTx.isPending || (status === "completed" && !hasRates)}>
            {t("common.save")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
