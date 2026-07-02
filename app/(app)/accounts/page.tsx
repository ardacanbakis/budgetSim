"use client";

import { useMemo, useState } from "react";
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Select, Spinner } from "@/components/ui";
import { useApp, useRepo } from "@/lib/data/provider";
import { KEYS, useAccounts, useAppMutation, useRates, useTransactions } from "@/lib/data/queries";
import { NewAccount } from "@/lib/data/repo";
import { Account } from "@/lib/data/types";
import { computeBalances } from "@/lib/domain/balances";
import { CURRENCIES, CURRENCY_META, Currency, formatAmount } from "@/lib/domain/currencies";
import { convert } from "@/lib/domain/fx";
import { useI18n } from "@/lib/i18n";

export default function AccountsPage() {
  const { t, locale } = useI18n();
  const repo = useRepo();
  const { displayCurrency } = useApp();
  const accounts = useAccounts();
  const transactions = useTransactions();
  const rates = useRates();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);

  const createAccount = useAppMutation((input: NewAccount) => repo.createAccount(input), [KEYS.accounts]);
  const updateAccount = useAppMutation(
    (v: { id: string; patch: Partial<NewAccount> & { archived?: boolean } }) => repo.updateAccount(v.id, v.patch),
    [KEYS.accounts, KEYS.transactions]
  );
  const deleteAccount = useAppMutation((id: string) => repo.deleteAccount(id), [KEYS.accounts, KEYS.transactions]);

  const balances = useMemo(
    () => (accounts.data && transactions.data ? computeBalances(accounts.data, transactions.data) : new Map<string, number>()),
    [accounts.data, transactions.data]
  );

  if (accounts.isLoading || transactions.isLoading) return <Spinner />;

  const list = accounts.data ?? [];
  const active = list.filter((a) => !a.archived);
  const archived = list.filter((a) => a.archived);

  function renderAccount(account: Account) {
    const balance = balances.get(account.id) ?? 0;
    const converted = rates.data ? convert(balance, account.currency, displayCurrency, rates.data.usdPer) : null;
    return (
      <Card key={account.id} className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold">{account.name}</span>
              <Badge tone={account.kind === "crypto" ? "sky" : account.kind === "gold" ? "amber" : "zinc"}>
                {t(`currency.${account.currency}`)}
              </Badge>
              {account.archived ? <Badge tone="red">{t("accounts.archived")}</Badge> : null}
            </div>
            <div className="mt-2 text-2xl font-bold tabular-nums">{formatAmount(balance, account.currency, locale)}</div>
            {account.currency !== displayCurrency ? (
              <div className="text-sm text-zinc-500">
                {converted != null ? `≈ ${formatAmount(converted, displayCurrency, locale)}` : t("common.rateUnavailable")}
              </div>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <Button variant="ghost" onClick={() => setEditing(account)}>
              {t("common.edit")}
            </Button>
            <Button
              variant="ghost"
              onClick={() => updateAccount.mutate({ id: account.id, patch: { archived: !account.archived } })}
            >
              {account.archived ? t("accounts.unarchive") : t("accounts.archive")}
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 3xl:max-w-7xl">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">{t("accounts.title")}</h1>
        <Button variant="primary" onClick={() => setModalOpen(true)}>
          + {t("accounts.newAccount")}
        </Button>
      </div>

      {active.length === 0 && archived.length === 0 ? (
        <EmptyState>{t("accounts.empty")}</EmptyState>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 3xl:grid-cols-4">{active.map(renderAccount)}</div>
      )}

      {archived.length > 0 ? (
        <details className="pt-2">
          <summary className="cursor-pointer text-sm text-zinc-500">
            {t("accounts.archived")} ({archived.length})
          </summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3 3xl:grid-cols-4">{archived.map(renderAccount)}</div>
        </details>
      ) : null}

      <AccountModal
        open={modalOpen || editing != null}
        initial={editing}
        onClose={() => {
          setModalOpen(false);
          setEditing(null);
        }}
        onSave={async (input) => {
          if (editing) await updateAccount.mutateAsync({ id: editing.id, patch: input });
          else await createAccount.mutateAsync(input);
          setModalOpen(false);
          setEditing(null);
        }}
        onDelete={
          editing
            ? async () => {
                if (window.confirm(t("accounts.deleteWarning"))) {
                  await deleteAccount.mutateAsync(editing.id);
                  setEditing(null);
                }
              }
            : undefined
        }
      />
    </div>
  );
}

function AccountModal({
  open,
  initial,
  onClose,
  onSave,
  onDelete,
}: {
  open: boolean;
  initial: Account | null;
  onClose: () => void;
  onSave: (input: NewAccount) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState<Currency>("TRY");
  const [opening, setOpening] = useState("0");
  const [initialized, setInitialized] = useState<string | null>(null);

  // re-init form when target changes
  const targetKey = initial?.id ?? (open ? "new" : "closed");
  if (open && initialized !== targetKey) {
    setInitialized(targetKey);
    setName(initial?.name ?? "");
    setCurrency(initial?.currency ?? "TRY");
    setOpening(String(initial?.openingBalance ?? 0));
  }

  return (
    <Modal open={open} onClose={onClose} title={initial ? t("common.edit") : t("accounts.newAccount")}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          await onSave({
            name,
            currency,
            kind: CURRENCY_META[currency].kind,
            openingBalance: Number(opening) || 0,
          });
        }}
      >
        <Field label={t("common.name")}>
          <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Ziraat TRY" />
        </Field>
        <Field label={t("common.currency")}>
          <Select value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {t(`currency.${c}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("accounts.openingBalance")}>
          <Input
            type="number"
            step="any"
            inputMode="decimal"
            value={opening}
            onChange={(e) => setOpening(e.target.value)}
          />
        </Field>
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
            <Button type="submit" variant="primary">
              {t("common.save")}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
