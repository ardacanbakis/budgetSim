/**
 * Strings for the Plan's real-terms card (components/realTermsCard.tsx),
 * under realTerms.* — English and Turkish side by side, so a key can't
 * exist in one and not the other.
 */
export const en = {
  title: "In today's money",
  rate: "Prices rise",
  measured: "The last twelve months on record came to {pct}%. Change it to argue with the assumption.",
  nominal: "What you'll hand over",
  real: "In today's money",
  saved: "What inflation takes off it",
  commitment: "Commitment",
  payments: "Payments",
  groupCards: "card",
  groupDebts: "debt",
  groupOther: "other",
  empty: "Nothing to pay in this stretch.",
  hint: "A twelve-month taksit at 0% isn't a loan at 0%: the last instalment is paid in much cheaper lira. This isn't the debt getting smaller — it's which of them are cheap to carry and which are worth clearing early, which the nominal total can't tell apart.",
};

export const tr: typeof en = {
  title: "Bugünün parasıyla",
  rate: "Yıllık enflasyon",
  measured: "Kayıttaki son on iki ay %{pct} çıktı. Varsayıma katılmıyorsan değiştir.",
  nominal: "Ödeyeceğin",
  real: "Bugünün parasıyla",
  saved: "Enflasyonun götürdüğü",
  commitment: "Yükümlülük",
  payments: "Ödeme",
  groupCards: "kart",
  groupDebts: "borç",
  groupOther: "diğer",
  empty: "Bu aralıkta ödenecek bir şey yok.",
  hint: "%0 faizli 12 taksit, %0 faizli bir kredi değildir: son taksit çok daha ucuz lirayla ödenir. Bu, borcun küçülmesi demek değil — hangisini taşımanın ucuz, hangisini erken kapatmanın değerli olduğunu gösterir; nominal toplam bunları ayırt edemez.",
};
