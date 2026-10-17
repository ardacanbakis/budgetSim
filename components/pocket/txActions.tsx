"use client";

import { ReactNode, useCallback, useMemo, useState } from "react";
import { useRepo } from "@/lib/data/provider";
import { KEYS, useAccounts, useAppMutation, useRates } from "@/lib/data/queries";
import { Transaction } from "@/lib/data/types";
import { FxSnapshot, snapshotFromTable } from "@/lib/domain/fx";
import { todayISO } from "@/lib/domain/recurrence";
import { useI18n } from "@/lib/i18n";
import { isLongOverdue } from "@/lib/ui/pocket/attention";
import { dayDate } from "@/lib/ui/pocket/dayGroups";
import { formatRow, formatSigned } from "@/lib/ui/pocket/format";
import { showSnack } from "@/lib/ui/pocket/snackbar";
import { AddMode, usePocketChrome } from "./chrome";
import { describeTx, useDueLabel, useTxLookup } from "./dayList";
import { Approx, Money } from "./kit";
import { PaidAmount, PocketPaidAmountSheet } from "./paidAmountSheet";
import { ActionItem, PocketActionSheet } from "./sheet";

/**
 * What can be done to a ledger row in Pocket, and the sheet that offers it.
 *
 * - useTxActions(): the writes, through the same repo methods as the Classic
 *   ledger, each invalidating [KEYS.transactions, KEYS.accounts]:
 *   - complete(tx, paid?): completeTransaction with today's rates
 *     (snapshotFromTable), at the planned amount or paid.amount, as legacy
 *     when paid.legacy; then the snackbar "Marked paid · −₺2,800.00 · Undo".
 *     Undo reopens it (reopenTransaction) and puts a changed amount back.
 *     Does nothing until rates arrive: check `ready` and say pocket.lists.waitingRates.
 *   - reopen(tx), toggleLegacy(tx) (setTransactionLegacy), remove(tx)
 *     (deleteTransaction, then "Deleted").
 * - PocketTxActionSheet({ tx, onClose }): open while tx is set. The header
 *   sums the row up (title, amount, date, account). Then:
 *   - planned: Mark as paid, Paid a different amount…, Edit, Duplicate,
 *     Delete. A row due more than three months ago leads with Paid a
 *     different amount… (it opens with "complete as legacy" on).
 *   - completed: Edit, Duplicate, Reopen, Mark/unmark legacy, Delete.
 *   - Edit isn't offered for a transfer or a card payment; Reopen and
 *     legacy aren't for a transfer (both as in Classic). Delete is last
 *     and needs a second tap. Edit and Duplicate hand over to the add sheet
 *     (chrome.openAdd({ mode, edit }) / ({ mode, duplicateOf })); a transfer
 *     goes over as its leaving leg.
 * - usePocketTxSheet(): the usual wiring for a list, in one hook:
 *     const sheet = usePocketTxSheet();
 *     <PocketDayList months={…} onRowTap={sheet.open} onComplete={sheet.complete} />
 *     {sheet.element}
 *   complete(tx) is the ✓: it marks the row paid, or opens the paid-amount
 *   sheet (legacy on) for a row more than three months overdue.
 */

const INVALIDATE = [KEYS.transactions, KEYS.accounts];
const ignore = () => {
  // a failed save already shows the error toast (the QueryClient's MutationCache)
};

export interface TxActions {
  /** rates are in: completing can snapshot them */
  ready: boolean;
  complete: (tx: Transaction, paid?: Partial<PaidAmount>) => void;
  reopen: (tx: Transaction) => void;
  toggleLegacy: (tx: Transaction) => void;
  remove: (tx: Transaction) => void;
}

