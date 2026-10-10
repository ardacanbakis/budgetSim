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
 * Record what you pay a card this month: the statement amount, from your
 * bank. It's the expense (lib/domain/cards.ts), and once it's made it covers
 * the card's charges from before this month, so none of them need ticking.
 * The suggestion adds up those charges where any are logged; the statement
 * itself is the real number.
 */
export function CardPaymentModal({
  card,
  suggested,
  covers,
  onClose,
}: {
  card: Account | null;
  suggested: number;
  /** the charges this payment will cover */
  covers: Transaction[];
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
          await createTransfer.mutateAsync({
            fromAccountId: from.id,
            toAccountId: card.id,
            fromAmount,
            toAmount,
            date,
            description: `${card.name} statement`,
            marketRate: null,
            fxSnapshot: snapshotFromTable(rates.data),
          });
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
        {covers.length > 0 ? (
          <p className="text-xs text-zinc-500">
            {t("cards.willPost", { count: covers.length })}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          {/* the rates frozen onto the payment are still loading for a moment
              after the page opens; until then a tap would do nothing at all */}
          <Button type="submit" variant="primary" disabled={!from || !rates.data || !(toAmount > 0) || createTransfer.isPending}>
            {t("cards.recordPayment")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
