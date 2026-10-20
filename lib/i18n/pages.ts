/**
 * Strings for the pages merge (Own · Flow · Plan), under pages.* — English
 * and Turkish side by side, so a key can't exist in one and not the other:
 * the Plan page's tabs and the Portfolio's Debts view.
 */
export const en = {
  // the Plan page's tabs
  forecast: "Forecast",
  loanSimulator: "Loan simulator",
  // the loan simulator, once a loan is tracked
  trackedNow: "Now tracking {name}.",
  openInDebts: "See it in Portfolio → Debts",
  seeInPortfolio: "Open in Portfolio",
  // the Portfolio's Debts view (/accounts?view=debts)
  trackLoan: "Track a loan",
  noDebts: "Nothing owed: no card balance to pay and no tracked loan.",
  selectLoanHint: "Select a loan to see its schedule and what's left. Cards open on the Cards page.",
  paid: "Paid",
  lastPayment: "Last payment",
  loanNotFound: "This loan isn't tracked any more.",
};

export const tr: typeof en = {
  forecast: "Tahmin",
  loanSimulator: "Kredi simülatörü",
  trackedNow: "{name} artık takipte.",
  openInDebts: "Portföy → Borçlar'da gör",
  seeInPortfolio: "Portföyde aç",
  trackLoan: "Kredi takip et",
  noDebts: "Borç yok: ödenecek kart borcu da takip edilen kredi de yok.",
  selectLoanHint: "Ödeme planını ve kalanını görmek için bir kredi seç. Kartlar Kartlar sayfasında açılır.",
  paid: "Ödendi",
  lastPayment: "Son ödeme",
  loanNotFound: "Bu kredi artık takip edilmiyor.",
};
