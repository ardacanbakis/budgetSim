"use client";

import { useMemo, useState } from "react";
import { Button, Card, Field, Input, Modal } from "@/components/ui";
import { useRepo } from "@/lib/data/provider";
import { KEYS, useAccounts, useAppMutation, useRates, useTemplates, useTransactions } from "@/lib/data/queries";
import { Transaction } from "@/lib/data/types";
import { formatAmount } from "@/lib/domain/currencies";
import { Conversion, conversionFor, cutFrom, expectedArrival, pendingConversions } from "@/lib/domain/convertedIncome";
import { pairRate, snapshotFromTable } from "@/lib/domain/fx";
import { todayISO } from "@/lib/domain/recurrence";
import { useI18n } from "@/lib/i18n";
import { useFormatDate } from "@/lib/useFormatDate";

/**
 * Converted income on screen (lib/domain/convertedIncome.ts):
 *
 * - useConversions(): for a row, the item and account it converts into,
 *   what should arrive (today's rate less the usual cut), and record(),
 *   which completes a payday still planned and records the transfer of what
 *   arrived, the payday's id on both its legs.
 * - ArrivedField: the "Arrived in EnPara TRY" field CompleteModal shows for
 *   a converted payday, so one Confirm records both.
 * - PendingConversions: paydays done with nothing recorded for what
 *   arrived, each with "Record what arrived" (ConversionModal). It draws
 *   nothing when there are none; it sits where what needs doing sits (the
 *   dashboards, the ledger).
 */

export function useConversions() {
  const repo = useRepo();
  const accounts = useAccounts();
  const templates = useTemplates();
  const transactions = useTransactions();
  const rates = useRates();

  const record = useAppMutation(
    async (v: { row: Transaction; conversion: Conversion; received: number; date: string }) => {
      const snapshot = rates.data ? snapshotFromTable(rates.data) : null;
      if (v.row.status === "planned") {
        if (!snapshot) throw new Error("rates");
        await repo.completeTransaction(v.row.id, snapshot);
      }
      const { from, to } = v.conversion;
      await repo.createTransfer({
        fromAccountId: from.id,
        toAccountId: to.id,
        fromAmount: v.row.amount,
        toAmount: v.received,
        date: v.date,
        description: `${v.row.description} → ${to.name}`,
        marketRate: rates.data ? pairRate(from.currency, to.currency, rates.data.usdPer) : null,
        fxSnapshot: snapshot,
        convertsId: v.row.id,
      });
    },
    [KEYS.transactions, KEYS.accounts]
  );

  return useMemo(() => {
    const forRow = (row: Transaction): Conversion | null => conversionFor(row, templates.data ?? [], accounts.data ?? []);
    /** what should arrive for `amount`, and how the suggestion was made */
    const expected = (c: Conversion, amount: number) => {
      if (!rates.data) return null;
      const { cut, samples } = cutFrom({
        transactions: transactions.data ?? [],
        accounts: accounts.data ?? [],
        usdPer: rates.data.usdPer,
        from: c.from.currency,
        to: c.to.currency,
      });
      const value = expectedArrival(amount, c.from.currency, c.to.currency, rates.data.usdPer, cut);
      return value == null ? null : { value, cut, samples };
    };
    const pending = pendingConversions(transactions.data ?? [], templates.data ?? [], accounts.data ?? []);
    return { forRow, expected, pending, record };
  }, [templates.data, accounts.data, transactions.data, rates.data, record]);
}

/** The suggestion's footnote: the cut it took off, or the market rate when there's nothing to learn from. */
function SuggestionHint({ cut, samples }: { cut: number; samples: number }) {
  const { t, locale } = useI18n();
  return (
    <>
      {samples > 0
        ? t(samples === 1 ? "converted.hintCutOne" : "converted.hintCut", {
            pct: (cut * 100).toLocaleString(locale === "tr" ? "tr-TR" : "en-GB", { maximumFractionDigits: 2 }),
            count: samples,
          })
        : t("converted.hintMarket")}
    </>
  );
}

