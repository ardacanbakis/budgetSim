"use client";

import { useId, useState } from "react";
import { Transaction } from "@/lib/data/types";
import { CURRENCY_META } from "@/lib/domain/currencies";
import { amountForEditing, parseTypedAmount } from "@/lib/domain/money";
import { useI18n } from "@/lib/i18n";
import { isLongOverdue } from "@/lib/ui/pocket/attention";
import { dayDate } from "@/lib/ui/pocket/dayGroups";
import { describeTx, useTxLookup } from "./dayList";
import { Money } from "./kit";
import { PocketSheet } from "./sheet";

/**
 * Completing a planned row at another amount: Classic's CompleteModal, as a
 * Pocket sheet, without importing the page.
 *
 * - PocketPaidAmountSheet({ tx, onClose, onConfirm }): open while tx is set.
 *   The amount is in the row's account currency, typed as a bank writes it
 *   ("12.465,50" or "12,465.50", read by parseTypedAmount) in a 16px decimal
 *   field.
 * - "Complete as legacy" is a switch, already on for a row due more than
 *   three months ago (isLongOverdue: the CompleteModal rule).
 * - Confirm waits for live rates, then hands { amount, legacy } to onConfirm
 *   and closes. Wire it to useTxActions().complete(tx, paid), which calls
 *   completeTransaction(id, snapshot, amount, legacy) and offers Undo —
 *   usePocketTxSheet() in txActions.tsx does exactly that.
 */
export interface PaidAmount {
  amount: number;
  legacy: boolean;
}

export function PocketPaidAmountSheet({
  tx,
  onClose,
  onConfirm,
}: {
  tx: Transaction | null;
  onClose: () => void;
  onConfirm: (paid: PaidAmount) => void;
}) {
  if (!tx) return null;
  // a fresh form per row: the amount and the switch start from that row
  return <PaidAmountForm key={tx.id} tx={tx} onClose={onClose} onConfirm={onConfirm} />;
}

function PaidAmountForm({
  tx,
  onClose,
  onConfirm,
}: {
  tx: Transaction;
  onClose: () => void;
  onConfirm: (paid: PaidAmount) => void;
}) {
  const { t, locale } = useI18n();
  const lookup = useTxLookup();
  const ready = lookup.ratesReady;
  const account = lookup.accountsById.get(tx.accountId);
  const currency = account?.currency ?? "TRY";
  const [text, setText] = useState(() => amountForEditing(tx.amount, currency, locale));
  const [legacy, setLegacy] = useState(() => isLongOverdue(tx, lookup.today));
  const [touched, setTouched] = useState(false);

  const d = describeTx(tx, lookup, t);
  const amount = parseTypedAmount(text, CURRENCY_META[currency].decimals);
  const valid = Number.isFinite(amount) && amount > 0;
  const unit = currency === "XAU_G" ? "g" : currency;
  const inputId = useId();
  const hintId = `${inputId}-hint`;
  const formId = `${inputId}-form`;

  const confirm = () => {
    if (!valid || !ready) return;
    onConfirm({ amount, legacy });
    onClose();
  };

  return (
    <PocketSheet
      open
      onClose={onClose}
      title={t("tx.completeTitle")}
      footer={
        <div className="space-y-2">
          {ready ? null : (
            <p role="status" className="text-center text-xs text-amber-600 dark:text-amber-400">
              {t("pocket.lists.waitingRates")}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex min-h-[48px] flex-1 items-center justify-center rounded-xl border border-[var(--edge)] text-[15px] font-medium active:bg-[var(--edge-soft)]"
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              form={formId}
              disabled={!valid || !ready}
              className="flex min-h-[48px] flex-[2] items-center justify-center rounded-xl bg-teal-600 px-3 text-[15px] font-semibold text-white active:bg-teal-700 disabled:opacity-50 dark:bg-teal-500 dark:text-zinc-950"
            >
              {t("pocket.lists.markPaid")}
            </button>
          </div>
        </div>
      }
    >
      <form
        id={formId}
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          confirm();
        }}
      >
        {d ? (
          <div className="flex items-center gap-3 rounded-[var(--ui-card-radius)] bg-[var(--edge-soft)] px-4 py-3">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-medium">{d.title}</span>
              <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
                {t("pocket.lists.due", { date: dayDate(tx.dueDate, locale, tx.dueDate.slice(0, 4) !== lookup.today.slice(0, 4)) })} ·{" "}
                {d.account.name}
              </span>
            </span>
            <Money
              amount={tx.amount}
              currency={currency}
              sign={tx.direction === "income" ? "in" : "out"}
              tone="auto"
              className="shrink-0 text-[15px] font-semibold"
            />
          </div>
        ) : null}

        <div className="space-y-1">
          <label htmlFor={inputId} className="block text-xs font-medium text-zinc-500 dark:text-zinc-400">
            {t("tx.finalAmount")} ({unit})
          </label>
          <input
            id={inputId}
            data-autofocus
            type="text"
            inputMode="decimal"
            autoComplete="off"
            enterKeyHint="done"
            aria-invalid={touched && !valid}
            aria-describedby={hintId}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setTouched(true);
            }}
            onFocus={(e) => e.currentTarget.select()}
            className="h-12 w-full rounded-xl border border-[var(--edge)] bg-[var(--field)] px-3 text-base tabular-nums text-zinc-900 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500 dark:text-zinc-100"
          />
          <p
            id={hintId}
            className={`text-xs ${touched && !valid ? "text-red-600 dark:text-red-400" : "text-zinc-400 dark:text-zinc-500"}`}
          >
            {touched && !valid ? t("adjust.enterAmount") : t("tx.completeHint")}
          </p>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={legacy}
          onClick={() => setLegacy((v) => !v)}
          className="flex min-h-[56px] w-full items-center gap-3 rounded-[var(--ui-card-radius)] border border-[var(--edge)] px-4 py-3 text-left active:bg-[var(--edge-soft)]"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">{t("legacy.completeAs")}</span>
            <span className="block text-xs text-zinc-500 dark:text-zinc-400">{t("legacy.completeHint")}</span>
          </span>
          <span
            aria-hidden
            className={`relative h-[28px] w-[48px] shrink-0 rounded-full transition-colors ${
              legacy ? "bg-teal-600 dark:bg-teal-500" : "bg-[var(--edge)]"
            }`}
          >
            <span
              className={`absolute top-[2px] h-[24px] w-[24px] rounded-full bg-white shadow transition-[left] ${legacy ? "left-[22px]" : "left-[2px]"}`}
            />
          </span>
        </button>
      </form>
    </PocketSheet>
  );
}
