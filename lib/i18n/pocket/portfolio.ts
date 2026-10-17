/**
 * Pocket strings for the "portfolio" package, under pocket.portfolio.* — English and
 * Turkish side by side, so a key can't exist in one and not the other.
 *
 * Reused as they are, not repeated here: portfolio.title, portfolio.cards,
 * portfolio.upcoming, portfolio.history, portfolio.noHistory, nav.loans,
 * nav.more, accounts.* (newAccount, archived, archive, unarchive,
 * deleteWarning, empty, creditCard), adjust.*, tx.cardPayment,
 * cards.limitLeft, cards.limitOver, dashboard.netWorth, common.all,
 * common.add, common.edit, common.delete, common.rateUnavailable,
 * pocket.transfer, pocket.saved, pocket.lists.deleted.
 */
export const en = {
  segLabel: "Show",
  segAssets: "Assets",
  segDebts: "Debts",
  cashBank: "Cash & bank",
  cryptoGold: "Crypto & gold",
  showEmptyN: "Show empty accounts ({count})",
  archivedN: "Archived ({count})",
  adjustShort: "Adjust",
  cardDue: "Due the {day}",
  cardDueLine: "Due the {day} · owed {amount}",
  debtFree: "Debt-free {date}",
  showAllN: "Show all ({count})",
};

export const tr: typeof en = {
  segLabel: "Göster",
  segAssets: "Varlıklar",
  segDebts: "Borçlar",
  cashBank: "Nakit ve banka",
  cryptoGold: "Kripto ve altın",
  showEmptyN: "Boş hesapları göster ({count})",
  archivedN: "Arşivlenenler ({count})",
  adjustShort: "Düzelt",
  cardDue: "Son ödeme {day}",
  cardDueLine: "Son ödeme {day} · borç {amount}",
  debtFree: "Borçsuz {date}",
  showAllN: "Tümünü göster ({count})",
};
