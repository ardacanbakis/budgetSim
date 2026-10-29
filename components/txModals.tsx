"use client";

import { useState } from "react";
import { Button, Field, Input, Modal, Select } from "@/components/ui";
import { Account, Category, Transaction } from "@/lib/data/types";
import { addMonthsClamped, todayISO } from "@/lib/domain/recurrence";
import { useI18n } from "@/lib/i18n";

/**
 * The two forms a ledger row opens in Classic, shared by Transactions' Ledger
 * tab and Reports' Timeline:
 * - EditModal: description, amount, date, account and category of one row.
 * - CompleteModal: mark a planned row done, at its amount or another, and
 *   optionally as legacy (pre-ticked when it was due over three months ago).
 * Each is open while its `tx` is set; the caller does the write.
 */

export function EditModal({
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

export function CompleteModal({
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
