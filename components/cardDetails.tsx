"use client";

import { useState } from "react";
import { Badge, Button, Field, Input, Modal, Select, Textarea } from "@/components/ui";
import { EditModal } from "@/components/txModals";
import { EntityChanges, RecentChanges } from "@/components/history";
import { CardEstimatesEditor, EstimateLine } from "@/components/cardEstimates";
import { HistoryUpcoming, useHistoryLayout } from "@/components/historyUpcoming";
import { useRepo } from "@/lib/data/provider";
import { KEYS, useAccounts, useAppMutation, useCategories, useRates } from "@/lib/data/queries";
import type { Account, Purchase, Transaction } from "@/lib/data/types";
import { CardBook, CardStatement, cardStatements, chargeAmount, nextCardPayment } from "@/lib/domain/cards";
import { formatAmount } from "@/lib/domain/currencies";
import { snapshotFromTable } from "@/lib/domain/fx";
import { purchaseInstallments, purchaseProgress } from "@/lib/domain/purchases";
import { todayISO } from "@/lib/domain/recurrence";
import { useFormatDate } from "@/lib/useFormatDate";
import { useI18n } from "@/lib/i18n";

const PURCHASE_KEYS = [KEYS.purchases, KEYS.transactions, KEYS.accounts];

const statusTone = {
  paid: "green",
  recorded: "sky",
  paying: "sky",
  due: "amber",
  upcoming: "zinc",
  late: "red",
} as const;

function useMonthLabel() {
  const { locale } = useI18n();
  return (month: string) =>
    new Date(`${month}-01T00:00:00`).toLocaleDateString(locale === "tr" ? "tr-TR" : "en-US", { month: "long", year: "numeric" });
}

/**
 * Everything about one card in one place: what's next, what's owed, every
 * statement (what each payment paid for, what each month ahead will charge),
 * and its big purchases. Card charges can be edited or deleted here; the
 * Transactions page leaves them out, as the payment is the spending.
 */