/**
 * CompleteModal's field for a converted payday: what arrived where it's
 * converted into, prefilled with what should (`suggestion`).
 */
export function ArrivedField({
  conversion,
  value,
  suggestion,
  onChange,
}: {
  conversion: Conversion;
  /** what the field shows: what was typed, else the suggestion */
  value: string;
  suggestion: { cut: number; samples: number } | null;
  onChange: (value: string) => void;
}) {
  const { t } = useI18n();
  return (
    <Field
      label={t("converted.arrived", { account: conversion.to.name, currency: conversion.to.currency })}
      hint={suggestion ? <SuggestionHint cut={suggestion.cut} samples={suggestion.samples} /> : undefined}
    >
      <Input type="number" step="any" min="0" inputMode="decimal" data-arrived value={value} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

/** What arrived for one payday: the amount (suggested) and the day. */
export function ConversionModal({ row, onClose }: { row: Transaction | null; onClose: () => void }) {
  const { t, locale } = useI18n();
  const fmtDate = useFormatDate();
  const { forRow, expected, record } = useConversions();
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayISO());
  const [opened, setOpened] = useState<string | null>(null);
  if (!row && opened !== null) setOpened(null);
  if (row && opened !== row.id) {
    setOpened(row.id);
    setAmount("");
    setDate(todayISO());
  }
  const conversion = row ? forRow(row) : null;
  const suggestion = conversion && row ? expected(conversion, row.amount) : null;
  const shown = amount !== "" ? amount : suggestion ? String(suggestion.value) : "";

  return (
    <Modal
      open={row != null && conversion != null}
      onClose={onClose}
      title={row && conversion ? t("converted.modalTitle", { name: row.description, account: conversion.to.name }) : ""}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!row || !conversion || record.isPending || !(Number(shown) > 0)) return;
        await record.mutateAsync({ row, conversion, received: Number(shown), date });
        onClose();
      }}
    >
      {row && conversion ? (
        <div className="space-y-3" data-conversion>
          <p className="text-sm text-zinc-500">
            {t("converted.paid", { amount: formatAmount(row.amount, conversion.from.currency, locale), date: fmtDate(row.dueDate) })}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("converted.arrived", { account: conversion.to.name, currency: conversion.to.currency })}>
              <Input type="number" step="any" min="0" required inputMode="decimal" data-arrived value={shown} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <Field label={t("converted.arrivedOn")}>
              <Input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>
          {suggestion ? (
            <p className="text-xs text-zinc-500">
              <SuggestionHint cut={suggestion.cut} samples={suggestion.samples} />
            </p>
          ) : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" onClick={onClose}>
              {t("converted.later")}
            </Button>
            <Button type="submit" variant="primary" disabled={record.isPending}>
              {t("common.save")}
            </Button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

/** Paydays done, converted, with what arrived still to record. */
export function PendingConversions({ className = "" }: { className?: string }) {
  const { t, locale } = useI18n();
  const fmtDate = useFormatDate();
  const { pending } = useConversions();
  const [open, setOpen] = useState<Transaction | null>(null);
  if (pending.length === 0) return null;
  return (
    <Card className={`border-amber-300 p-4 dark:border-amber-700 ${className}`}>
      <div className="space-y-2" data-pending-conversions>
        <p className="text-sm font-semibold">{t("converted.pendingTitle")}</p>
        <ul className="space-y-2">
          {pending.map((p) => (
            <li key={p.row.id} className="flex flex-wrap items-center justify-between gap-2 text-sm" data-pending-conversion={p.row.description}>
              <span className="min-w-0">
                {t("converted.pendingLine", {
                  name: p.row.description,
                  amount: formatAmount(p.row.amount, p.from.currency, locale),
                  date: fmtDate(p.row.dueDate),
                  account: p.to.name,
                })}
              </span>
              <Button variant="primary" onClick={() => setOpen(p.row)}>
                {t("converted.record")}
              </Button>
            </li>
          ))}
        </ul>
      </div>
      <ConversionModal row={open} onClose={() => setOpen(null)} />
    </Card>
  );
}
