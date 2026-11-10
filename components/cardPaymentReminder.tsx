"use client";

import { useState } from "react";
import { Button, Field, Input, Modal, Select } from "@/components/ui";
import { useRepo } from "@/lib/data/provider";
import { KEYS, useAccounts, useAppMutation, useRates } from "@/lib/data/queries";
import { NewTransfer } from "@/lib/data/repo";
import { formatAmount } from "@/lib/domain/currencies";
import { convert, snapshotFromTable } from "@/lib/domain/fx";
import { roundTo } from "@/lib/domain/money";
import { CardPaymentReminder } from "@/lib/domain/cards";
import { BillReminder } from "@/lib/domain/reminders";
import { todayISO } from "@/lib/domain/recurrence";
import { useI18n } from "@/lib/i18n";
import { useFormatDate } from "@/lib/useFormatDate";
import { useOpeningNudge } from "@/components/paymentReminders";

// snoozed for the day: it asks again tomorrow (the payment day itself, or while it's late)
const dismissKey = (r: CardPaymentReminder) => `cc-pay-dismissed-${r.account.id}-${r.month}-${todayISO()}`;

const billKey = (b: BillReminder) => `bill-dismissed-${b.tx.id}-${todayISO()}`;

const isSnoozed = (key: string) => {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(key) != null;
  } catch {
    return false;
  }
};

/**
 * Also where the opening nudge fires (useOpeningNudge): this is the one
 * component every layout draws when something is due, so the notification
 * and the banner can never disagree about whether there is anything to say.
 *
 * "Did you pay the card bill?" — one banner per card, shown the day before its
 * statement is due, on the day, and every day after while it's unpaid
 * (cardPaymentReminders). The amount is the whole statement, installments
 * included. With nothing recorded, confirm records a payment from the card's
 * default payment account (editable); with a payment recorded and not made,
 * "Mark paid" completes it. "Not now" snoozes that card until tomorrow on this
 * device. Loan installments and bills (billReminders) get the same banner on
 * the same days, above the cards, with "Mark paid" completing the row.
 */
