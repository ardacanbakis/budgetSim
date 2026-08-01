"use client";

import { useState } from "react";
import { Badge, Button, Field, Input, Modal, Select, Textarea } from "@/components/ui";
import type { Account, Category, TxDirection } from "@/lib/data/types";
import { formatAmount } from "@/lib/domain/currencies";
import { parseLedgerPaste, type ParsedLedgerRow } from "@/lib/domain/ledgerParser";
import { todayISO } from "@/lib/domain/recurrence";
import { useI18n } from "@/lib/i18n";

export interface LegacyImportRow {
  date: string;
  description: string;
  amount: number;
  direction: TxDirection;
  categoryId: string | null;
}

/**
 * Paste a card statement (or any list of past movements) and load the rows as
 * legacy transactions. Everything is editable in the preview, because a bank
 * export is never quite the shape you want.
 */
export function LegacyImportModal({
  open,
  accounts,
  categories,
  saving,
  onClose,
  onSave,
}: {
  open: boolean;
  accounts: Account[];
  categories: Category[];
  saving: boolean;
  onClose: () => void;
  onSave: (accountId: string, rows: LegacyImportRow[]) => Promise<void>;
}) {
  const { t, locale } = useI18n();
  const [text, setText] = useState("");
  const [rows, setRows] = useState<LegacyImportRow[] | null>(null);
  const [accountId, setAccountId] = useState("");
  const [direction, setDirection] = useState<TxDirection>("expense");
  const [categoryId, setCategoryId] = useState("");
  // a card statement mixes charges and refunds; the minus sign tells them apart
  const [splitBySign, setSplitBySign] = useState(true);

  const account = accounts.find((a) => a.id === accountId) ?? accounts[0];

  /** the direction a parsed row lands on, given the sign rule */
  function directionFor(amount: number): TxDirection {
    if (!splitBySign || amount >= 0) return direction;
    return direction === "expense" ? "income" : "expense";
  }

  function preview() {
    const parsed = parseLedgerPaste(text);
    setRows(
      parsed.rows.map((r: ParsedLedgerRow) => {
        const amount = r.amount ?? 0;
        const rowDirection = directionFor(amount);
        return {
          date: r.date,
          description: r.description,
          amount: Math.abs(amount),
          direction: rowDirection,
          categoryId: categoryId || null,
        };
      })
    );
  }

  function updateRow(i: number, patch: Partial<LegacyImportRow>) {
    setRows((prev) => (prev ? prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)) : prev));
  }

  function reset() {
    setText("");
    setRows(null);
  }

  function close() {
    reset();
    onClose();
  }

  const needsAttention = rows?.filter((r) => !r.date || !(r.amount > 0)).length ?? 0;
  const incomeTotal = rows?.filter((r) => r.direction === "income").reduce((s, r) => s + r.amount, 0) ?? 0;
  const expenseTotal = rows?.filter((r) => r.direction === "expense").reduce((s, r) => s + r.amount, 0) ?? 0;
  const currency = account?.currency ?? "USD";

  return (
    <Modal open={open} onClose={close} title={t("legacy.importTitle")} wide>
      <div className="space-y-3">
        <p className="text-sm text-zinc-500">{t("legacy.importHint")}</p>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Field label={t("common.account")}>
            <Select value={account?.id ?? ""} onChange={(e) => setAccountId(e.target.value)}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.currency})
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("tx.filterDirection")}>
            <Select
              value={direction}
              onChange={(e) => {
                setDirection(e.target.value as TxDirection);
                setCategoryId("");
              }}
            >
              <option value="expense">{t("tx.expense")}</option>
              <option value="income">{t("tx.income")}</option>
            </Select>
          </Field>
          <Field label={`${t("common.category")} (${t("common.optional")})`}>
            <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">{t("common.none")}</option>
              {categories
                .filter((c) => c.direction === direction)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </Select>
          </Field>
        </div>

        <label className="flex items-center gap-2 text-xs text-zinc-500">
          <input type="checkbox" checked={splitBySign} onChange={(e) => setSplitBySign(e.target.checked)} />
          {t("legacy.importSplitSign")}
        </label>

        <Textarea
          rows={6}
          placeholder={"15.03.2025\tAKBANK KREDI KARTI ODEME\t12.500,00\n02.04.2025\tMigros\t1.250,50"}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-zinc-400">{t("legacy.importFormats")}</span>
          <Button onClick={preview} disabled={!text.trim()}>
            {t("victvs.parse")}
          </Button>
        </div>

        {rows != null ? (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge tone="green">{t("victvs.parsedCount", { count: rows.length })}</Badge>
              {needsAttention > 0 ? <Badge tone="amber">{t("victvs.needsAttention", { count: needsAttention })}</Badge> : null}
            </div>
            {rows.length > 0 ? (
              <div className="max-h-80 overflow-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-zinc-400">
                      <th className="py-1 pr-2 font-medium">{t("common.date")}</th>
                      <th className="py-1 pr-2 font-medium">{t("common.description")}</th>
                      <th className="py-1 pr-2 font-medium">{t("tx.filterDirection")}</th>
                      <th className="py-1 font-medium">
                        {t("common.amount")} ({currency})
                      </th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => {
                      const flagged = !r.date || !(r.amount > 0);
                      return (
                        <tr key={i} className={flagged ? "bg-amber-50/60 dark:bg-amber-950/30" : ""}>
                          <td className="py-1 pr-2">
                            <Input
                              type="date"
                              value={r.date}
                              onChange={(e) => updateRow(i, { date: e.target.value })}
                              className={!r.date ? "!border-amber-400" : ""}
                            />
                          </td>
                          <td className="py-1 pr-2">
                            <Input value={r.description} onChange={(e) => updateRow(i, { description: e.target.value })} />
                          </td>
                          <td className="py-1 pr-2">
                            <Select
                              value={r.direction}
                              onChange={(e) => updateRow(i, { direction: e.target.value as TxDirection, categoryId: null })}
                            >
                              <option value="expense">{t("tx.expense")}</option>
                              <option value="income">{t("tx.income")}</option>
                            </Select>
                          </td>
                          <td className="py-1">
                            <Input
                              type="number"
                              step="any"
                              min="0"
                              value={r.amount || ""}
                              onChange={(e) => updateRow(i, { amount: Number(e.target.value) })}
                              className={!(r.amount > 0) ? "!border-amber-400" : ""}
                            />
                          </td>
                          <td className="py-1 pl-1">
                            <Button
                              variant="ghost"
                              aria-label={t("common.delete")}
                              onClick={() => setRows((prev) => prev!.filter((_, idx) => idx !== i))}
                            >
                              ✕
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}
            <div className="flex flex-wrap justify-end gap-3 text-xs text-zinc-500">
              {incomeTotal > 0 ? (
                <span className="text-green-600">+{formatAmount(incomeTotal, currency, locale)}</span>
              ) : null}
              {expenseTotal > 0 ? (
                <span className="text-red-600">−{formatAmount(expenseTotal, currency, locale)}</span>
              ) : null}
            </div>
            <div className="flex justify-end gap-2">
              <Button onClick={close}>{t("common.cancel")}</Button>
              <Button
                variant="primary"
                disabled={rows.length === 0 || saving || !account}
                onClick={async () => {
                  // rows still missing a date fall back to today, as in the VICTVS import
                  const ready = rows
                    .filter((r) => r.amount > 0)
                    .map((r) => ({ ...r, date: r.date || todayISO() }));
                  if (!ready.length || !account) return;
                  await onSave(account.id, ready);
                  reset();
                }}
              >
                {t("legacy.importSave", { count: rows.filter((r) => r.amount > 0).length })}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
