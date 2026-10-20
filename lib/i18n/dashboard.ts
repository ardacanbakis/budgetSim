/**
 * Dashboard strings that came with the card catalogue
 * (lib/ui/dashboardLayout.ts), spread into dashboard.* — English and Turkish
 * side by side, so a key can't exist in one and not the other.
 *
 * card_<id> names a card wherever it's listed (the chips under Classic's
 * edit mode, Settings); cardDesc_<id> says in one line what it shows. The
 * keys are built from the ids, so the compiler can't check them:
 * lib/i18n/__tests__/dashboardKeys.test.ts walks the catalogue instead.
 *
 * No label or description may say "Net worth" / "Toplam varlık" except the
 * net-worth card's own label: the e2e finds that card by those words.
 */
export const en = {
  "card_net-worth": "Net worth",
  "cardDesc_net-worth": "Everything you hold, less what the cards owe",
  "card_safe-to-spend": "Safe to spend",
  "cardDesc_safe-to-spend": "Cash and bank, plus income still due, less this month's bills",
  "card_cc-debt": "Owed on cards",
  "cardDesc_cc-debt": "What the credit cards owe, instalments included",
  card_victvs: "Unpaid VICTVS",
  cardDesc_victvs: "Sessions done and not paid for yet",
  card_accounts: "Accounts",
  cardDesc_accounts: "Your accounts and what's in them",
  card_upcoming: "Upcoming",
  cardDesc_upcoming: "Planned income and payments ahead, each a click from done",
  "card_monthly-flow": "Monthly cashflow",
  "cardDesc_monthly-flow": "Income against expenses, month by month",
  card_budgets: "Budgets",
  cardDesc_budgets: "How much of each budget this month has used",
  card_goals: "Goals",
  cardDesc_goals: "Savings goals, and what each needs a month",
  "card_avg-spend": "Avg monthly spending",
  "cardDesc_avg-spend": "What a typical month costs, by category",
  "card_gold-lens": "In gold",
  "cardDesc_gold-lens": "What everything you hold is worth in gram gold",
  moreOptions: "More options",
};

export const tr: typeof en = {
  "card_net-worth": "Toplam varlık",
  "cardDesc_net-worth": "Elindeki her şey, kart borçları düşülerek",
  "card_safe-to-spend": "Harcanabilir",
  "cardDesc_safe-to-spend": "Nakit ve banka, artı beklenen gelir, eksi bu ayın faturaları",
  "card_cc-debt": "Kartlara borç",
  "cardDesc_cc-debt": "Kredi kartlarının borcu, taksitler dahil",
  card_victvs: "Ödenmemiş VICTVS",
  cardDesc_victvs: "Yapılmış ama henüz ödenmemiş seanslar",
  card_accounts: "Hesaplar",
  cardDesc_accounts: "Hesapların ve içlerindekiler",
  card_upcoming: "Yaklaşanlar",
  cardDesc_upcoming: "Önündeki planlı gelir ve ödemeler, her biri tek tıkla tamamlanır",
  "card_monthly-flow": "Aylık nakit akışı",
  "cardDesc_monthly-flow": "Ay ay gelir ve gider",
  card_budgets: "Bütçeler",
  cardDesc_budgets: "Bu ay her bütçenin ne kadarı kullanıldı",
  card_goals: "Hedefler",
  cardDesc_goals: "Birikim hedeflerin ve her birinin aylık ihtiyacı",
  "card_avg-spend": "Aylık ortalama harcama",
  "cardDesc_avg-spend": "Sıradan bir ayın kategori kategori maliyeti",
  "card_gold-lens": "Altın cinsinden",
  "cardDesc_gold-lens": "Elindeki her şeyin gram altın karşılığı",
  moreOptions: "Diğer seçenekler",
};