export function CardDetailsModal({
  card,
  book,
  purchases,
  transactions,
  onClose,
  onPay,
  onOpenPurchase,
}: {
  card: Account | null;
  book: CardBook;
  purchases: Purchase[];
  transactions: Transaction[];
  onClose: () => void;
  onPay: (card: Account) => void;
  onOpenPurchase: (purchase: Purchase) => void;
}) {
  const { t, locale } = useI18n();
  const fmtDate = useFormatDate();
  const monthLabel = useMonthLabel();
  const repo = useRepo();
  const accounts = useAccounts();
  const categories = useCategories();
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [showAllAhead, setShowAllAhead] = useState(false);
  // side by side wants a wider window than one list does
  const [layout, setLayout] = useHistoryLayout();
  const deleteTx = useAppMutation((id: string) => repo.deleteTransaction(id), [KEYS.transactions, KEYS.accounts]);
  const updateTx = useAppMutation(
    (v: { id: string; patch: Parameters<typeof repo.updateTransaction>[1] }) => repo.updateTransaction(v.id, v.patch),
    [KEYS.transactions, KEYS.accounts]
  );

  if (!card) return null;
  const today = todayISO();
  const currency = card.currency;
  const money = (amount: number) => formatAmount(amount, currency, locale);
  const next = nextCardPayment(book, card, today);
  const owed = book.owed(card.id, today);
  const statements = cardStatements(book, card, today);
  // paid statements are history, newest first; the rest (due, recorded but
  // not all made, months ahead) are what's coming, soonest first
  const past = statements.filter((s) => s.status === "paid");
  const ahead = statements.filter((s) => s.status !== "paid").reverse();
  const own = purchases.filter((p) => p.accountId === card.id);
  const purchaseById = new Map(own.map((p) => [p.id, p]));

  function statementItem(s: CardStatement) {
    return (
      <li key={s.month} className="rounded-lg border border-[var(--edge)] p-3" data-statement-month={s.month}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-medium">
            {monthLabel(s.month)}
            {s.date ? <span className="ml-1.5 text-xs font-normal text-zinc-400">{fmtDate(s.date)}</span> : null}
          </span>
          <span className="flex items-center gap-2">
            <Badge tone={statusTone[s.status]}>{t(`cards.statement_${s.status}`)}</Badge>
            <span className="text-sm font-semibold tabular-nums">{money(s.amount)}</span>
          </span>
        </div>
        <EstimateLine statement={s} currency={currency} />
        {s.charges.length > 0 ? (
          <ul className="mt-2 space-y-1 border-t border-[var(--edge-soft)] pt-2">
            {s.charges.map((c) => {
              const purchase = c.purchaseId ? purchaseById.get(c.purchaseId) : undefined;
              return (
                <li key={c.id} className="flex items-center gap-2 text-xs" data-charge={c.description}>
                  <span className="w-20 shrink-0 text-zinc-400">{fmtDate(c.dueDate)}</span>
                  <span className="min-w-0 flex-1 truncate">{c.description || "—"}</span>
                  <span className="shrink-0 tabular-nums">{money(chargeAmount(c))}</span>
                  {purchase ? (
                    <Button variant="ghost" title={t("cards.openDetails")} aria-label={t("cards.openDetails")} onClick={() => onOpenPurchase(purchase)}>
                      ↗
                    </Button>
                  ) : (
                    <>
                      <Button variant="ghost" aria-label={t("tx.editTitle")} title={t("tx.editTitle")} onClick={() => setEditing(c)}>
                        ✎
                      </Button>
                      <Button
                        variant="ghost"
                        aria-label={t("common.delete")}
                        onClick={() => window.confirm(t("common.confirmDelete")) && deleteTx.mutate(c.id)}
                      >
                        ✕
                      </Button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        ) : s.payments.length > 0 ? (
          <p className="mt-1 text-xs text-zinc-400">{t("cards.noChargesTracked")}</p>
        ) : null}
      </li>
    );
  }

  function statementList(list: CardStatement[], all: boolean, onShowAll: () => void) {
    const visible = all ? list : list.slice(0, 6);
    return (
      <div className="space-y-2 px-4 pt-2">
        <ul className="space-y-2">{visible.map(statementItem)}</ul>
        {list.length > visible.length ? (
          <button type="button" onClick={onShowAll} className="text-xs text-teal-600 hover:underline">
            {t("cards.showAllStatements", { count: list.length })}
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <Modal open onClose={onClose} title={card.name} wide={layout === "both" ? "xl" : true}>
      <div className="space-y-5" data-card-details={card.name}>
        <div className="grid grid-cols-3 gap-3 text-sm">
          <div>
            <div className="text-xs text-zinc-500">{t("cards.colNextPayment")}</div>
            <div className="text-lg font-semibold tabular-nums">{next ? money(next.amount) : "—"}</div>
            {next ? <div className="text-xs text-zinc-400">{next.date ? fmtDate(next.date) : monthLabel(next.month)}</div> : null}
          </div>
          <div>
            <div className="text-xs text-zinc-500">{t("cards.colTotalOwed")}</div>
            <div className="text-lg font-semibold tabular-nums">{money(owed)}</div>
          </div>
          <div>
            <div className="text-xs text-zinc-500">{t("cards.colLimitLeft")}</div>
            <div className="text-lg font-semibold tabular-nums">
              {card.creditLimit != null ? money(card.creditLimit - owed) : "—"}
            </div>
          </div>
        </div>
        <div className="flex justify-end">
          <Button variant="primary" onClick={() => onPay(card)}>
            {t("cards.recordPayment")}
          </Button>
        </div>

        <CardEstimatesEditor card={card} book={book} />

        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">{t("cards.statements")}</h3>
          {statements.length === 0 ? (
            <p className="text-sm text-zinc-500">{t("cards.noStatements")}</p>
          ) : (
            <HistoryUpcoming
              className="-mx-4"
              layout={layout}
              onLayout={setLayout}
              historyEmpty={t("cards.noPaidStatements")}
              emptyClassName="px-4 py-2 text-sm text-zinc-400"
              historyCount={past.length}
              upcomingCount={ahead.length}
              upcoming={statementList(ahead, showAllAhead, () => setShowAllAhead(true))}
              history={statementList(past, showAll, () => setShowAll(true))}
            />
          )}
        </section>

        {/* what's been changed on this card: edits, deletions, payments done or undone */}
        <RecentChanges account={card} balanceNow={0} limit={8} className="rounded-lg border border-[var(--edge)] px-3 py-2" />

        {own.length > 0 ? (
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">{t("cards.bigPurchasesOnCard")}</h3>
            <ul className="space-y-1">
              {own.map((p) => {
                const progress = purchaseProgress(p, book, transactions, card.currency);
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => onOpenPurchase(p)}
                      className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-[var(--edge-soft)]"
                    >
                      <span className="min-w-0 truncate">{p.name}</span>
                      <span className="shrink-0 text-xs text-zinc-500">
                        {t("purchases.progress", { paid: progress.paidCount, total: progress.totalCount })} ·{" "}
                        {money(progress.remainingAmount)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
      </div>
      <EditModal
        tx={editing}
        accounts={(accounts.data ?? []).filter((a) => !a.archived)}
        categories={categories.data ?? []}
        onClose={() => setEditing(null)}
        onSave={async (patch) => {
          if (editing) await updateTx.mutateAsync({ id: editing.id, patch });
          setEditing(null);
        }}
      />
    </Modal>
  );
}

/**
 * One big purchase: its details (editable), every installment with the
 * statement that pays it and where it stands, and reflect / delete.
 */
export function PurchaseDetailsModal({
  purchase,
  book,
  transactions,
  onClose,
}: {
  purchase: Purchase | null;
  book: CardBook;
  transactions: Transaction[];
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const fmtDate = useFormatDate();
  const monthLabel = useMonthLabel();
  const repo = useRepo();
  const accounts = useAccounts();
  const categories = useCategories();
  const rates = useRates();
  const [name, setName] = useState(purchase?.name ?? "");
  const [details, setDetails] = useState(purchase?.details ?? "");
  const [categoryId, setCategoryId] = useState(purchase?.categoryId ?? "");

  const update = useAppMutation(
    (v: { id: string; patch: Parameters<typeof repo.updatePurchase>[1] }) => repo.updatePurchase(v.id, v.patch),
    PURCHASE_KEYS
  );
  const setReflected = useAppMutation(
    (v: { id: string; reflected: boolean }) =>
      repo.setPurchaseReflected(v.id, v.reflected, rates.data ? snapshotFromTable(rates.data) : null),
    PURCHASE_KEYS
  );
  const remove = useAppMutation(
    (v: { id: string; deleteTransactions: boolean }) => repo.deletePurchase(v.id, v.deleteTransactions),
    PURCHASE_KEYS
  );

  if (!purchase) return null;
  const account = (accounts.data ?? []).find((a) => a.id === purchase.accountId);
  const currency = account?.currency ?? "TRY";
  const money = (amount: number) => formatAmount(amount, currency, locale);
  const progress = purchaseProgress(purchase, book, transactions, currency);
  const rows = purchaseInstallments(purchase, book, transactions, todayISO());
  const changed = name.trim() !== purchase.name || details !== purchase.details || (categoryId || null) !== purchase.categoryId;
  const expense = (categories.data ?? []).filter((c) => c.direction === "expense");

  return (
    <Modal open onClose={onClose} title={purchase.name} wide>
      <div className="space-y-5" data-purchase-details={purchase.name}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="text-2xl font-bold tabular-nums">{money(purchase.amount)}</div>
          <div className="text-xs text-zinc-500">
            {account?.name ?? "—"} · {fmtDate(purchase.purchaseDate)}
            {purchase.installmentCount > 1 ? ` · ${purchase.installmentCount}× ${t("purchases.installments").toLowerCase()}` : ""}
          </div>
        </div>
        {purchase.reflected && purchase.installmentCount > 1 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            {t("purchases.progress", { paid: progress.paidCount, total: progress.totalCount })} · {t("purchases.remaining")}:{" "}
            <span className="font-semibold">{money(progress.remainingAmount)}</span>
          </p>
        ) : null}

        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!changed || !name.trim()) return;
            await update.mutateAsync({ id: purchase.id, patch: { name: name.trim(), details, categoryId: categoryId || null } });
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("common.name")}>
              <Input required value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label={t("common.category")}>
              <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">{t("common.none")}</option>
                {expense.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label={t("purchases.details")}>
            <Textarea rows={2} value={details} onChange={(e) => setDetails(e.target.value)} />
          </Field>
          <div className="flex justify-end">
            <Button type="submit" variant="primary" disabled={!changed || update.isPending}>
              {t("purchases.saveChanges")}
            </Button>
          </div>
        </form>

        {rows.length > 0 ? (
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">{t("purchases.installmentsList")}</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-zinc-500">
                  <th className="py-1 font-medium">#</th>
                  <th className="py-1 font-medium">{t("common.date")}</th>
                  <th className="py-1 font-medium">{t("purchases.statementCol")}</th>
                  <th className="py-1 text-right font-medium">{t("common.amount")}</th>
                  <th className="py-1 text-right font-medium" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.tx.id} className="border-t border-[var(--edge-soft)]" data-installment={r.n}>
                    <td className="py-1.5 tabular-nums text-zinc-500">{r.n}</td>
                    <td className="py-1.5">
                      {fmtDate(r.tx.dueDate)}
                      {r.tx.legacy ? <span className="ml-1 text-[10px] text-zinc-400">{t("legacy.badge")}</span> : null}
                    </td>
                    <td className="py-1.5 text-zinc-500">{monthLabel(r.statementMonth)}</td>
                    <td className="py-1.5 text-right tabular-nums">{money(r.tx.amount)}</td>
                    <td className="py-1.5 text-right">
                      <Badge tone={statusTone[r.status]}>{t(`purchases.status_${r.status}`)}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}

        <EntityChanges entityType="purchase" entityId={purchase.id} />

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--edge-soft)] pt-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 accent-teal-600"
              checked={purchase.reflected}
              disabled={!purchase.accountId || setReflected.isPending}
              onChange={(e) => {
                const on = e.target.checked;
                if (window.confirm(on ? t("purchases.reflectOnWarning") : t("purchases.reflectOffWarning"))) {
                  setReflected.mutate({ id: purchase.id, reflected: on });
                }
              }}
            />
            {t("purchases.reflect")}
          </label>
          <Button
            variant="danger"
            disabled={remove.isPending}
            onClick={async () => {
              if (!window.confirm(t("common.confirmDelete"))) return;
              const alsoTx = purchase.reflected && window.confirm(`${t("purchases.deleteTitle")}: ${t("purchases.deleteAlsoTx")}?`);
              await remove.mutateAsync({ id: purchase.id, deleteTransactions: alsoTx });
              onClose();
            }}
          >
            {t("common.delete")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
