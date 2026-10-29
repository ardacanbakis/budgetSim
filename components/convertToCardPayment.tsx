"use client";

import { useState } from "react";
import { Button, Field, Modal, Select } from "@/components/ui";
import { useRepo } from "@/lib/data/provider";
import { KEYS, useAccounts, useAppMutation, useRates } from "@/lib/data/queries";
import type { Account, Transaction } from "@/lib/data/types";
import { guessCardFor } from "@/lib/domain/cards";
import { formatAmount } from "@/lib/domain/currencies";
import { convert, snapshotFromTable } from "@/lib/domain/fx";
import { roundTo } from "@/lib/domain/money";
import { todayISO } from "@/lib/domain/recurrence";
import { useFormatDate } from "@/lib/useFormatDate";
import { useI18n } from "@/lib/i18n";

/** A planned expense that could be a card's statement: not a transfer, not yet due. */
export function canBeCardPayment(tx: Transaction, accounts: readonly Account[]): boolean {
  const account = accounts.find((a) => a.id === tx.accountId);
  return (
    tx.status === "planned" &&
    tx.direction === "expense" &&
    tx.transferGroupId == null &&
    tx.dueDate >= todayISO() &&
    account != null &&
    account.kind !== "credit_card" &&
    accounts.some((a) => a.kind === "credit_card" && !a.archived)
  );
}

/**
 * Turns a planned expense ("draft November - Akbank") into a planned payment
 * into a card, same amount and date. As a plain expense the card can't tell
 * it's its statement, so the plan pays that statement's installments again
 * on top of it; as a card payment it covers them (lib/domain/cards.ts).
 */
export function ConvertToCardPaymentModal({ tx, onClose }: { tx: Transaction | null; onClose: () => void }) {
  const { t, locale } = useI18n();
  const fmtDate = useFormatDate();
  const repo = useRepo();
  const accounts = useAccounts();
  const rates = useRates();
  const [cardId, setCardId] = useState("");

  const convertIt = useAppMutation(
    async (v: { tx: Transaction; from: Account; card: Account }) => {
      const toAmount =
        v.from.currency === v.card.currency || !rates.data
          ? v.tx.amount
          : roundTo(convert(v.tx.amount, v.from.currency, v.card.currency, rates.data.usdPer) ?? v.tx.amount, v.card.currency);
      await repo.createTransfer({
        fromAccountId: v.from.id,
        toAccountId: v.card.id,
        fromAmount: v.tx.amount,
        toAmount,
        date: v.tx.dueDate,
        description: v.tx.description || `${v.card.name} statement`,
        marketRate: null,
        fxSnapshot: rates.data ? snapshotFromTable(rates.data) : null,
      });
      await repo.deleteTransaction(v.tx.id);
    },
    [KEYS.transactions, KEYS.accounts]
  );

  if (!tx) return null;
  const all = accounts.data ?? [];
  const from = all.find((a) => a.id === tx.accountId);
  const cards = all.filter((a) => a.kind === "credit_card" && !a.archived);
  const card = cards.find((c) => c.id === cardId) ?? guessCardFor(tx.description, cards) ?? cards[0];
  if (!from || !card) return null;

  return (
    <Modal open onClose={onClose} title={t("tx.toCardPaymentTitle")}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          await convertIt.mutateAsync({ tx, from, card });
          onClose();
        }}
      >
        <p className="text-sm text-zinc-500">
          {t("tx.toCardPaymentHint", {
            description: tx.description || "—",
            amount: formatAmount(tx.amount, from.currency, locale),
            account: from.name,
            date: fmtDate(tx.dueDate),
          })}
        </p>
        <Field label={t("tx.toCardPaymentCard")}>
          <Select value={card.id} onChange={(e) => setCardId(e.target.value)} data-convert-card>
            {cards.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" disabled={convertIt.isPending}>
            {t("tx.toCardPaymentConfirm")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
