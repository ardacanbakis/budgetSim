"use client";

import { useState } from "react";
import { Button, Field, Input, Modal, Select } from "@/components/ui";
import { useRepo } from "@/lib/data/provider";
import { KEYS, useAccounts, useAppMutation, useRates } from "@/lib/data/queries";
import { NewTransfer } from "@/lib/data/repo";
import { formatAmount } from "@/lib/domain/currencies";
import { convert, snapshotFromTable } from "@/lib/domain/fx";
import { roundTo } from "@/lib/domain/money";
import { DueCardPayment } from "@/lib/domain/purchases";
import { todayISO } from "@/lib/domain/recurrence";
import { useI18n } from "@/lib/i18n";

const dismissKey = (cardId: string) => `cc-pay-dismissed-${cardId}-${todayISO().slice(0, 7)}`;

/**
 * "Did you pay the card bill?" — shown when a card has posted debt from a
 * previous month and no payment recorded this month. Confirm records a
 * transfer from the card's default payment account (editable); "Not now"
 * snoozes for the rest of the month on this device.
 */
export function CardPaymentReminder({ duePayments }: { duePayments: DueCardPayment[] }) {
  const { t, locale } = useI18n();
  const repo = useRepo();
  const accounts = useAccounts();
  const rates = useRates();
  const [dismissTick, setDismissTick] = useState(0);
  const [paying, setPaying] = useState<DueCardPayment | null>(null);
  const [fromId, setFromId] = useState("");
  const [amount, setAmount] = useState("");

  const createTransfer = useAppMutation((input: NewTransfer) => repo.createTransfer(input), [
    KEYS.transactions,
    KEYS.accounts,
  ]);

  const visible = duePayments.filter(
    (d) => typeof window === "undefined" || !window.localStorage.getItem(dismissKey(d.account.id))
  );
  // dismissTick only forces re-evaluation after a snooze
  void dismissTick;
  if (visible.length === 0) return null;

  const active = (accounts.data ?? []).filter((a) => !a.archived && a.kind !== "credit_card");
  const payment = paying ?? visible[0];
  const from =
    active.find((a) => a.id === fromId) ??
    active.find((a) => a.id === payment.account.paymentAccountId) ??
    active[0];
  const suggested = payment.suggestedAmount;
  const fromAmountMarket =
    from && rates.data ? convert(suggested, payment.account.currency, from.currency, rates.data.usdPer) : null;
  const shownAmount = amount || (suggested ? String(suggested) : "");

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-950">
        <div className="text-sm text-amber-800 dark:text-amber-200">
          <span className="font-semibold">{t("purchases.payReminderTitle")}</span>{" "}
          {t("purchases.payReminderBody", {
            card: visible[0].account.name,
            amount: formatAmount(visible[0].suggestedAmount, visible[0].account.currency, locale),
          })}
        </div>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            onClick={() => {
              window.localStorage.setItem(dismissKey(visible[0].account.id), "1");
              setDismissTick((n) => n + 1);
            }}
          >
            {t("purchases.payLater")}
          </Button>
          <Button variant="primary" onClick={() => setPaying(visible[0])}>
            {t("purchases.payConfirm")}
          </Button>
        </div>
      </div>

      <Modal open={paying != null} onClose={() => setPaying(null)} title={`${t("purchases.payConfirm")} — ${payment.account.name}`}>
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!from || !rates.data) return;
            const toAmount = roundTo(Number(shownAmount), payment.account.currency);
            const fromAmount =
              from.currency === payment.account.currency
                ? toAmount
                : roundTo(
                    convert(toAmount, payment.account.currency, from.currency, rates.data.usdPer) ?? toAmount,
                    from.currency
                  );
            await createTransfer.mutateAsync({
              fromAccountId: from.id,
              toAccountId: payment.account.id,
              fromAmount,
              toAmount,
              date: todayISO(),
              description: `${payment.account.name} statement`,
              marketRate: null,
              fxSnapshot: snapshotFromTable(rates.data),
            });
            setPaying(null);
            setAmount("");
          }}
        >
          <Field label={t("purchases.payFrom")}>
            <Select value={from?.id ?? ""} onChange={(e) => setFromId(e.target.value)}>
              {active.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.currency})
                </option>
              ))}
            </Select>
          </Field>
          <Field label={`${t("common.amount")} (${payment.account.currency})`}>
            <Input
              type="number"
              step="any"
              min="0"
              required
              inputMode="decimal"
              value={shownAmount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
          {from && from.currency !== payment.account.currency && fromAmountMarket != null ? (
            <p className="text-xs text-zinc-500">
              ≈ {formatAmount(fromAmountMarket, from.currency, locale)} {t("transfer.fromAmount").toLowerCase()}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" onClick={() => setPaying(null)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="primary" disabled={!from || createTransfer.isPending || Number(shownAmount) <= 0}>
              {t("common.confirm")}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
