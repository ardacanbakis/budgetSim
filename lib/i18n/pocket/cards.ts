/**
 * Pocket strings for the "cards" package (Cards and VICTVS), under
 * pocket.cards.* — English and Turkish side by side, so a key can't exist in
 * one and not the other.
 *
 * Reused as they are, not repeated here: cards.title, cards.tabCards,
 * cards.tabPurchases, cards.recordPayment, cards.upcomingByMonth,
 * cards.paymentsMade, cards.seeBigPurchases(One), cards.markInactive,
 * cards.markActive, cards.inactive, cards.noneActive, cards.nothingOwed,
 * cards.limitOver, cards.bigPurchasesHint, purchases.newPurchase,
 * purchases.reflect, purchases.reflectOnWarning, purchases.reflectOffWarning,
 * purchases.deleteTitle, purchases.deleteAlsoTx, purchases.deleteKeepTx,
 * purchases.otherAccounts, purchases.logOnly, purchases.oneShot,
 * purchases.empty, accounts.newAccount, nav.victvs, victvs.*, tx.planned,
 * common.*, pocket.tapAgain, pocket.lists.waitingRates,
 * pocket.lists.markedPaid, pocket.lists.deleted, pocket.lists.inDays,
 * pocket.lists.lateOne/lateMany, pocket.lists.tomorrow.
 */
export const en = {
  // Cards
  thisStatement: "This statement",
  nothingThisMonth: "Nothing to pay this month",
  owedMonthsOne: "Total owed {amount} · 1 month to go",
  owedMonthsMany: "Total owed {amount} · {count} months to go",
  owedOnly: "Total owed {amount}",
  limitUsed: "Used {used} of {limit}",
  paidThisMonth: "Paid this month",
  dueOn: "Due {date} · {when}",
  cardMenu: "Options for {name}",
  progressLeft: "{done}/{total} · {amount} left",

  // VICTVS
  unpaidTotal: "Unpaid {amount}",
  sessionsOne: "1 session",
  sessionsMany: "{count} sessions",
  selectAllUnpaid: "Select all unpaid",
  select: "Select",
  selectIn: "Select sessions in {month}",
  firstHalf: "1–15 {month} ({count})",
  secondHalf: "16–{last} {month} ({count})",
  allUnpaidIn: "All unpaid in {month} ({count})",
  payoutsN: "Payouts ({count})",
  unpaidN: "{count} unpaid",
  clearSelection: "Clear selection",
  moreActions: "More actions",
  deleteSession: "Delete session",
  deleteSessionsOne: "Delete 1 session",
  deleteSessionsMany: "Delete {count} sessions",
  selectSession: "Select",
  deselectSession: "Deselect",
  payoutLine: "{sessions} → {account} · {date}",
  noneHere: "No sessions here.",
};

export const tr: typeof en = {
  // Cards
  thisStatement: "Bu ekstre",
  nothingThisMonth: "Bu ay ödenecek bir şey yok",
  owedMonthsOne: "Toplam borç {amount} · 1 ay kaldı",
  owedMonthsMany: "Toplam borç {amount} · {count} ay kaldı",
  owedOnly: "Toplam borç {amount}",
  limitUsed: "{limit} limitten {used} kullanıldı",
  paidThisMonth: "Bu ay ödendi",
  dueOn: "Son ödeme {date} · {when}",
  cardMenu: "{name} seçenekleri",
  progressLeft: "{done}/{total} · {amount} kaldı",

  // VICTVS
  unpaidTotal: "Ödenmemiş {amount}",
  sessionsOne: "1 seans",
  sessionsMany: "{count} seans",
  selectAllUnpaid: "Ödenmemişlerin tümünü seç",
  select: "Seç",
  selectIn: "{month} ayındaki seansları seç",
  firstHalf: "1–15 {month} ({count})",
  secondHalf: "16–{last} {month} ({count})",
  allUnpaidIn: "{month} ayındaki tüm ödenmemişler ({count})",
  payoutsN: "Ödemeler ({count})",
  unpaidN: "{count} ödenmemiş",
  clearSelection: "Seçimi temizle",
  moreActions: "Diğer işlemler",
  deleteSession: "Seansı sil",
  deleteSessionsOne: "1 seansı sil",
  deleteSessionsMany: "{count} seansı sil",
  selectSession: "Seç",
  deselectSession: "Seçimi kaldır",
  payoutLine: "{sessions} → {account} · {date}",
  noneHere: "Burada seans yok.",
};
