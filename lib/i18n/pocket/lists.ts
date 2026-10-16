/**
 * Pocket strings for the "lists" package, under pocket.lists.* — English and
 * Turkish side by side, so a key can't exist in one and not the other.
 *
 * Reused as they are, not repeated here: tx.planned, tx.transfer,
 * tx.cardPayment, tx.reopen, tx.completeTitle, tx.completeHint,
 * tx.finalAmount, tx.editCompletedHint, legacy.badge, legacy.mark,
 * legacy.unmark, legacy.completeAs, legacy.completeHint, adjust.badge,
 * adjust.enterAmount, common.edit, common.delete, common.cancel,
 * common.today, pocket.undo.
 */
export const en = {
  markPaid: "Mark as paid",
  markPaidRow: "Mark {name} as paid",
  markedPaid: "Marked paid · {amount}",
  paidDifferent: "Paid a different amount…",
  duplicate: "Duplicate",
  deleted: "Deleted",
  due: "Due {date}",
  waitingRates: "Waiting for live rates…",
  yesterday: "Yesterday",
  tomorrow: "Tomorrow",
  inDays: "in {count} days",
  lateOne: "1 day late",
  lateMany: "{count} days late",
  entriesOne: "1 entry",
  entriesMany: "{count} entries",
};

export const tr: typeof en = {
  markPaid: "Ödendi olarak işaretle",
  markPaidRow: "{name}: ödendi olarak işaretle",
  markedPaid: "Ödendi · {amount}",
  paidDifferent: "Farklı bir tutar ödendi…",
  duplicate: "Kopyala",
  deleted: "Silindi",
  due: "Son tarih {date}",
  waitingRates: "Canlı kurlar bekleniyor…",
  yesterday: "Dün",
  tomorrow: "Yarın",
  inDays: "{count} gün sonra",
  lateOne: "1 gün gecikti",
  lateMany: "{count} gün gecikti",
  entriesOne: "1 kayıt",
  entriesMany: "{count} kayıt",
};
