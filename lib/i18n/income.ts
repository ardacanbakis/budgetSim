/**
 * Strings for Income and Bills, the two tabs that took Recurring's place on
 * Transactions (lib/domain/incomeSeries.ts for raises), under income.* —
 * English and Turkish side by side so a key can't exist in one and not the
 * other.
 *
 * Reused as they are, not repeated here: recurring.* (the item form, status
 * labels, filters, delete), common.*.
 */
export const en = {
  tabIncome: "Income",
  tabBills: "Bills",
  newIncome: "New income",
  newBill: "New bill",
  emptyIncome: "No income yet. Salaries, retainers and rent you receive belong here.",
  emptyBills: "No bills yet. Rent, subscriptions and anything else that goes out regularly belong here.",
  then: "Then {amount} from {date}",
  earlier: "Before: {list}",
  earlierItem: "{amount} {from} – {to}",
  giveRaise: "Give a raise",
  raiseTitle: "Raise — {name}",
  raiseAmount: "New amount",
  raiseFrom: "From",
  raiseHint: "{amount} until {date}, then the new amount. Both stay in its history.",
  raiseInvalid: "Pick a new amount, from after the current one started.",
  combineTitle: "One income?",
  combineHint: "{names} look like one income with raises. Combined, they show as one line with its history; nothing they planned changes.",
  combine: "Combine",
  notSame: "Not the same",
  debtsHint: "Debt repayments are here too; each one's balance is in Portfolio → Debts.",
};

export const tr: typeof en = {
  tabIncome: "Gelirler",
  tabBills: "Faturalar",
  newIncome: "Yeni gelir",
  newBill: "Yeni fatura",
  emptyIncome: "Henüz gelir yok. Maaş, düzenli ödemeler ve aldığın kira buraya.",
  emptyBills: "Henüz fatura yok. Kira, abonelikler ve düzenli giden her şey buraya.",
  then: "Sonra {date} tarihinden itibaren {amount}",
  earlier: "Önce: {list}",
  earlierItem: "{amount} {from} – {to}",
  giveRaise: "Zam ekle",
  raiseTitle: "Zam — {name}",
  raiseAmount: "Yeni tutar",
  raiseFrom: "Başlangıç",
  raiseHint: "{date} tarihine kadar {amount}, sonra yeni tutar. İkisi de geçmişinde kalır.",
  raiseInvalid: "Yeni bir tutar seç; tarih şimdikinin başlangıcından sonra olsun.",
  combineTitle: "Tek gelir mi?",
  combineHint: "{names} zamlarla tek bir gelir gibi görünüyor. Birleşince geçmişiyle tek satır olur; planladıkları değişmez.",
  combine: "Birleştir",
  notSame: "Aynı değil",
  debtsHint: "Borç ödemeleri de burada; her birinin kalanı Portföy → Borçlar'da.",
};
