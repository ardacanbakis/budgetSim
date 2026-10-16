"use client";

import { useState } from "react";
import { Button, Field, Input, Modal, Select } from "@/components/ui";
import { useRepo } from "@/lib/data/provider";
import { KEYS, useAppMutation, useCategories, useRates } from "@/lib/data/queries";
import { NewTransaction } from "@/lib/data/repo";
import { Account, TxDirection } from "@/lib/data/types";
import { balanceAfter, planAdjustment, planChange } from "@/lib/domain/adjustments";
import { CURRENCY_META, formatAmount } from "@/lib/domain/currencies";
import { snapshotFromTable } from "@/lib/domain/fx";
import { amountForEditing, parseTypedAmount } from "@/lib/domain/money";
import { todayISO } from "@/lib/domain/recurrence";
import { useI18n } from "@/lib/i18n";

type Mode = "set" | "change";

const segment = (on: boolean) =>
  `flex-1 rounded-md px-2 py-1.5 text-sm font-medium transition-colors ${
    on ? "bg-teal-600 text-white dark:bg-teal-500 dark:text-zinc-950" : "text-zinc-600 hover:bg-[var(--edge-soft)] dark:text-zinc-300"
  }`;

/**
 * Bring an account in line with the bank. Either type the balance the bank
 * shows and let the difference be worked out, or enter a change you already
 * know (a ₺35 EFT fee). Either way it's recorded as one dated, completed
 * entry flagged as an adjustment, with your reason as its description — so
 * the history says what happened, and it can be edited or deleted like any
 * other entry.
 */
export function AdjustBalanceModal({
  open,
  account,
  balance,
  onClose,
}: {
  open: boolean;
  account: Account | null;
  /** the account's balance as the app computes it now, in its own currency */
  balance: number;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const repo = useRepo();
  const rates = useRates();
  const categories = useCategories();
  const [mode, setMode] = useState<Mode>("set");
  const [target, setTarget] = useState("");
  const [changeDir, setChangeDir] = useState<TxDirection>("expense");
  const [changeAmount, setChangeAmount] = useState("");
  const [date, setDate] = useState(todayISO());
  const [reason, setReason] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [initialized, setInitialized] = useState<string | null>(null);

  const record = useAppMutation((input: NewTransaction) => repo.createTransaction(input), [KEYS.transactions]);

  // start from the account's current figure each time the sheet opens
  if (!open && initialized !== null) setInitialized(null);
  if (open && account && initialized !== account.id) {
    setInitialized(account.id);
    setMode("set");
    setTarget(amountForEditing(balance, account.currency, locale));
    setChangeDir("expense");
    setChangeAmount("");
    setDate(todayISO());
    setReason("");
    setCategoryId("");
  }

  if (!account) return null;
  const currency = account.currency;
  const fmt = (n: number) => formatAmount(n, currency, locale);

  // The fields are text, read by parseTypedAmount: a number field turns the
  // bank's "12.465,50" into 12.4655 in Chrome, silently. A change is always
  // positive; its direction comes from the toggle.
  const decimals = CURRENCY_META[currency].decimals;
  const typedTarget = parseTypedAmount(target, decimals);
  const typedChange = parseTypedAmount(changeAmount, decimals);
  const plan =
    mode === "set"
      ? Number.isNaN(typedTarget)
        ? null
        : planAdjustment(balance, typedTarget, currency)
      : typedChange > 0
        ? planChange(typedChange, changeDir, currency)
        : null;
  // "already matches" only means something when a balance was typed
  const matches = mode === "set" && !Number.isNaN(typedTarget) && plan == null;
  const direction = plan?.direction ?? (mode === "change" ? changeDir : "expense");
  const options = (categories.data ?? []).filter((c) => c.direction === direction);
  // a category picked for the other direction no longer applies
  const effectiveCategory = options.some((c) => c.id === categoryId) ? categoryId : "";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${t("adjust.title")} · ${account.name}`}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!plan || !rates.data || record.isPending) return;
        await record.mutateAsync({
          accountId: account.id,
          direction: plan.direction,
          categoryId: effectiveCategory || null,
          amount: plan.amount,
          status: "completed",
          dueDate: date,
          description: reason.trim() || t("adjust.defaultDescription"),
          fxSnapshot: snapshotFromTable(rates.data),
          adjustment: true,
        });
        onClose();
      }}
    >
      <div className="space-y-3">
        <p className="text-xs text-zinc-500">{t("adjust.hint")}</p>

        <div className="flex items-baseline justify-between rounded-lg bg-[var(--edge-soft)] px-3 py-2 text-sm">
          <span className="text-zinc-500">{t("adjust.current")}</span>
          <span className="font-semibold tabular-nums">{fmt(balance)}</span>
        </div>

        <div role="group" aria-label={t("adjust.title")} className="flex rounded-lg border border-[var(--edge)] p-0.5">
          <button type="button" aria-pressed={mode === "set"} className={segment(mode === "set")} onClick={() => setMode("set")}>
            {t("adjust.modeSet")}
          </button>
          <button type="button" aria-pressed={mode === "change"} className={segment(mode === "change")} onClick={() => setMode("change")}>
            {t("adjust.modeChange")}
          </button>
        </div>

        {mode === "set" ? (
          <Field label={`${t("adjust.actual")} (${currency === "XAU_G" ? "g" : currency})`}>
            <Input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              required
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            />
          </Field>
        ) : (
          <>
            <div role="group" aria-label={t("adjust.modeChange")} className="flex rounded-lg border border-[var(--edge)] p-0.5">
              <button type="button" aria-pressed={changeDir === "expense"} className={segment(changeDir === "expense")} onClick={() => setChangeDir("expense")}>
                − {t("adjust.takeOff")}
              </button>
              <button type="button" aria-pressed={changeDir === "income"} className={segment(changeDir === "income")} onClick={() => setChangeDir("income")}>
                + {t("adjust.add")}
              </button>
            </div>
            <Field label={`${t("adjust.amount")} (${currency === "XAU_G" ? "g" : currency})`}>
              <Input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                required
                value={changeAmount}
                onChange={(e) => setChangeAmount(e.target.value)}
              />
            </Field>
          </>
        )}

        <p
          aria-live="polite"
          className={`rounded-lg px-3 py-2 text-sm ${
            !plan
              ? "bg-[var(--edge-soft)] text-zinc-500"
              : plan.direction === "expense"
                ? "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"
                : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
          }`}
        >
          {!plan ? (
            matches ? t("adjust.noChange") : t("adjust.enterAmount")
          ) : (
            <>
              {t(plan.direction === "expense" ? "adjust.willTakeOff" : "adjust.willAdd", { amount: fmt(plan.amount) })}{" "}
              <span className="font-semibold">{t("adjust.newBalance", { amount: fmt(balanceAfter(balance, plan, currency)) })}</span>
            </>
          )}
        </p>

        <div className="grid grid-cols-2 gap-3">
          <Field label={t("adjust.date")}>
            <Input type="date" required max={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label={t("adjust.category")}>
            <Select value={effectiveCategory} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">{t("common.none")}</option>
              {options.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label={t("adjust.reason")}>
          <Input value={reason} maxLength={200} placeholder={t("adjust.reasonPlaceholder")} onChange={(e) => setReason(e.target.value)} />
        </Field>

        {!rates.data ? <p className="text-xs text-amber-600">{t("adjust.needsRates")}</p> : null}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" disabled={!plan || !rates.data || record.isPending}>
            {t("adjust.save")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
