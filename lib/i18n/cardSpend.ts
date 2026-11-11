/**
 * Strings for typical card spend (components/cardSpendCard.tsx), under
 * cardSpend.* — English and Turkish side by side, so a key can't exist in
 * one and not the other.
 */
export const en = {
  title: "Typical spend on each card",
  carry: "Carry into the months ahead",
  intro:
    "Your records hold every installment, because a big purchase writes its own rows. They can't hold the rest — the shopping, the fuel, the dinners — so a month ahead with nothing but taksit in it reads as a cheap month. This is what each card's last few statements came to beyond their installments, and what the plan will add to the months to come.",
  lookback: "Measured over",
  statements: "{count} statements",
  measuredFrom: "From {list}",
  noStatements: "No statement has been paid on this card yet, so there's nothing to measure.",
  setOwn: "Set your own",
  useMeasured: "Use the measured figure",
  yours: "yours",
  none: "not carried",
  zeroHint: "0 leaves this card out.",
  empty: "No open cards.",
  offHint: "Not being carried: the months ahead hold only what's already committed, so they read cheaper than they will be.",
  onHint: "Carried: {amount} a month is added across the cards, on top of the taksit and anything you've noted.",
};

export const tr: typeof en = {
  title: "Kart başına tipik harcama",
  carry: "Önümüzdeki aylara taşı",
  intro:
    "Kayıtların her taksidi tutuyor, çünkü büyük alışveriş kendi satırlarını yazıyor. Gerisini tutamıyor — market, benzin, yemek — bu yüzden içinde sadece taksit olan bir ay ucuz bir ay gibi okunuyor. Burada her kartın son birkaç ekstresinin taksit dışında kalan kısmı ve planın önümüzdeki aylara ekleyeceği tutar var.",
  lookback: "Ölçüm aralığı",
  statements: "{count} ekstre",
  measuredFrom: "Kaynak: {list}",
  noStatements: "Bu kartta henüz ödenmiş ekstre yok, ölçülecek bir şey bulunamadı.",
  setOwn: "Kendin gir",
  useMeasured: "Ölçülen rakamı kullan",
  yours: "senin",
  none: "taşınmıyor",
  zeroHint: "0 girersen bu kart hesaba katılmaz.",
  empty: "Açık kart yok.",
  offHint: "Taşınmıyor: önümüzdeki aylar yalnızca kesinleşmiş tutarları içeriyor, yani olacağından ucuz görünüyor.",
  onHint: "Taşınıyor: kartlar genelinde ayda {amount}, taksitlerin ve girdiğin beklentilerin üstüne ekleniyor.",
};
