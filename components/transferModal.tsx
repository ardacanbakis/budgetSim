"use client";

import { useState } from "react";
import { Button, Field, Input, Modal, Select } from "@/components/ui";
import { useRepo } from "@/lib/data/provider";
import { KEYS, useAccounts, useAppMutation, useRates } from "@/lib/data/queries";
import { NewTransfer } from "@/lib/data/repo";
import { formatAmount } from "@/lib/domain/currencies";
import { convert, effectiveRate, pairRate, snapshotFromTable, spreadPct } from "@/lib/domain/fx";
import { roundTo } from "@/lib/domain/money";
import { todayISO } from "@/lib/domain/recurrence";
import { useI18n } from "@/lib/i18n";

/**
 * Cross-currency transfer: the destination amount is prefilled from the live
 * market rate; if the bank gave a different amount the user overrides it and
 * the effective rate + spread vs market are shown and stored.
 */
export function TransferModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, locale } = useI18n();
  const repo = useRepo();
  const accounts = useAccounts();
  const rates = useRates();

  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [fromAmount, setFromAmount] = useState("");
  const [toAmount, setToAmount] = useState("");
  const [toTouched, setToTouched] = useState(false);
  const [date, setDate] = useState(todayISO());
  const [description, setDescription] = useState("");

  const createTransfer = useAppMutation((input: NewTransfer) => repo.createTransfer(input), [
    KEYS.transactions,
    KEYS.accounts,
  ]);

  const active = (accounts.data ?? []).filter((a) => !a.archived);
  const from = active.find((a) => a.id === (fromId || active[0]?.id));
  const to = active.find((a) => a.id === (toId || active[1]?.id));

  const marketRate = from && to && rates.data ? pairRate(from.currency, to.currency, rates.data.usdPer) : null;

  const parsedFromAmount = Number(fromAmount);
  const marketToAmount =
    from && to && rates.data && Number.isFinite(parsedFromAmount) && parsedFromAmount > 0
      ? convert(parsedFromAmount, from.currency, to.currency, rates.data.usdPer)
      : null;

  // prefill destination from market until the user edits it
  const shownToAmount = toTouched ? toAmount : marketToAmount != null ? String(marketToAmount) : "";

  const parsedToAmount = Number(shownToAmount);
  const eff =
    Number.isFinite(parsedFromAmount) && Number.isFinite(parsedToAmount) && parsedFromAmount > 0 && parsedToAmount > 0
      ? effectiveRate(parsedFromAmount, parsedToAmount)
      : null;

  const spread = marketRate != null && eff != null ? spreadPct(marketRate, eff) : null;
  const sameAccount = from && to && from.id === to.id;
  const valid =
    from && to && !sameAccount && Number(fromAmount) > 0 && Number(shownToAmount) > 0;

  function reset() {
    setFromAmount("");
    setToAmount("");
    setToTouched(false);
    setDescription("");
  }

  return (
    <Modal open={open} onClose={onClose} title={t("transfer.title")}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!valid || !from || !to) return;
          await createTransfer.mutateAsync({
            fromAccountId: from.id,
            toAccountId: to.id,
            fromAmount: roundTo(Number(fromAmount), from.currency),
            toAmount: roundTo(Number(shownToAmount), to.currency),
            date,
            description,
            marketRate,
            fxSnapshot: rates.data ? snapshotFromTable(rates.data) : null,
          });
          reset();
          onClose();
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("transfer.from")}>
            <Select value={from?.id ?? ""} onChange={(e) => setFromId(e.target.value)}>
              {active.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.currency})
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("transfer.to")}>
            <Select value={to?.id ?? ""} onChange={(e) => setToId(e.target.value)}>
              {active.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.currency})
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {sameAccount ? <p className="text-sm text-amber-600">{t("transfer.sameAccount")}</p> : null}

        <Field label={`${t("transfer.fromAmount")} ${from ? `(${from.currency})` : ""}`}>
          <Input
            type="number"
            step="any"
            min="0"
            inputMode="decimal"
            required
            value={fromAmount}
            onChange={(e) => setFromAmount(e.target.value)}
          />
        </Field>

        <Field
          label={`${t("transfer.toAmount")} ${to ? `(${to.currency})` : ""}`}
          hint={from && to && from.currency !== to.currency ? t("transfer.prefillHint") : t("transfer.sameCurrencyHint")}
        >
          <Input
            type="number"
            step="any"
            min="0"
            inputMode="decimal"
            required
            value={shownToAmount}
            onChange={(e) => {
              setToTouched(true);
              setToAmount(e.target.value);
            }}
          />
        </Field>

        {from && to && from.currency !== to.currency ? (
          <div className="space-y-1 rounded-lg bg-zinc-50 p-3 text-xs text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-300">
            <div className="flex justify-between">
              <span>{t("transfer.marketRate")}</span>
              <span className="tabular-nums">
                {marketRate != null ? `1 ${from.currency} ≈ ${marketRate.toLocaleString(locale, { maximumFractionDigits: 6 })} ${to.currency}` : t("common.rateUnavailable")}
              </span>
            </div>
            {eff != null ? (
              <div className="flex justify-between">
                <span>{t("transfer.effectiveRate")}</span>
                <span className="tabular-nums">
                  {eff.toLocaleString(locale, { maximumFractionDigits: 6 })}
                  {spread != null ? (
                    <span className={spread < -0.05 ? "text-red-500" : spread > 0.05 ? "text-emerald-500" : "text-zinc-400"}>
                      {" "}
                      ({spread > 0 ? "+" : ""}
                      {spread.toFixed(2)}% {t("transfer.spread")})
                    </span>
                  ) : null}
                </span>
              </div>
            ) : null}
            {toTouched && marketToAmount != null && to ? (
              <button
                type="button"
                className="font-medium text-teal-600 underline"
                onClick={() => {
                  setToTouched(false);
                  setToAmount("");
                }}
              >
                {t("transfer.useMarket")}: {formatAmount(marketToAmount, to.currency, locale)}
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-3">
          <Field label={t("common.date")}>
            <Input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label={`${t("common.description")} (${t("common.optional")})`}>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" disabled={!valid || createTransfer.isPending}>
            {t("common.confirm")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
