"use client";

import { useState } from "react";
import { Button, Field, Input, Modal, Select } from "@/components/ui";
import { useRepo } from "@/lib/data/provider";
import { KEYS, useAccounts, useAppMutation, useRates } from "@/lib/data/queries";
import { NewTransfer } from "@/lib/data/repo";
import type { Account, Transaction } from "@/lib/data/types";
import { formatAmount } from "@/lib/domain/currencies";
import { convert, snapshotFromTable } from "@/lib/domain/fx";
import { roundTo } from "@/lib/domain/money";
import { todayISO } from "@/lib/domain/recurrence";
import { useI18n } from "@/lib/i18n";

/**
 * Record what you actually paid a card this month. The suggested figure is the
 * whole statement — everything already posted plus every installment falling
 * due — because that's the single number you really transfer. Paying also
 * posts those installments, so the card balance nets out instead of
 * double-counting them.
 */
export function CardPaymentModal({
  card,
  suggested,
  installmentsDue,
  onClose,
}: {
  card: Account | null;
  suggested: number;
  installmentsDue: Transaction[];
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const repo = useRepo();
  const accounts = useAccounts();
  const rates = useRates();
  const [fromId, setFromId] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayISO());
  const [key, setKey] = useState<string | null>(null);

  // re-key on open so each card starts from its own suggestion
  const target = card?.id ?? "closed";
  if (key !== target) {
    setKey(target);
    setAmount(suggested > 0 ? String(roundTo(suggested, card?.currency ?? "TRY")) : "");
    setDate(todayISO());
    setFromId("");
  }

  const createTransfer = useAppMutation((input: NewTransfer) => repo.createTransfer(input), [
    KEYS.transactions,
    KEYS.accounts,
  ]);
  const completeInstallments = useAppMutation(
    (v: { ids: string[]; snapshot: ReturnType<typeof snapshotFromTable> }) =>
      Promise.all(v.ids.map((id) => repo.completeTransaction(id, v.snapshot))).then(() => undefined),
    [KEYS.transactions, KEYS.accounts, KEYS.purchases]
  );

  const payFrom = (accounts.data ?? []).filter((a) => !a.archived && a.kind !== "credit_card");
  const from =
    payFrom.find((a) => a.id === fromId) ??
    payFrom.find((a) => a.id === card?.paymentAccountId) ??
    payFrom[0];

  if (!card) return null;

  const toAmount = roundTo(Number(amount) || 0, card.currency);
  const fromAmount =
    from && rates.data && from.currency !== card.currency
      ? roundTo(convert(toAmount, card.currency, from.currency, rates.data.usdPer) ?? toAmount, from.currency)
      : toAmount;

  return (
    <Modal open onClose={onClose} title={`${t("cards.recordPayment")} — ${card.name}`}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!from || !rates.data || !(toAmount > 0)) return;
          const snapshot = snapshotFromTable(rates.data);
          await createTransfer.mutateAsync({
            fromAccountId: from.id,
            toAccountId: card.id,
            fromAmount,
            toAmount,
            date,
            description: `${card.name} statement`,
            marketRate: null,
            fxSnapshot: snapshot,
          });
          // the statement covered these, so post them rather than leave them
          // planned and counted twice
          if (installmentsDue.length > 0) {
            await completeInstallments.mutateAsync({ ids: installmentsDue.map((x) => x.id), snapshot });
          }
          onClose();
        }}
      >
        <p className="text-xs text-zinc-500">{t("cards.recordPaymentHint")}</p>
        <Field label={t("purchases.payFrom")}>
          <Select value={from?.id ?? ""} onChange={(e) => setFromId(e.target.value)}>
            {payFrom.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.currency})
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={`${t("common.amount")} (${card.currency})`}>
            <Input
              type="number"
              step="any"
              min="0"
              required
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
          <Field label={t("common.date")}>
            <Input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        {from && from.currency !== card.currency ? (
          <p className="text-xs text-zinc-500">
            {t("cards.leavesAccount", {
              amount: formatAmount(fromAmount, from.currency, locale),
              account: from.name,
            })}
          </p>
        ) : null}
        {installmentsDue.length > 0 ? (
          <p className="text-xs text-zinc-500">
            {t("cards.willPost", { count: installmentsDue.length })}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" variant="primary" disabled={!from || !(toAmount > 0) || createTransfer.isPending}>
            {t("cards.recordPayment")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
