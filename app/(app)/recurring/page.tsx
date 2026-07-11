"use client";

import { useState } from "react";
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Select, Spinner } from "@/components/ui";
import { useRepo } from "@/lib/data/provider";
import { KEYS, useAccounts, useAppMutation, useCategories, useTemplates } from "@/lib/data/queries";
import { NewTemplate } from "@/lib/data/repo";
import { Frequency, RecurringTemplate, TxDirection } from "@/lib/data/types";
import { formatAmount } from "@/lib/domain/currencies";
import { todayISO } from "@/lib/domain/recurrence";
import { useI18n } from "@/lib/i18n";

export default function RecurringPage() {
  const { t, locale } = useI18n();
  const repo = useRepo();
  const templates = useTemplates();
  const accounts = useAccounts();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<RecurringTemplate | null>(null);

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

  if (templates.isLoading || accounts.isLoading) return <Spinner />;

  const list = templates.data ?? [];
  const accountById = new Map((accounts.data ?? []).map((a) => [a.id, a]));

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
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 3xl:grid-cols-4">
          {list.map((tpl) => {
            const account = accountById.get(tpl.accountId);
            return (
              <Card key={tpl.id} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{tpl.name}</span>
                      {tpl.loanId ? <Badge tone="sky">{t("recurring.linkedLoan")}</Badge> : null}
                      {tpl.autoComplete ? <Badge tone="green">{t("recurring.autoComplete")}</Badge> : null}
                    </div>
                    <div
                      className={`mt-1 text-lg font-bold tabular-nums ${tpl.direction === "income" ? "text-emerald-600" : ""}`}
                    >
                      {tpl.direction === "income" ? "+" : "−"}
                      {account ? formatAmount(tpl.amount, account.currency, locale) : tpl.amount}
                    </div>
                    <div className="mt-0.5 text-xs text-zinc-500">
                      {t(`recurring.${tpl.frequency}`)} · {account?.name} · {tpl.startDate}
                      {tpl.endDate ? ` → ${tpl.endDate}` : ""}
                    </div>
                  </div>
                  {!tpl.loanId ? (
                    <Button variant="ghost" onClick={() => setEditing(tpl)}>
                      {t("common.edit")}
                    </Button>
                  ) : null}
                </div>
              </Card>
            );
          })}
        </div>
      )}

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