export function useTxActions(): TxActions {
  const { t, locale } = useI18n();
  const repo = useRepo();
  const rates = useRates();
  const accounts = useAccounts();

  const { mutateAsync: completeTx } = useAppMutation(
    (v: { id: string; snapshot: FxSnapshot; amount?: number; legacy?: boolean }) =>
      repo.completeTransaction(v.id, v.snapshot, v.amount, v.legacy),
    INVALIDATE
  );
  // reopening clears legacy and the snapshot; put back what the planned row had
  const { mutateAsync: undoComplete } = useAppMutation(async (v: { id: string; amount?: number; legacy: boolean }) => {
    await repo.reopenTransaction(v.id);
    if (v.amount != null) await repo.updateTransaction(v.id, { amount: v.amount });
    if (v.legacy) await repo.setTransactionLegacy(v.id, true);
  }, INVALIDATE);
  const { mutateAsync: reopenTx } = useAppMutation((id: string) => repo.reopenTransaction(id), INVALIDATE);
  const { mutateAsync: legacyTx } = useAppMutation(
    (v: { id: string; legacy: boolean }) => repo.setTransactionLegacy(v.id, v.legacy),
    INVALIDATE
  );
  const { mutateAsync: deleteTx } = useAppMutation((id: string) => repo.deleteTransaction(id), INVALIDATE);

  const table = rates.data;
  const accountList = accounts.data;
  return useMemo(() => {
    const complete = (tx: Transaction, paid?: Partial<PaidAmount>) => {
      if (!table) return;
      const amount = paid?.amount;
      const currency = accountList?.find((a) => a.id === tx.accountId)?.currency;
      const shown = currency ? formatRow(tx.direction, amount ?? tx.amount, currency, locale) : String(amount ?? tx.amount);
      // the snackbar comes after the save, whatever has unmounted by then
      completeTx({ id: tx.id, snapshot: snapshotFromTable(table), amount, legacy: paid?.legacy }).then(() => {
        showSnack(t("pocket.lists.markedPaid", { amount: shown }), {
          label: t("pocket.undo"),
          run: () => {
            undoComplete({
              id: tx.id,
              amount: amount != null && amount !== tx.amount ? tx.amount : undefined,
              legacy: tx.legacy,
            }).catch(ignore);
          },
        });
      }, ignore);
    };
    return {
      ready: table != null,
      complete,
      reopen: (tx) => {
        reopenTx(tx.id).catch(ignore);
      },
      toggleLegacy: (tx) => {
        legacyTx({ id: tx.id, legacy: !tx.legacy }).catch(ignore);
      },
      remove: (tx) => {
        deleteTx(tx.id).then(() => showSnack(t("pocket.lists.deleted")), ignore);
      },
    };
  }, [table, accountList, locale, t, completeTx, undoComplete, reopenTx, legacyTx, deleteTx]);
}