export function CardPaymentReminders({ reminders, bills = [] }: { reminders: CardPaymentReminder[]; bills?: BillReminder[] }) {
  const { t, locale } = useI18n();
  const fmtDate = useFormatDate();
  const repo = useRepo();
  const accounts = useAccounts();
  const rates = useRates();
  // a notification on opening, for whoever asked for one (off by default)
  const due = reminders.length + bills.length;
  useOpeningNudge(due, t("reminders.nudge", { count: due }));
  const [dismissTick, setDismissTick] = useState(0);
  const [paying, setPaying] = useState<CardPaymentReminder | null>(null);
  const [fromId, setFromId] = useState("");
  const [amount, setAmount] = useState("");

  const createTransfer = useAppMutation((input: NewTransfer) => repo.createTransfer(input), [KEYS.transactions, KEYS.accounts]);
  const markBillPaid = useAppMutation(
    (b: BillReminder) => repo.completeTransaction(b.tx.id, snapshotFromTable(rates.data!)),
    [KEYS.transactions, KEYS.accounts],
  );
  const markPaid = useAppMutation(
    async (r: CardPaymentReminder) => {
      const snapshot = snapshotFromTable(rates.data!);
      for (const p of r.unmade) await repo.completeTransaction(p.paying.id, snapshot);
    },
    [KEYS.transactions, KEYS.accounts],
  );

  // dismissTick only forces re-evaluation after a snooze
  void dismissTick;
  const visible = reminders.filter((r) => !isSnoozed(dismissKey(r)));
  const visibleBills = bills.filter((b) => !isSnoozed(billKey(b)));
  if (visible.length === 0 && visibleBills.length === 0) return null;
  const snooze = (key: string) => {
    try {
      window.localStorage.setItem(key, "1");
    } catch {
      // storage blocked: it just stays up
    }
    setDismissTick((n) => n + 1);
  };

  const active = (accounts.data ?? []).filter((a) => !a.archived && a.kind !== "credit_card");
  const payment = paying ?? visible[0] ?? null;
  const from = active.find((a) => a.id === fromId) ?? active.find((a) => a.id === payment?.account.paymentAccountId) ?? active[0];
  const suggested = payment?.amount ?? 0;
  const fromAmountMarket =
    from && payment && rates.data ? convert(suggested, payment.account.currency, from.currency, rates.data.usdPer) : null;
  const shownAmount = amount || (suggested ? String(suggested) : "");
  const title = {
    tomorrow: "purchases.payReminderTomorrow",
    today: "purchases.payReminderToday",
    overdue: "purchases.payReminderOverdue",
  } as const;
  const billTitle = {
    tomorrow: "purchases.billReminderTomorrow",
    today: "purchases.billReminderToday",
    overdue: "purchases.billReminderOverdue",
  } as const;
  const tone = (when: CardPaymentReminder["when"]) =>
    when === "overdue"
      ? {
          box: "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950",
          text: "text-red-800 dark:text-red-200",
        }
      : {
          box: "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950",
          text: "text-amber-800 dark:text-amber-200",
        };

  return (
    <div className="space-y-2">
      {visibleBills.map((b) => (
        <div key={b.tx.id} className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border px-4 py-3 ${tone(b.when).box}`}>
          <div className={`text-sm ${tone(b.when).text}`}>
            <span className="font-semibold">{t(billTitle[b.when])}</span>{" "}
            {t("purchases.billReminderBody", {
              name: b.tx.description || b.account.name,
              amount: formatAmount(b.tx.amount, b.account.currency, locale),
              account: b.account.name,
              date: fmtDate(b.tx.dueDate),
            })}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => snooze(billKey(b))}>
              {t("purchases.payLater")}
            </Button>
            <Button variant="primary" disabled={!rates.data || markBillPaid.isPending} onClick={() => markBillPaid.mutate(b)}>
              {t("purchases.payMarkPaid")}
            </Button>
          </div>
        </div>
      ))}
      {visible.map((r) => {
        const vars = {
          card: r.account.name,
          amount: formatAmount(r.amount, r.account.currency, locale),
          date: fmtDate(r.date),
        };
        return (
          <div
            key={`${r.account.id}-${r.month}`}
            className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border px-4 py-3 ${tone(r.when).box}`}
          >
            <div className={`text-sm ${tone(r.when).text}`}>
              <span className="font-semibold">{t(title[r.when])}</span>{" "}
              {r.unmade.length > 0 ? t("purchases.payReminderRecorded", vars) : t("purchases.payReminderBody", vars)}
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => snooze(dismissKey(r))}>
                {t("purchases.payLater")}
              </Button>
              {r.unmade.length > 0 ? (
                <Button variant="primary" disabled={!rates.data || markPaid.isPending} onClick={() => markPaid.mutate(r)}>
                  {t("purchases.payMarkPaid")}
                </Button>
              ) : (
                <Button variant="primary" onClick={() => setPaying(r)}>
                  {t("purchases.payConfirm")}
                </Button>
              )}
            </div>
          </div>
        );
      })}

      {payment ? (
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
                  : roundTo(convert(toAmount, payment.account.currency, from.currency, rates.data.usdPer) ?? toAmount, from.currency);
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
            {payment.charges.length > 0 ? (
              <div className="rounded-lg bg-[var(--edge-soft)] p-3 text-xs text-zinc-500">
                {payment.charges.map((tx) => (
                  <div key={tx.id} className="flex justify-between">
                    <span className="truncate">+ {tx.description}</span>
                    <span className="tabular-nums">{formatAmount(tx.amount, payment.account.currency, locale)}</span>
                  </div>
                ))}
                <p className="mt-1.5 text-[11px] text-zinc-400">{t("purchases.installmentsIncluded")}</p>
              </div>
            ) : null}
            {from && from.currency !== payment.account.currency && fromAmountMarket != null ? (
              <p className="text-xs text-zinc-500">
                ≈ {formatAmount(fromAmountMarket, from.currency, locale)} {t("transfer.fromAmount").toLowerCase()}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button type="button" onClick={() => setPaying(null)}>
                {t("common.cancel")}
              </Button>
              {/* waits for the rates it freezes onto the payment, like the card page's form */}
              <Button
                type="submit"
                variant="primary"
                disabled={!from || !rates.data || createTransfer.isPending || Number(shownAmount) <= 0}
              >
                {t("common.confirm")}
              </Button>
            </div>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}
