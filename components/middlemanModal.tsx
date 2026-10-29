"use client";

import { useState } from "react";
import { Button, Field, Input, Modal, Select } from "@/components/ui";
import { useRepo } from "@/lib/data/provider";
import { KEYS, useAccounts, useAppMutation, useRates, useTransactions } from "@/lib/data/queries";
import { NewTransfer } from "@/lib/data/repo";
import type { Account } from "@/lib/data/types";
import { cutFrom } from "@/lib/domain/convertedIncome";
import { formatAmount } from "@/lib/domain/currencies";
import { pairRate, snapshotFromTable, spreadPct } from "@/lib/domain/fx";
import { roundTo } from "@/lib/domain/money";
import { todayISO } from "@/lib/domain/recurrence";
import { useI18n } from "@/lib/i18n";

/** the lira account last converted into, so the next conversion starts there */
const LAST_TO_KEY = "renovator-middleman-to";

/** Accounts a middleman's conversion can land in: open cash in another currency. */
export function middlemanTargets(from: Account, accounts: readonly Account[]): Account[] {
  return accounts.filter((a) => !a.archived && a.kind === "fiat" && a.id !== from.id && a.currency !== from.currency);
}

/**
 * Dollars handed to the middleman, at the rate they give that day, and the
 * lira that arrives: one transfer, from this account into a lira one, with
 * the market rate stored beside it, so Reports reads the middleman's cut off
 * it like any conversion. The rate starts at today's market less the usual
 * cut; the lira follows the rate until it's typed in.
 */
export function MiddlemanModal({ from, open, onClose }: { from: Account | null; open: boolean; onClose: () => void }) {
  const { t, locale } = useI18n();
  const repo = useRepo();
  const accounts = useAccounts();
  const transactions = useTransactions();
  const rates = useRates();
  const [toId, setToId] = useState("");
  const [sent, setSent] = useState("");
  const [rate, setRate] = useState("");
  const [received, setReceived] = useState("");
  const [receivedTouched, setReceivedTouched] = useState(false);
  const [date, setDate] = useState(todayISO());
  const [openedFor, setOpenedFor] = useState<string | null>(null);

  const targets = from ? middlemanTargets(from, accounts.data ?? []) : [];
  const key = open && from ? from.id : null;
  if (key !== openedFor) {
    setOpenedFor(key);
    if (key && from) {
      let last: string | null = null;
      try {
        last = window.localStorage.getItem(LAST_TO_KEY);
      } catch {
        // no storage: the first lira account
      }
      const to = targets.find((a) => a.id === last) ?? targets.find((a) => a.currency === "TRY") ?? targets[0];
      setToId(to?.id ?? "");
      setSent("");
      setReceived("");
      setReceivedTouched(false);
      setDate(todayISO());
      // today's market, less what the middleman usually keeps
      const market = to && rates.data ? pairRate(from.currency, to.currency, rates.data.usdPer) : null;
      const cut =
        to && rates.data
          ? cutFrom({ transactions: transactions.data ?? [], accounts: accounts.data ?? [], usdPer: rates.data.usdPer, from: from.currency, to: to.currency }).cut
          : 0;
      setRate(market != null ? String(Math.round(market * (1 - cut) * 10000) / 10000) : "");
    }
  }

  const create = useAppMutation((input: NewTransfer) => repo.createTransfer(input), [KEYS.transactions, KEYS.accounts]);
  if (!from) return null;
  const to = targets.find((a) => a.id === toId) ?? targets[0];
  const market = to && rates.data ? pairRate(from.currency, to.currency, rates.data.usdPer) : null;
  const sentN = Number(sent);
  const rateN = Number(rate);
  const computed = sentN > 0 && rateN > 0 && to ? roundTo(sentN * rateN, to.currency) : null;
  const shownReceived = receivedTouched ? received : computed != null ? String(computed) : "";
  const receivedN = Number(shownReceived);
  const effective = sentN > 0 && receivedN > 0 ? receivedN / sentN : null;
  const cutPct = market != null && effective != null ? -spreadPct(market, effective) : null;
  const valid = to != null && sentN > 0 && receivedN > 0;

  return (
    <Modal open={open} onClose={onClose} title={t("middleman.title", { from: from.name })}>
      <form
        className="space-y-3"
        data-middleman={from.name}
        onSubmit={async (e) => {
          e.preventDefault();
          if (!valid || !to) return;
          await create.mutateAsync({
            fromAccountId: from.id,
            toAccountId: to.id,
            fromAmount: roundTo(sentN, from.currency),
            toAmount: roundTo(receivedN, to.currency),
            date,
            description: t("middleman.description", { rate: rate || "—" }),
            marketRate: market,
            fxSnapshot: rates.data ? snapshotFromTable(rates.data) : null,
          });
          try {
            window.localStorage.setItem(LAST_TO_KEY, to.id);
          } catch {
            // remembered only for this page
          }
          onClose();
        }}
      >
        <p className="text-xs text-zinc-500">{t("middleman.hint")}</p>
        <Field label={t("middleman.to")}>
          <Select value={to?.id ?? ""} onChange={(e) => setToId(e.target.value)}>
            {targets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.currency})
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("middleman.sent", { currency: from.currency })}>
            <Input type="number" step="any" min="0" inputMode="decimal" required value={sent} onChange={(e) => setSent(e.target.value)} />
          </Field>
          <Field label={t("middleman.rate", { from: from.currency, to: to?.currency ?? "" })}>
            <Input type="number" step="any" min="0" inputMode="decimal" required value={rate} onChange={(e) => setRate(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("middleman.received", { currency: to?.currency ?? "" })} hint={t("middleman.receivedHint")}>
            <Input
              type="number"
              step="any"
              min="0"
              inputMode="decimal"
              required
              value={shownReceived}
              onChange={(e) => {
                setReceivedTouched(true);
                setReceived(e.target.value);
              }}
            />
          </Field>
          <Field label={t("common.date")}>
            <Input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        {market != null && to ? (
          <p className="rounded-lg bg-zinc-50 p-3 text-xs text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-300" data-middleman-cut>
            {t("middleman.market", { rate: market.toLocaleString(locale, { maximumFractionDigits: 4 }), from: from.currency, to: to.currency })}
            {cutPct != null && computed != null
              ? ` · ${t("middleman.cut", {
                  pct: cutPct.toLocaleString(locale, { maximumFractionDigits: 2 }),
                  amount: formatAmount(Math.max(0, roundTo(sentN * market - receivedN, to.currency)), to.currency, locale),
                })}`
              : null}
          </p>
        ) : null}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" disabled={!valid || create.isPending}>
            {t("common.save")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