export function PocketTxActionSheet({ tx, onClose }: { tx: Transaction | null; onClose: () => void }) {
  const { t, locale } = useI18n();
  const chrome = usePocketChrome();
  const lookup = useTxLookup();
  const actions = useTxActions();
  const dueLabel = useDueLabel();
  // "Paid a different amount…" swaps this sheet for the amount sheet: one sheet at a time
  const [paidFor, setPaidFor] = useState<string | null>(null);

  const d = tx ? describeTx(tx, lookup, t) : null;
  if (!tx || !d) return null;
  const paying = paidFor === tx.id;
  const planned = tx.status === "planned";

  const mode: AddMode = tx.transferGroupId ? "transfer" : tx.direction;
  // the add sheet reads a transfer from the leg that leaves
  const source = tx.transferGroupId && tx.direction === "income" && d.other ? d.other : tx;
  const editable = !d.transfer && !d.cardPayment;

  const markPaid: ActionItem = {
    label: t("pocket.lists.markPaid"),
    icon: "check",
    disabled: !actions.ready,
    hint: actions.ready ? undefined : t("pocket.lists.waitingRates"),
    onSelect: () => {
      onClose();
      actions.complete(tx);
    },
  };
  const paidDifferent: ActionItem = {
    label: t("pocket.lists.paidDifferent"),
    icon: "adjust",
    onSelect: () => setPaidFor(tx.id),
  };
  const edit: ActionItem = {
    label: t("common.edit"),
    icon: "edit",
    onSelect: () => {
      onClose();
      chrome.openAdd({ mode, edit: tx });
    },
  };
  const duplicate: ActionItem = {
    label: t("pocket.lists.duplicate"),
    icon: "copy",
    onSelect: () => {
      onClose();
      chrome.openAdd({ mode, duplicateOf: source });
    },
  };
  const remove: ActionItem = {
    label: t("common.delete"),
    icon: "trash",
    tone: "danger",
    onSelect: () => {
      onClose();
      actions.remove(tx);
    },
  };

  const items: ActionItem[] = [];
  if (planned) {
    if (isLongOverdue(tx, lookup.today)) items.push(paidDifferent, markPaid);
    else items.push(markPaid, paidDifferent);
  }
  if (editable) items.push(edit);
  items.push(duplicate);
  if (!planned && !d.transfer) {
    items.push(
      {
        label: t("tx.reopen"),
        icon: "undo",
        onSelect: () => {
          onClose();
          actions.reopen(tx);
        },
      },
      {
        label: tx.legacy ? t("legacy.unmark") : t("legacy.mark"),
        icon: tx.legacy ? "eye" : "eyeOff",
        onSelect: () => {
          onClose();
          actions.toggleLegacy(tx);
        },
      }
    );
  }
  items.push(remove);
  items[0] = { ...items[0], tone: items[0].tone ?? "primary" };

  const when = planned ? dueLabel(tx.dueDate, lookup.today) : null;
  const date = dayDate(tx.dueDate, locale, tx.dueDate.slice(0, 4) !== lookup.today.slice(0, 4));
  const cross = d.other && d.otherAccount && d.otherAccount.currency !== d.account.currency ? d.other : null;
  const summary: ReactNode = (
    <div className="flex items-center gap-3 rounded-[var(--ui-card-radius)] bg-[var(--edge-soft)] px-4 py-3">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">
          {planned ? t("pocket.lists.due", { date }) : date}
          {when ? <span className={when.late ? "text-red-600 dark:text-red-400" : "text-zinc-500 dark:text-zinc-400"}> · {when.text}</span> : null}
        </span>
        <span className="flex min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap text-xs text-zinc-500 dark:text-zinc-400">
          <span className="min-w-0 truncate">
            {d.route ? `${d.route.from.name} → ${d.route.to.name}` : [d.account.name, d.category?.name].filter(Boolean).join(" · ")}
          </span>
          {tx.legacy ? <span className="shrink-0">· {t("legacy.badge")}</span> : null}
          {tx.adjustment ? (
            <span className="shrink-0 rounded-full bg-violet-100 px-1.5 text-[10px] font-medium leading-4 text-violet-700 dark:bg-violet-950 dark:text-violet-300">
              {t("adjust.badge")}
            </span>
          ) : null}
        </span>
      </span>
      <span className="shrink-0 text-right">
        <Money
          amount={tx.amount}
          currency={d.account.currency}
          sign={d.transfer ? "none" : tx.direction === "income" ? "in" : "out"}
          tone={d.transfer ? undefined : "auto"}
          className="block text-[15px] font-semibold"
        />
        {cross && d.otherAccount ? (
          <span data-amount className="block whitespace-nowrap text-[11px] tabular-nums text-zinc-400">
            → {formatSigned(cross.amount, d.otherAccount.currency, locale, "none")}
          </span>
        ) : (
          <Approx amount={tx.amount} from={d.account.currency} to={lookup.display} usdPer={tx.fxSnapshot?.usdPer ?? lookup.usdPer} />
        )}
      </span>
    </div>
  );

  return (
    <>
      {/* keyed by row: an armed Delete never carries over to the next row */}
      <PocketActionSheet key={tx.id} open={!paying} onClose={onClose} title={d.title} summary={summary} items={items} />
      <PocketPaidAmountSheet
        tx={paying ? tx : null}
        onClose={() => {
          setPaidFor(null);
          onClose();
        }}
        onConfirm={(paid) => actions.complete(tx, paid)}
      />
    </>
  );
}

export interface PocketTxSheet {
  /** a row's body was tapped: its action sheet */
  open: (tx: Transaction) => void;
  /** the ✓: mark paid, or the amount sheet for a row long overdue */
  complete: (tx: Transaction) => void;
  /** render once, anywhere in the screen */
  element: ReactNode;
}

export function usePocketTxSheet(): PocketTxSheet {
  const actions = useTxActions();
  const [open, setOpen] = useState<Transaction | null>(null);
  const [paying, setPaying] = useState<Transaction | null>(null);
  const { complete: completeNow } = actions;

  const complete = useCallback(
    (tx: Transaction) => {
      if (isLongOverdue(tx, todayISO())) setPaying(tx);
      else completeNow(tx);
    },
    [completeNow]
  );

  const element = (
    <>
      <PocketTxActionSheet tx={open} onClose={() => setOpen(null)} />
      <PocketPaidAmountSheet
        tx={paying}
        onClose={() => setPaying(null)}
        onConfirm={(paid) => {
          if (paying) completeNow(paying, paid);
        }}
      />
    </>
  );
  return { open: setOpen, complete, element };
}
